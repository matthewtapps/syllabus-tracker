use regex::Regex;
use sqlx::{Connection, Pool, Row, Sqlite, SqlitePool};
use std::{
    collections::{HashMap, HashSet},
    fmt, fs,
    path::Path,
    sync::Arc,
};
use tracing::{debug, instrument};

use crate::lib::migrations::reporter::{MigrationReporter, NoopReporter};

#[derive(Debug)]
pub struct TableInfo {
    pub sql: String,
}

#[derive(Debug)]
pub struct IndexInfo {
    pub sql: String,
}

#[derive(Debug)]
pub struct ColumnInfo {
    pub name: String,
}

pub struct DeclarativeMigrator {
    pool: Pool<Sqlite>,
    target_schema: String,
    allow_deletions: bool,
    schema_changes_made: u32,
    reporter: Arc<dyn MigrationReporter>,
}

#[allow(dead_code)]
#[derive(Debug)]
pub struct MigrationError {
    message: String,
}

impl From<sqlx::migrate::MigrateError> for MigrationError {
    fn from(error: sqlx::migrate::MigrateError) -> Self {
        MigrationError {
            message: format!("Migration error: {}", error),
        }
    }
}

impl From<sqlx::Error> for MigrationError {
    fn from(error: sqlx::Error) -> Self {
        MigrationError {
            message: format!("Migration error: {}", error),
        }
    }
}

impl fmt::Display for MigrationError {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        write!(f, "{}", self.message)
    }
}

impl DeclarativeMigrator {
    pub fn new(pool: Pool<Sqlite>, target_schema: &str, allow_deletions: bool) -> Self {
        Self::with_reporter(pool, target_schema, allow_deletions, Arc::new(NoopReporter))
    }

    pub fn with_reporter(
        pool: Pool<Sqlite>,
        target_schema: &str,
        allow_deletions: bool,
        reporter: Arc<dyn MigrationReporter>,
    ) -> Self {
        Self {
            pool,
            target_schema: target_schema.to_string(),
            allow_deletions,
            schema_changes_made: 0,
            reporter,
        }
    }

    pub async fn get_changes(self) -> Result<ChangesNeeded, MigrationError> {
        let pristine_pool = SqlitePool::connect("sqlite::memory:").await?;
        if !self.target_schema.trim().is_empty() {
            sqlx::raw_sql(&self.target_schema)
                .execute(&pristine_pool)
                .await
                .map_err(|e| MigrationError {
                    message: format!("Failed to create pristine schema: {}", e),
                })?;
        }

        let mut tx = self.pool.begin().await?;

        self.analyze_changes(&mut tx, &pristine_pool).await
    }

    #[instrument(skip(self))]
    pub async fn migrate(&mut self) -> Result<bool, MigrationError> {
        debug!("Starting declarative database migration");

        // Create pristine database with target schema
        let pristine_pool = SqlitePool::connect("sqlite::memory:").await?;
        if !self.target_schema.trim().is_empty() {
            sqlx::raw_sql(&self.target_schema)
                .execute(&pristine_pool)
                .await
                .map_err(|e| MigrationError {
                    message: format!("Failed to create pristine schema: {}", e),
                })?;
        }

        // SQLite's documented table-rebuild procedure requires foreign_keys=OFF
        // *outside* the transaction. defer_foreign_keys=TRUE is not sufficient:
        // DROP TABLE on a parent leaves child FK references in a broken state
        // that the deferred check at COMMIT cannot reconcile, even after RENAME
        // restores the parent name. We must restore foreign_keys=ON before
        // releasing the connection so the pool's next consumer is unaffected.
        let mut conn = self.pool.acquire().await?;
        sqlx::query("PRAGMA foreign_keys = OFF")
            .execute(&mut *conn)
            .await?;

        let result = self.run_migration(&mut conn, &pristine_pool).await;

        sqlx::query("PRAGMA foreign_keys = ON")
            .execute(&mut *conn)
            .await?;

        let changes_made = match result {
            Ok(c) => c,
            Err(e) => {
                self.reporter.migration_finished(false);
                return Err(e);
            }
        };

        // Run VACUUM only if actual schema changes were made
        if self.schema_changes_made > 0 {
            debug!("Running VACUUM after migration");
            if let Err(e) = sqlx::query("VACUUM").execute(&self.pool).await {
                self.reporter.migration_finished(false);
                return Err(e.into());
            }
        }

        debug!(
            "Migration completed. Schema changes made: {}",
            self.schema_changes_made
        );
        self.reporter.migration_finished(changes_made);
        Ok(changes_made)
    }

