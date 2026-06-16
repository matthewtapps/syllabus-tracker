#[cfg(test)]
mod tests {
    use sqlx::{Row, SqlitePool};

    use crate::migrations::{migrate_database_declaratively, normalize_sql};

    const EMPTY_SCHEMA: &str = "";

    const SINGLE_TABLE_SCHEMA: &str = r#"
        CREATE TABLE users (
            id INTEGER PRIMARY KEY,
            username TEXT NOT NULL
        );
    "#;

    const TWO_TABLE_SCHEMA: &str = r#"
        CREATE TABLE users (
            id INTEGER PRIMARY KEY,
            username TEXT NOT NULL
        );
        
        CREATE TABLE posts (
            id INTEGER PRIMARY KEY,
            title TEXT NOT NULL,
            user_id INTEGER,
            FOREIGN KEY (user_id) REFERENCES users (id)
        );
    "#;

    const MODIFIED_TABLE_SCHEMA: &str = r#"
        CREATE TABLE users (
            id INTEGER PRIMARY KEY,
            username TEXT NOT NULL,
            email TEXT
        );
        
        CREATE TABLE posts (
            id INTEGER PRIMARY KEY,
            title TEXT NOT NULL,
            user_id INTEGER,
            FOREIGN KEY (user_id) REFERENCES users (id)
        );
    "#;

    const COLUMN_REMOVAL_SCHEMA: &str = r#"
    CREATE TABLE users (
        id INTEGER PRIMARY KEY
        -- removed username column
    );
    "#;

    const WITH_INDEX_SCHEMA: &str = r#"
    CREATE TABLE users (
        id INTEGER PRIMARY KEY,
        username TEXT NOT NULL
    );
    
    CREATE INDEX idx_username ON users(username);
    "#;

    const WITHOUT_INDEX_SCHEMA: &str = r#"
    CREATE TABLE users (
        id INTEGER PRIMARY KEY,
        username TEXT NOT NULL
    );
    -- removed index
    "#;

    async fn create_test_db() -> SqlitePool {
        SqlitePool::connect("sqlite::memory:")
            .await
            .expect("Failed to create in-memory database")
    }

    async fn get_table_names(pool: &SqlitePool) -> Vec<String> {
        let rows = sqlx::query("SELECT name FROM sqlite_master WHERE type = 'table' AND name != 'sqlite_sequence' ORDER BY name")
            .fetch_all(pool)
            .await
            .expect("Failed to fetch table names");

        rows.into_iter()
            .map(|row| row.get::<String, _>(0))
            .collect()
    }

    async fn get_pragma_value(pool: &SqlitePool, pragma: &str) -> i64 {
        sqlx::query(&format!("PRAGMA {}", pragma))
            .fetch_one(pool)
            .await
            .expect("Failed to get pragma")
            .get::<i64, _>(0)
    }

    #[tokio::test]
    async fn test_brand_new_db_pragma() {
        let pool = SqlitePool::connect("sqlite::memory:")
            .await
            .expect("Failed to create in-memory database");

        let pragma = sqlx::query("PRAGMA foreign_keys")
            .fetch_one(&pool)
            .await
            .expect("Failed to get pragma")
            .get::<i64, _>(0);

        println!("pragma: {:?}", pragma);

        // Pragma is 1 by default when using SQLX, even though it is 0 by default
        // in SQLite
        assert_eq!(pragma, 1);
    }

    #[tokio::test]
    async fn test_empty_to_empty_no_changes() {
        let pool = create_test_db().await;

        let result = migrate_database_declaratively(pool.clone(), EMPTY_SCHEMA, false).await;
        assert!(result.is_ok());
        assert!(!result.unwrap(), "Empty to empty should report no changes");

        let tables = get_table_names(&pool).await;
        assert!(tables.is_empty());

        assert_eq!(get_pragma_value(&pool, "foreign_keys").await, 1);
    }

    #[tokio::test]
    async fn test_create_first_table() {
        let pool = create_test_db().await;

        let result = migrate_database_declaratively(pool.clone(), SINGLE_TABLE_SCHEMA, false).await;
        assert!(result.is_ok());
        assert!(
            result.unwrap(),
            "Creating first table should report changes"
        );

        let tables = get_table_names(&pool).await;
        assert_eq!(tables, vec!["users"]);

        // Re-running should be no-op
        let result = migrate_database_declaratively(pool.clone(), SINGLE_TABLE_SCHEMA, false).await;
        assert!(result.is_ok());
        assert!(
            !result.unwrap(),
            "Re-running same migration should be no-op"
        );
    }

