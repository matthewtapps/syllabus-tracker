#[cfg(test)]
mod tests {
    use crate::auth::Role;
    use crate::db::{create_user, find_user_by_username};
    use crate::get_schema_string;

    use rocket::tokio;
    use sqlx::{Pool, Sqlite, sqlite::SqlitePoolOptions};
    use syllabus_tracker::lib::migrations::migrate_database_declaratively;

    async fn setup_test_db() -> Pool<Sqlite> {
        let pool = SqlitePoolOptions::new()
            .max_connections(5)
            .connect("sqlite::memory:")
            .await
            .expect("Failed to create in-memory database");

        let schema = get_schema_string();

        let _ = migrate_database_declaratively(pool.clone(), &schema).await;

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