    async fn run_migration(
        &mut self,
        conn: &mut sqlx::pool::PoolConnection<Sqlite>,
        pristine_pool: &SqlitePool,
    ) -> Result<bool, MigrationError> {
        let mut tx = conn.begin().await?;

        let changes_needed = self.analyze_changes(&mut tx, pristine_pool).await?;

        self.reporter.migration_started(&changes_needed);

        if !changes_needed.has_any_changes() {
            tx.commit().await?;
            debug!("No schema changes needed");
            return Ok(false);
        }

        let migration_result = self
            .apply_changes(&mut tx, pristine_pool, changes_needed)
            .await;

        match migration_result {
            Ok(()) => {
                // Since FK enforcement is off, verify integrity ourselves before committing
                let violations = sqlx::query("PRAGMA foreign_key_check")
                    .fetch_all(&mut *tx)
                    .await?;
                if !violations.is_empty() {
                    tx.rollback().await?;
                    return Err(MigrationError {
                        message: format!(
                            "Foreign key violations detected after migration: {} row(s)",
                            violations.len()
                        ),
                    });
                }
                tx.commit().await?;
                Ok(self.schema_changes_made > 0)
            }
            Err(e) => {
                tx.rollback().await?;
                Err(e)
            }
        }
    }

    #[instrument(skip(self, tx, pristine_pool))]
    async fn apply_changes(
        &mut self,
        tx: &mut sqlx::Transaction<'_, Sqlite>,
        pristine_pool: &SqlitePool,
        changes: ChangesNeeded,
    ) -> Result<(), MigrationError> {
        // Apply table changes first (new tables, then modifications, then deletions)

        // Create new tables
        let target_tables = self.get_tables_from_pool(pristine_pool).await?;
        for table_name in &changes.new_tables {
            if let Some(table_info) = target_tables.get(table_name) {
                self.execute_schema_change(
                    &format!("Create new table {}", table_name),
                    &table_info.sql,
                    &mut **tx,
                )
                .await?;
            }
        }

        // Modify existing tables - error if removal is requested but not allowed
        for table in &changes.modified_tables {
            if !self.allow_deletions {
                let current_columns = self.get_table_columns(&mut **tx, &table.name).await?;
                let target_columns = self
                    .get_table_columns_from_pool(pristine_pool, &table.name)
                    .await?;

                let current_col_names: HashSet<_> =
                    current_columns.iter().map(|c| &c.name).collect();
                let target_col_names: HashSet<_> = target_columns.iter().map(|c| &c.name).collect();

                let removed_columns: Vec<_> =
                    current_col_names.difference(&target_col_names).collect();
                if !removed_columns.is_empty() {
                    return Err(MigrationError {
                        message: format!(
                            "Migration requires deleting columns {:?} from table {}, but allow_deletions=false. Set allow_deletions=true to permit this.",
                            removed_columns, &table.name
                        ),
                    });
                }
            }

            if let Some(target_table) = target_tables.get(&table.name) {
                self.migrate_table(tx, &table.name, target_table, pristine_pool)
                    .await?;
            }
        }

        // Remove tables - error if removal is requested but not allowed
        if !changes.removed_tables.is_empty() {
            if !self.allow_deletions {
                return Err(MigrationError {
                    message: format!(
                        "Migration requires deleting tables {:?}, but allow_deletions=false. Set allow_deletions=true to permit this.",
                        changes.removed_tables
                    ),
                });
            }

            for table_name in &changes.removed_tables {
                let drop_sql = format!("DROP TABLE {}", table_name);
                self.execute_schema_change(
                    &format!("Drop table {}", table_name),
                    &drop_sql,
                    &mut **tx,
                )
                .await?;
            }
        }

        let current_indices = self.get_indices(&mut **tx).await?;
        let target_indices = self.get_indices_from_pool(pristine_pool).await?;

        let indices_to_remove: Vec<_> = current_indices
            .keys()
            .filter(|name| !target_indices.contains_key(*name))
            .collect();

        // Error if removal is requested but not allowed
        if !indices_to_remove.is_empty() && !self.allow_deletions {
            return Err(MigrationError {
                message: format!(
                    "Migration requires deleting indices {:?}, but allow_deletions=false. Set allow_deletions=true to permit this.",
                    indices_to_remove
                ),
            });
        }

        // Apply index changes
        self.migrate_indices(tx, &current_indices, &target_indices)
            .await?;

        // Apply pragma changes
        if changes.pragma_changes {
            let target_user_version = sqlx::query("PRAGMA user_version")
                .fetch_one(pristine_pool)
                .await?
                .get::<i64, _>(0);

            if target_user_version != 0 {
                let pragma_sql = format!("PRAGMA user_version = {}", target_user_version);
                self.execute_schema_change(PRAGMA_STEP_DESCRIPTION, &pragma_sql, &mut **tx)
                    .await?;
            }
        }

        Ok(())
    }