    #[tokio::test]
    async fn test_add_second_table() {
        let pool = create_test_db().await;

        // Start with one table
        sqlx::raw_sql(SINGLE_TABLE_SCHEMA)
            .execute(&pool)
            .await
            .unwrap();

        // Add second table
        let result = migrate_database_declaratively(pool.clone(), TWO_TABLE_SCHEMA, false).await;
        assert!(result.is_ok());
        assert!(result.unwrap(), "Adding second table should report changes");

        let tables = get_table_names(&pool).await;
        assert_eq!(tables, vec!["posts", "users"]);
    }

    #[tokio::test]
    async fn test_modify_existing_table() {
        let pool = create_test_db().await;

        // Start with two tables
        sqlx::raw_sql(TWO_TABLE_SCHEMA)
            .execute(&pool)
            .await
            .unwrap();

        // Modify users table to add email column
        let result =
            migrate_database_declaratively(pool.clone(), MODIFIED_TABLE_SCHEMA, false).await;
        assert!(result.is_ok());
        assert!(result.unwrap(), "Modifying table should report changes");

        // Check that email column was added
        let columns = sqlx::query("PRAGMA table_info(users)")
            .fetch_all(&pool)
            .await
            .unwrap();

        let column_names: Vec<String> = columns
            .iter()
            .map(|row| row.get::<String, _>("name"))
            .collect();
        assert!(column_names.contains(&"email".to_string()));
    }

    #[tokio::test]
    async fn test_remove_table_requires_permission() {
        let pool = create_test_db().await;

        // Start with two tables
        sqlx::raw_sql(TWO_TABLE_SCHEMA)
            .execute(&pool)
            .await
            .unwrap();

        // Try to remove posts table without permission
        let result = migrate_database_declaratively(pool.clone(), SINGLE_TABLE_SCHEMA, false).await;
        assert!(result.is_err(), "Should fail without allow_deletions");

        // Tables should be unchanged
        let tables = get_table_names(&pool).await;
        assert_eq!(tables, vec!["posts", "users"]);

        let result = migrate_database_declaratively(pool.clone(), SINGLE_TABLE_SCHEMA, true).await;

        assert!(result.is_ok());
        assert!(result.unwrap(), "Should report changes when deleting table");

        let tables = get_table_names(&pool).await;
        assert_eq!(tables, vec!["users"]);
    }

    #[tokio::test]
    async fn test_data_preservation() {
        let pool = create_test_db().await;

        // Start with single table and add data
        sqlx::raw_sql(SINGLE_TABLE_SCHEMA)
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("INSERT INTO users (username) VALUES (?)")
            .bind("testuser")
            .execute(&pool)
            .await
            .unwrap();

        // Migrate to modified schema (adds email column)
        let result =
            migrate_database_declaratively(pool.clone(), MODIFIED_TABLE_SCHEMA, false).await;
        assert!(result.is_ok());

        // Check data is preserved
        let user = sqlx::query("SELECT username, email FROM users WHERE username = ?")
            .bind("testuser")
            .fetch_one(&pool)
            .await
            .unwrap();

        assert_eq!(user.get::<String, _>("username"), "testuser");
        assert!(user.get::<Option<String>, _>("email").is_none());
    }

    #[tokio::test]
    async fn test_normalize_sql_function() {
        assert_eq!(
            normalize_sql("CREATE TABLE test( -- comment\n  id INTEGER )"),
            "CREATE TABLE test(id INTEGER)"
        );

        assert_eq!(
            normalize_sql("CREATE TABLE \"quoted\"(id INTEGER)"),
            "CREATE TABLE quoted(id INTEGER)"
        );
    }

    #[tokio::test]
    async fn test_column_deletion_forbidden() {
        let pool = create_test_db().await;

        // Start with table that has username column
        sqlx::raw_sql(SINGLE_TABLE_SCHEMA)
            .execute(&pool)
            .await
            .unwrap();

        // Try to remove username column without permission
        let result =
            migrate_database_declaratively(pool.clone(), COLUMN_REMOVAL_SCHEMA, false).await;
        assert!(
            result.is_err(),
            "Should fail when trying to remove column without permission"
        );

        let error_msg = format!("{}", result.unwrap_err());
        assert!(
            error_msg.contains("username"),
            "Error should mention the column being removed"
        );
        assert!(
            error_msg.contains("allow_deletions=true"),
            "Error should mention permission issue"
        );

        // Original table should be unchanged
        let columns = sqlx::query("PRAGMA table_info(users)")
            .fetch_all(&pool)
            .await
            .unwrap();
        let column_names: Vec<String> = columns
            .iter()
            .map(|row| row.get::<String, _>("name"))
            .collect();
        assert!(
            column_names.contains(&"username".to_string()),
            "Original column should still exist"
        );
    }

