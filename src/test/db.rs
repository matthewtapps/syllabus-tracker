#[cfg(test)]
mod tests {
    use crate::auth::Role;
    use crate::db::{create_user, get_user_by_username};

    use rocket::tokio;
    use sqlx::{Pool, Sqlite, sqlite::SqlitePoolOptions};

    async fn setup_test_db() -> Pool<Sqlite> {
        let pool = SqlitePoolOptions::new()
            .max_connections(5)
            .connect("sqlite::memory:")
            .await
            .expect("Failed to create in-memory database");

        sqlx::migrate!("./migrations")
            .run(&pool)
            .await
            .expect("Failed to run migrations");

        pool
    }

    #[tokio::test]
    async fn test_get_user() {
        let pool = setup_test_db().await;

        let username = "test_user";
        let password = "password123";
        let role = "student";

        create_user(&pool, username, password, role)
            .await
            .expect("Failed to create test user");

        let user = get_user_by_username(&pool, username)
            .await
            .expect("Failed to get user");

        assert_eq!(user.username, username);
        assert_eq!(user.role, Role::Student);
    }
}