    #[instrument(skip(self, tx, target_table, pristine_pool))]
    async fn migrate_table(
        &mut self,
        tx: &mut sqlx::Transaction<'_, Sqlite>,
        table_name: &str,
        target_table: &TableInfo,
        pristine_pool: &SqlitePool,
    ) -> Result<(), MigrationError> {
        debug!("Migrating table: {}", table_name);
        self.reporter
            .step_started(&modified_table_description(table_name));

        // Create temporary table with new schema
        let temp_name = format!("{}_migration_new", table_name);
        let temp_sql = target_table.sql.replace(
            &format!("CREATE TABLE {}", table_name),
            &format!("CREATE TABLE {}", temp_name),
        );

        self.execute_schema_change_silent(
            &format!("Create temporary table for {}", table_name),
            &temp_sql,
            &mut **tx,
        )
        .await?;

        // Get column information
        let current_columns = self.get_table_columns(&mut **tx, table_name).await?;
        let target_columns = self
            .get_table_columns_from_pool(pristine_pool, table_name)
            .await?;

        let current_col_names: HashSet<_> = current_columns.iter().map(|c| &c.name).collect();
        let target_col_names: HashSet<_> = target_columns.iter().map(|c| &c.name).collect();

        let removed_columns: Vec<_> = current_col_names.difference(&target_col_names).collect();

        // Error if removals requested but not allowed
        if !removed_columns.is_empty() && !self.allow_deletions {
            return Err(MigrationError {
                message: format!(
                    "Refusing to remove columns {:?} from table {}. Set allow_deletions=true to permit this.",
                    removed_columns, table_name
                ),
            });
        }

        // Copy data from old table to new table
        let common_columns: Vec<_> = current_col_names.intersection(&target_col_names).collect();
        if !common_columns.is_empty() {
            let columns_str = common_columns
                .iter()
                .map(|s| s.as_str())
                .collect::<Vec<_>>()
                .join(", ");
            let copy_sql = format!(
                "INSERT INTO {} ({}) SELECT {} FROM {}",
                temp_name, columns_str, columns_str, table_name
            );

            self.execute_schema_change_silent(
                &format!("Copy data to new {}", table_name),
                &copy_sql,
                &mut **tx,
            )
            .await?;
        }

        // Drop old table and rename new one
        let drop_sql = format!("DROP TABLE {}", table_name);
        self.execute_schema_change_silent(
            &format!("Drop old table {}", table_name),
            &drop_sql,
            &mut **tx,
        )
        .await?;

        let rename_sql = format!("ALTER TABLE {} RENAME TO {}", temp_name, table_name);
        self.execute_schema_change_silent(
            &format!("Rename new table to {}", table_name),
            &rename_sql,
            &mut **tx,
        )
        .await?;

        self.reporter.step_finished();
        Ok(())
    }