    #[tokio::test]
    async fn test_column_deletion_allowed() {
        let pool = create_test_db().await;

        // Start with table that has username column
        sqlx::raw_sql(SINGLE_TABLE_SCHEMA)
            .execute(&pool)
            .await
            .unwrap();

        let result =
            migrate_database_declaratively(pool.clone(), COLUMN_REMOVAL_SCHEMA, true).await;

        assert!(result.is_ok(), "Should succeed when deletions are allowed");
        assert!(result.unwrap(), "Should report changes made");

        // Username column should be gone
        let columns = sqlx::query("PRAGMA table_info(users)")
            .fetch_all(&pool)
            .await
            .unwrap();
        let column_names: Vec<String> = columns
            .iter()
            .map(|row| row.get::<String, _>("name"))
            .collect();
        assert!(
            !column_names.contains(&"username".to_string()),
            "Username column should be removed"
        );
        assert!(
            column_names.contains(&"id".to_string()),
            "ID column should remain"
        );
    }

    #[tokio::test]
    async fn test_table_deletion_forbidden() {
        let pool = create_test_db().await;

        // Start with two tables
        sqlx::raw_sql(TWO_TABLE_SCHEMA)
            .execute(&pool)
            .await
            .unwrap();

        // Try to remove posts table without permission
        let result = migrate_database_declaratively(pool.clone(), SINGLE_TABLE_SCHEMA, false).await;
        assert!(
            result.is_err(),
            "Should fail when trying to remove table without permission"
        );

        let error_msg = format!("{}", result.unwrap_err());
        assert!(
            error_msg.contains("posts") || error_msg.contains("tables"),
            "Error should mention table deletion"
        );
        assert!(
            error_msg.contains("allow_deletions=true"),
            "Error should mention permission issue"
        );

        // Both tables should still exist
        let tables = get_table_names(&pool).await;
        assert_eq!(tables, vec!["posts", "users"]);
    }

    #[tokio::test]
    async fn test_index_deletion_forbidden() {
        let pool = create_test_db().await;

        // Start with table and index
        sqlx::raw_sql(WITH_INDEX_SCHEMA)
            .execute(&pool)
            .await
            .unwrap();

        // Try to remove index without permission
        let result =
            migrate_database_declaratively(pool.clone(), WITHOUT_INDEX_SCHEMA, false).await;
        assert!(
            result.is_err(),
            "Should fail when trying to remove index without permission"
        );

        let error_msg = format!("{}", result.unwrap_err());
        assert!(
            error_msg.contains("idx_username") || error_msg.contains("indices"),
            "Error should mention index deletion"
        );

        // Index should still exist
        let indices = sqlx::query(
            "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_username'",
        )
        .fetch_all(&pool)
        .await
        .unwrap();
        assert_eq!(indices.len(), 1, "Index should still exist");
    }

    #[tokio::test]
    async fn test_index_deletion_allowed() {
        let pool = create_test_db().await;

        // Start with table and index
        sqlx::raw_sql(WITH_INDEX_SCHEMA)
            .execute(&pool)
            .await
            .unwrap();

        // Remove index with permission
        let result = migrate_database_declaratively(pool.clone(), WITHOUT_INDEX_SCHEMA, true).await;

        assert!(result.is_ok(), "Should succeed when deletions are allowed");
        assert!(result.unwrap(), "Should report changes made");

        // Index should be gone
        let indices = sqlx::query(
            "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_username'",
        )
        .fetch_all(&pool)
        .await
        .unwrap();
        assert_eq!(indices.len(), 0, "Index should be removed");
    }

