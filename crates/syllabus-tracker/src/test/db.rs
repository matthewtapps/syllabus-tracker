#[cfg(test)]
mod tests {
    use crate::auth::Role;
    use crate::db::{create_user, find_user_by_username};

    use migration_engine::migrations::{
        migrate_database_declaratively, read_schema_file_to_string,
    };
    use rocket::tokio;
    use sqlx::{Pool, Sqlite, sqlite::SqlitePoolOptions};

    async fn setup_test_db() -> Pool<Sqlite> {
        // SCHEMA_PATH is read fresh here because under nextest each test runs
        // in its own process so we can't rely on TestDbBuilder having loaded it.
        crate::env::load_test_environment().expect("load test env");

        let pool = SqlitePoolOptions::new()
            .max_connections(5)
            .connect("sqlite::memory:")
            .await
            .expect("Failed to create in-memory database");

        let schema_path = dotenvy::var("SCHEMA_PATH").expect("SCHEMA_PATH not set");
        let schema = read_schema_file_to_string(std::path::Path::new(&schema_path))
            .expect("Failed to read schema file");

        let _ = migrate_database_declaratively(pool.clone(), &schema, false).await;

        pool
    }

    #[tokio::test]
    async fn test_get_user() {
        let pool = setup_test_db().await;

        let username = "test_user";
        let password = "password123";
        let display_name = "Test User";
        let role = "student";

        create_user(&pool, username, password, role, Some(display_name))
            .await
            .expect("Failed to create test user");

        let user = find_user_by_username(&pool, username)
            .await
            .expect("Failed to get user");

        match user {
            Some(user) => {
                assert_eq!(user.username, username);
                assert_eq!(user.role, Role::Student);
            }
            _ => panic!("User wasn't defined somehow"),
        }
    }
}