    #[instrument(skip(self, tx))]
    async fn migrate_indices(
        &mut self,
        tx: &mut sqlx::Transaction<'_, Sqlite>,
        current_indices: &HashMap<String, IndexInfo>,
        target_indices: &HashMap<String, IndexInfo>,
    ) -> Result<(), MigrationError> {
        // Drop removed indices
        for index_name in current_indices.keys() {
            if !target_indices.contains_key(index_name) {
                let drop_sql = format!("DROP INDEX {}", index_name);
                self.execute_schema_change(
                    &format!("Drop obsolete index {}", index_name),
                    &drop_sql,
                    &mut **tx,
                )
                .await?;
            }
        }

        // Create or update indices
        for (index_name, target_index) in target_indices {
            if let Some(current_index) = current_indices.get(index_name) {
                if normalize_sql(&current_index.sql) != normalize_sql(&target_index.sql) {
                    // Index changed: drop silently and recreate as the announced step
                    // so the user-facing checklist shows one entry per modified index.
                    let drop_sql = format!("DROP INDEX {}", index_name);
                    self.execute_schema_change_silent(
                        &format!("Drop changed index {}", index_name),
                        &drop_sql,
                        &mut **tx,
                    )
                    .await?;

                    self.execute_schema_change(
                        &format!("Recreate index {}", index_name),
                        &target_index.sql,
                        &mut **tx,
                    )
                    .await?;
                }
            } else {
                // New index
                self.execute_schema_change(
                    &format!("Create new index {}", index_name),
                    &target_index.sql,
                    &mut **tx,
                )
                .await?;
            }
        }

        Ok(())
    }

    // Helper methods
    #[instrument(skip(self, executor))]
    async fn execute_schema_change(
        &mut self,
        description: &str,
        sql: &str,
        executor: impl sqlx::Executor<'_, Database = Sqlite>,
    ) -> Result<(), MigrationError> {
        self.reporter.step_started(description);
        debug!("Database migration: {} with SQL:\n{}", description, sql);
        sqlx::query(sql).execute(executor).await?;
        self.schema_changes_made += 1;
        self.reporter.step_finished();
        Ok(())
    }

    /// Like `execute_schema_change` but does not emit reporter events. Used
    /// for sub-steps inside `migrate_table` so the user-facing checklist
    /// shows one entry per modified table rather than four (create temp +
    /// copy + drop + rename).
    #[instrument(skip(self, executor))]
    async fn execute_schema_change_silent(
        &mut self,
        description: &str,
        sql: &str,
        executor: impl sqlx::Executor<'_, Database = Sqlite>,
    ) -> Result<(), MigrationError> {
        debug!("Database migration: {} with SQL:\n{}", description, sql);
        sqlx::query(sql).execute(executor).await?;
        self.schema_changes_made += 1;
        Ok(())
    }

    #[instrument(skip_all)]
    async fn get_tables(
        &self,
        executor: impl sqlx::Executor<'_, Database = Sqlite>,
    ) -> Result<HashMap<String, TableInfo>, MigrationError> {
        let rows = sqlx::query(
            "SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name != 'sqlite_sequence'"
        ).fetch_all(executor).await?;

        let mut tables = HashMap::new();
        for row in rows {
            let name: String = row.get(0);
            let sql: String = row.get(1);
            tables.insert(name.clone(), TableInfo { sql });
        }
        Ok(tables)
    }

    #[instrument(skip_all)]
    async fn get_tables_from_pool(
        &self,
        pool: &SqlitePool,
    ) -> Result<HashMap<String, TableInfo>, MigrationError> {
        self.get_tables(pool).await
    }

    #[instrument(skip_all)]
    async fn get_indices(
        &self,
        executor: impl sqlx::Executor<'_, Database = Sqlite>,
    ) -> Result<HashMap<String, IndexInfo>, MigrationError> {
        let rows = sqlx::query(
            "SELECT name, sql FROM sqlite_master WHERE type = 'index' AND sql IS NOT NULL",
        )
        .fetch_all(executor)
        .await?;

        let mut indices = HashMap::new();
        for row in rows {
            let name: String = row.get(0);
            let sql: String = row.get(1);
            indices.insert(name.clone(), IndexInfo { sql });
        }
        Ok(indices)
    }

    #[instrument(skip_all)]
    async fn get_indices_from_pool(
        &self,
        pool: &SqlitePool,
    ) -> Result<HashMap<String, IndexInfo>, MigrationError> {
        self.get_indices(pool).await
    }

    #[instrument(skip(self, executor))]
    async fn get_table_columns(
        &self,
        executor: impl sqlx::Executor<'_, Database = Sqlite>,
        table_name: &str,
    ) -> Result<Vec<ColumnInfo>, MigrationError> {
        let rows = sqlx::query(&format!("PRAGMA table_info({})", table_name))
            .fetch_all(executor)
            .await?;

        let mut columns = Vec::new();
        for row in rows {
            columns.push(ColumnInfo { name: row.get(1) });
        }
        Ok(columns)
    }