    #[tokio::test]
    async fn test_multiple_deletions_forbidden() {
        let pool = create_test_db().await;

        // Start with complex schema
        sqlx::raw_sql(
            r#"
        CREATE TABLE users (
            id INTEGER PRIMARY KEY,
            username TEXT NOT NULL,
            email TEXT
        );
        
        CREATE TABLE posts (
            id INTEGER PRIMARY KEY,
            title TEXT NOT NULL,
            user_id INTEGER,
            FOREIGN KEY (user_id) REFERENCES users (id)
        );
        
        CREATE INDEX idx_username ON users(username);
    "#,
        )
        .execute(&pool)
        .await
        .unwrap();

        // Try to migrate to schema that removes table, column, and index
        let result = migrate_database_declaratively(
            pool.clone(),
            r#"
        CREATE TABLE users (
            id INTEGER PRIMARY KEY
            -- removed username and email columns
        );
        -- removed posts table and index
    "#,
            false,
        )
        .await;

        assert!(
            result.is_err(),
            "Should fail when trying multiple deletions without permission"
        );

        let error_msg = format!("{}", result.unwrap_err());
        // Should mention some kind of deletion issue
        assert!(
            error_msg.contains("allow_deletions=false") || error_msg.contains("Refusing to"),
            "Error should mention deletion restrictions"
        );
    }

    #[tokio::test]
    async fn test_data_preservation_during_column_removal() {
        let pool = create_test_db().await;

        // Start with table and add data
        sqlx::raw_sql(
            r#"
        CREATE TABLE users (
            id INTEGER PRIMARY KEY,
            username TEXT NOT NULL,
            email TEXT
        );
    "#,
        )
        .execute(&pool)
        .await
        .unwrap();

        sqlx::query("INSERT INTO users (username, email) VALUES (?, ?)")
            .bind("testuser")
            .bind("test@example.com")
            .execute(&pool)
            .await
            .unwrap();

        // Remove email column
        let result = migrate_database_declaratively(pool.clone(), SINGLE_TABLE_SCHEMA, true).await;

        assert!(result.is_ok(), "Should succeed with deletions allowed");

        // Check data is preserved for remaining columns
        let user = sqlx::query("SELECT id, username FROM users WHERE username = ?")
            .bind("testuser")
            .fetch_one(&pool)
            .await
            .unwrap();

        assert_eq!(user.get::<String, _>("username"), "testuser");
        assert!(user.get::<i64, _>("id") > 0);

        // Email column should be gone
        let columns = sqlx::query("PRAGMA table_info(users)")
            .fetch_all(&pool)
            .await
            .unwrap();
        let column_names: Vec<String> = columns
            .iter()
            .map(|row| row.get::<String, _>("name"))
            .collect();
        assert!(!column_names.contains(&"email".to_string()));
    }

    #[tokio::test]
    async fn test_rebuild_parent_with_existing_child_rows() {
        // Regression: production crashed with "FOREIGN KEY constraint failed"
        // when a parent table was rebuilt (column added) while an existing
        // child table held rows referencing it. defer_foreign_keys=TRUE was
        // not sufficient to keep the deferred FK check happy at COMMIT.
        let pool = create_test_db().await;

        sqlx::raw_sql(
            r#"
            CREATE TABLE users (
                id INTEGER PRIMARY KEY,
                username TEXT NOT NULL UNIQUE
            );
            CREATE TABLE posts (
                id INTEGER PRIMARY KEY,
                user_id INTEGER,
                FOREIGN KEY (user_id) REFERENCES users (id)
            );
            "#,
        )
        .execute(&pool)
        .await
        .unwrap();

        sqlx::query("INSERT INTO users (id, username) VALUES (1, 'alice')")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("INSERT INTO posts (id, user_id) VALUES (1, 1)")
            .execute(&pool)
            .await
            .unwrap();

        // Target schema: same shape, but users gets a new column (forces rebuild).
        let target = r#"
            CREATE TABLE users (
                id INTEGER PRIMARY KEY,
                username TEXT NOT NULL UNIQUE,
                email TEXT
            );
            CREATE TABLE posts (
                id INTEGER PRIMARY KEY,
                user_id INTEGER,
                FOREIGN KEY (user_id) REFERENCES users (id)
            );
        "#;

        let result = migrate_database_declaratively(pool.clone(), target, false).await;
        assert!(
            result.is_ok(),
            "Rebuilding users while posts has rows referencing it should not fail: {:?}",
            result.err()
        );

        let row = sqlx::query("SELECT user_id FROM posts WHERE id = 1")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(row.get::<i64, _>("user_id"), 1);

        let violations = sqlx::query("PRAGMA foreign_key_check")
            .fetch_all(&pool)
            .await
            .unwrap();
        assert!(
            violations.is_empty(),
            "No FK violations should remain after migration"
        );
    }

