use regex::Regex;
use sqlx::{Pool, Row, Sqlite, SqlitePool};
use std::{
    collections::{HashMap, HashSet},
    fmt, fs,
    path::Path,
};
use tracing::{info, instrument};

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
        Self {
            pool,
            target_schema: target_schema.to_string(),
            allow_deletions,
            schema_changes_made: 0,
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

        Ok(self.analyze_changes(&mut tx, &pristine_pool).await?)
    }

    #[instrument(skip(self))]
    pub async fn migrate(&mut self) -> Result<bool, MigrationError> {
        info!("Starting declarative database migration");

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

        // Start transaction with deferred foreign keys for the migration
        let mut tx = self.pool.begin().await?;
        sqlx::query("PRAGMA defer_foreign_keys = TRUE")
            .execute(&mut *tx)
            .await?;

        // Analyze what changes need to be made
        let changes_needed = self.analyze_changes(&mut tx, &pristine_pool).await?;

        // If no changes needed, just clean up and return
        if !changes_needed.has_any_changes() {
            tx.commit().await?;
            info!("No schema changes needed");
            return Ok(false);
        }

        // Apply the changes
        let migration_result = self
            .apply_changes(&mut tx, &pristine_pool, changes_needed)
            .await;

        match migration_result {
            Ok(()) => {
                tx.commit().await?;

                // Run VACUUM only if actual schema changes were made
                if self.schema_changes_made > 0 {
                    info!("Running VACUUM after migration");
                    sqlx::query("VACUUM").execute(&self.pool).await?;
                }

                info!(
                    "Migration completed. Schema changes made: {}",
                    self.schema_changes_made
                );
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
                self.execute_schema_change(
                    &format!("Set user_version to {}", target_user_version),
                    &pragma_sql,
                    &mut **tx,
                )
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
        info!("Migrating table: {}", table_name);

        // Create temporary table with new schema
        let temp_name = format!("{}_migration_new", table_name);
        let temp_sql = target_table.sql.replace(
            &format!("CREATE TABLE {}", table_name),
            &format!("CREATE TABLE {}", temp_name),
        );

        self.execute_schema_change(
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

            self.execute_schema_change(
                &format!("Copy data to new {}", table_name),
                &copy_sql,
                &mut **tx,
            )
            .await?;
        }

        // Drop old table and rename new one
        let drop_sql = format!("DROP TABLE {}", table_name);
        self.execute_schema_change(
            &format!("Drop old table {}", table_name),
            &drop_sql,
            &mut **tx,
        )
        .await?;

        let rename_sql = format!("ALTER TABLE {} RENAME TO {}", temp_name, table_name);
        self.execute_schema_change(
            &format!("Rename new table to {}", table_name),
            &rename_sql,
            &mut **tx,
        )
        .await?;

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
                    // Index changed, drop and recreate
                    let drop_sql = format!("DROP INDEX {}", index_name);
                    self.execute_schema_change(
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
        info!("Database migration: {} with SQL:\n{}", description, sql);
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

#[instrument(skip(pool))]
pub async fn migrate_database_declaratively(
    pool: Pool<Sqlite>,
    target_schema: &str,
) -> Result<bool, MigrationError> {
    let allow_deletions = std::env::var("ALLOW_DESTRUCTIVE_MIGRATIONS")
        .unwrap_or_else(|_| "false".to_string())
        .parse::<bool>()
        .unwrap_or(false);

    let mut migrator = DeclarativeMigrator::new(pool, target_schema, allow_deletions);
    migrator.migrate().await
}

#[instrument(skip(pool))]
pub async fn get_schema_changes(
    pool: Pool<Sqlite>,
    target_schema: &str,
) -> Result<ChangesNeeded, MigrationError> {
    let migrator = DeclarativeMigrator::new(pool, target_schema, false);
    Ok(migrator.get_changes().await?)
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
    fn has_any_changes(&self) -> bool {
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