    #[instrument(skip(self, pool))]
    async fn get_table_columns_from_pool(
        &self,
        pool: &SqlitePool,
        table_name: &str,
    ) -> Result<Vec<ColumnInfo>, MigrationError> {
        self.get_table_columns(pool, table_name).await
    }

    #[instrument(skip_all)]
    async fn analyze_changes(
        &self,
        tx: &mut sqlx::Transaction<'_, Sqlite>,
        pristine_pool: &SqlitePool,
    ) -> Result<ChangesNeeded, MigrationError> {
        let mut changes = ChangesNeeded::default();

        // Analyze table changes
        let current_tables = self.get_tables(&mut **tx).await?;
        let target_tables = self.get_tables_from_pool(pristine_pool).await?;

        let current_table_names: HashSet<_> = current_tables.keys().collect();
        let target_table_names: HashSet<_> = target_tables.keys().collect();

        changes.new_tables = target_table_names
            .difference(&current_table_names)
            .map(|s| s.to_string())
            .collect();

        changes.removed_tables = current_table_names
            .difference(&target_table_names)
            .map(|s| s.to_string())
            .collect();

        for table_name in current_table_names.intersection(&target_table_names) {
            let current_sql = normalize_sql(&current_tables[*table_name].sql);
            let target_sql = normalize_sql(&target_tables[*table_name].sql);
            if current_sql != target_sql {
                let current_columns = self.get_table_columns(&mut **tx, table_name).await?;
                let target_columns = self
                    .get_table_columns_from_pool(pristine_pool, table_name)
                    .await?;

                let current_col_names: HashSet<_> =
                    current_columns.iter().map(|c| &c.name).collect();
                let target_col_names: HashSet<_> = target_columns.iter().map(|c| &c.name).collect();

                let removed_columns: Vec<String> = current_col_names
                    .difference(&target_col_names)
                    .map(|c| c.to_string())
                    .collect();

                let new_columns: Vec<String> = target_col_names
                    .difference(&current_col_names)
                    .map(|c| c.to_string())
                    .collect();

                changes.modified_tables.push(ModifiedTable {
                    name: table_name.to_string(),
                    removed_columns,
                    new_columns,
                });
            }
        }

        // Analyze index changes
        let current_indices = self.get_indices(&mut **tx).await?;
        let target_indices = self.get_indices_from_pool(pristine_pool).await?;

        let current_index_names: HashSet<_> = current_indices.keys().collect();
        let target_index_names: HashSet<_> = target_indices.keys().collect();

        changes.new_indices = target_index_names
            .difference(&current_index_names)
            .map(|s| s.to_string())
            .collect();

        changes.removed_indices = current_index_names
            .difference(&target_index_names)
            .map(|s| s.to_string())
            .collect();

        for index_name in current_index_names.intersection(&target_index_names) {
            let current_sql = normalize_sql(&current_indices[*index_name].sql);
            let target_sql = normalize_sql(&target_indices[*index_name].sql);
            if current_sql != target_sql {
                changes.modified_indices.push(index_name.to_string());
            }
        }

        // Check pragma changes
        let current_user_version = sqlx::query("PRAGMA user_version")
            .fetch_one(&mut **tx)
            .await?
            .get::<i64, _>(0);
        let target_user_version = sqlx::query("PRAGMA user_version")
            .fetch_one(pristine_pool)
            .await?
            .get::<i64, _>(0);

        changes.pragma_changes = current_user_version != target_user_version;

        Ok(changes)
    }
}