    #[tokio::test]
    async fn test_pre_existing_fk_orphan_tolerated_across_rebuild() {
        // A FK orphan that exists BEFORE a migration must not block it: the
        // migration is only responsible for violations it introduces.
        let pool = create_test_db().await;
        sqlx::raw_sql(
            r#"
            CREATE TABLE users (
                id INTEGER PRIMARY KEY,
                username TEXT NOT NULL
            );
            CREATE TABLE posts (
                id INTEGER PRIMARY KEY,
                user_id INTEGER,
                FOREIGN KEY (user_id) REFERENCES users (id)
            );
            "#,
        )
        .execute(&pool)
        .await
        .unwrap();

        // Seed the orphan with FK enforcement off (sqlx turns foreign_keys ON
        // by default), the way historical FK-off operations created the real
        // dirt we now tolerate. raw_sql runs the batch on one connection so the
        // PRAGMA applies to the inserts. user_id 999 has no matching user.
        sqlx::raw_sql(
            "PRAGMA foreign_keys = OFF;\
             INSERT INTO users (id, username) VALUES (1, 'alice');\
             INSERT INTO posts (id, user_id) VALUES (1, 999);",
        )
        .execute(&pool)
        .await
        .unwrap();

        // Adding `email` rebuilds users. The pre-existing posts->users orphan
        // must NOT block the rebuild.
        let target = r#"
            CREATE TABLE users (
                id INTEGER PRIMARY KEY,
                username TEXT NOT NULL,
                email TEXT
            );
            CREATE TABLE posts (
                id INTEGER PRIMARY KEY,
                user_id INTEGER,
                FOREIGN KEY (user_id) REFERENCES users (id)
            );
        "#;
        let result = migrate_database_declaratively(pool.clone(), target, false).await;
        assert!(
            result.is_ok(),
            "pre-existing FK orphan must be tolerated across a rebuild: {:?}",
            result.err()
        );

        // Schema change applied, and the orphan survived (not silently deleted).
        let cols = sqlx::query("PRAGMA table_info(users)")
            .fetch_all(&pool)
            .await
            .unwrap();
        assert!(cols.iter().any(|r| r.get::<String, _>("name") == "email"));
        let orphan: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM posts WHERE user_id = 999")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(orphan, 1, "the pre-existing orphan should survive untouched");
    }

    #[tokio::test]
    async fn test_migration_introducing_fk_violations_fails() {
        // A migration that orphans existing rows (a new FK column whose default
        // points at a missing parent) MUST fail and roll back.
        let pool = create_test_db().await;
        sqlx::raw_sql(
            r#"
            CREATE TABLE users (
                id INTEGER PRIMARY KEY,
                username TEXT NOT NULL
            );
            CREATE TABLE posts (
                id INTEGER PRIMARY KEY,
                title TEXT NOT NULL,
                user_id INTEGER,
                FOREIGN KEY (user_id) REFERENCES users (id)
            );
            "#,
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query("INSERT INTO users (id, username) VALUES (1, 'alice')")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("INSERT INTO posts (id, title, user_id) VALUES (1, 't', 1)")
            .execute(&pool)
            .await
            .unwrap();

        // Rebuild posts with a new NOT NULL FK column defaulting to a missing
        // category -> every existing post becomes an orphan posts->categories.
        let target = r#"
            CREATE TABLE users (
                id INTEGER PRIMARY KEY,
                username TEXT NOT NULL
            );
            CREATE TABLE categories (
                id INTEGER PRIMARY KEY
            );
            CREATE TABLE posts (
                id INTEGER PRIMARY KEY,
                title TEXT NOT NULL,
                user_id INTEGER,
                category_id INTEGER NOT NULL DEFAULT 5 REFERENCES categories (id),
                FOREIGN KEY (user_id) REFERENCES users (id)
            );
        "#;
        let result = migrate_database_declaratively(pool.clone(), target, false).await;
        assert!(result.is_err(), "introducing FK violations must fail");
        let msg = format!("{:?}", result.err().unwrap());
        assert!(
            msg.contains("introduced"),
            "error should name introduced violations: {msg}"
        );

        // Rolled back: posts must not have the new category_id column.
        let cols = sqlx::query("PRAGMA table_info(posts)")
            .fetch_all(&pool)
            .await
            .unwrap();
        assert!(
            !cols.iter().any(|r| r.get::<String, _>("name") == "category_id"),
            "failed migration must roll back the posts rebuild"
        );
    }
}