#[instrument(skip_all)]
pub fn normalize_sql(sql: &str) -> String {
    // Remove comments
    let re = Regex::new(r"--[^\n]*\n").unwrap();
    let sql = re.replace_all(sql, "");

    // Normalize whitespace
    let re = Regex::new(r"\s+").unwrap();
    let sql = re.replace_all(&sql, " ");

    // Remove spaces around punctuation
    let re = Regex::new(r" *([(),]) *").unwrap();
    let sql = re.replace_all(&sql, "$1");

    // Remove unnecessary quotes from identifiers
    let re = Regex::new(r#""(\w+)""#).unwrap();
    let sql = re.replace_all(&sql, "$1");

    sql.trim().to_string()
}

#[instrument(skip_all)]
pub async fn migrate_database_declaratively(
    pool: Pool<Sqlite>,
    target_schema: &str,
    allow_deletions: bool,
) -> Result<bool, MigrationError> {
    migrate_database_declaratively_with_reporter(
        pool,
        target_schema,
        allow_deletions,
        Arc::new(NoopReporter),
    )
    .await
}

#[instrument(skip_all)]
pub async fn migrate_database_declaratively_with_reporter(
    pool: Pool<Sqlite>,
    target_schema: &str,
    allow_deletions: bool,
    reporter: Arc<dyn MigrationReporter>,
) -> Result<bool, MigrationError> {
    let mut migrator =
        DeclarativeMigrator::with_reporter(pool, target_schema, allow_deletions, reporter);
    migrator.migrate().await
}

/// The description string used when a table is being modified in place.
/// Shared between the migration logic (when it announces the step) and
/// reporters (when they build the planned-step list up front).
pub fn modified_table_description(table_name: &str) -> String {
    format!("Modifying table {}", table_name)
}

pub const PRAGMA_STEP_DESCRIPTION: &str = "Update database PRAGMAs";

/// Build the ordered list of step descriptions a reporter should expect,
/// derived from the changes the migration is about to apply. Kept in sync
/// with the descriptions emitted inside `apply_changes` and `migrate_table`.
///
/// Each category is sorted alphabetically so the planned-step display has a
/// stable order, even though the underlying analysis derives names from a
/// `HashSet`. Reporters look up bars by description string (which is unique
/// per step), so the actual execution order doesn't need to match.
pub fn planned_step_descriptions(changes: &ChangesNeeded) -> Vec<String> {
    let mut steps = Vec::new();

    let mut new_tables = changes.new_tables.clone();
    new_tables.sort();
    for name in &new_tables {
        steps.push(format!("Create new table {}", name));
    }

    let mut modified_tables: Vec<&str> =
        changes.modified_tables.iter().map(|t| t.name.as_str()).collect();
    modified_tables.sort();
    for name in modified_tables {
        steps.push(modified_table_description(name));
    }

    let mut removed_tables = changes.removed_tables.clone();
    removed_tables.sort();
    for name in &removed_tables {
        steps.push(format!("Drop table {}", name));
    }

    let mut removed_indices = changes.removed_indices.clone();
    removed_indices.sort();
    for name in &removed_indices {
        steps.push(format!("Drop obsolete index {}", name));
    }

    let mut modified_indices = changes.modified_indices.clone();
    modified_indices.sort();
    for name in &modified_indices {
        steps.push(format!("Recreate index {}", name));
    }

    let mut new_indices = changes.new_indices.clone();
    new_indices.sort();
    for name in &new_indices {
        steps.push(format!("Create new index {}", name));
    }

    if changes.pragma_changes {
        steps.push(PRAGMA_STEP_DESCRIPTION.to_string());
    }

    steps
}

#[instrument(skip_all)]
pub async fn get_schema_changes(
    pool: Pool<Sqlite>,
    target_schema: &str,
) -> Result<ChangesNeeded, MigrationError> {
    let migrator = DeclarativeMigrator::new(pool, target_schema, false);
    migrator.get_changes().await
}

#[derive(Default, Debug)]
pub struct ChangesNeeded {
    pub new_tables: Vec<String>,
    pub removed_tables: Vec<String>,
    pub modified_tables: Vec<ModifiedTable>,
    pub new_indices: Vec<String>,
    pub removed_indices: Vec<String>,
    pub modified_indices: Vec<String>,
    pub pragma_changes: bool,
}

#[derive(Default, Debug, Hash, Eq, PartialEq)]
pub struct ModifiedTable {
    pub name: String,
    pub removed_columns: Vec<String>,
    pub new_columns: Vec<String>,
}

impl ChangesNeeded {
    pub fn has_any_changes(&self) -> bool {
        !self.new_tables.is_empty()
            || !self.removed_tables.is_empty()
            || !self.modified_tables.is_empty()
            || !self.new_indices.is_empty()
            || !self.removed_indices.is_empty()
            || !self.modified_indices.is_empty()
            || self.pragma_changes
    }
}

pub fn read_schema_file_to_string(path: &Path) -> Result<String, MigrationError> {
    let schema = fs::read_to_string(path)?;
    Ok(schema)
}

impl From<std::io::Error> for MigrationError {
    fn from(error: std::io::Error) -> Self {
        MigrationError {
            message: format!("Migration error: {}", error),
        }
    }
}
