#[cfg(test)]
mod tests {
    use crate::{
        db::{
            clean_expired_sessions, create_user_session, get_session_by_token, invalidate_session,
        },
        error::AppError,
        test::test_db::TestDbBuilder,
    };
    use chrono::{Duration, NaiveDateTime, Utc};
    use rocket::tokio;
    use sqlx::{Pool, Sqlite, SqlitePool};
    use uuid::Uuid;

    async fn create_test_session() -> (i64, String, NaiveDateTime, Pool<Sqlite>) {
        let test_db = TestDbBuilder::new()
            .student("test_session_user", None)
            .build()
            .await
            .expect("Failed to build test database");

        let user_id = test_db
            .user_id("test_session_user")
            .expect("User not found");

        let token = format!("test_token_{}", Uuid::new_v4());

        let expires_at = (Utc::now() + Duration::hours(1)).naive_utc();

        (user_id, token, expires_at, test_db.pool)
    }

    #[tokio::test]
    async fn test_create_and_get_session() {
        let (user_id, token, expires_at, pool) = create_test_session().await;

        let session_id = create_user_session(&pool, user_id, &token, expires_at)
            .await
            .expect("Failed to create session");

        assert!(session_id > 0, "Session ID should be positive");

        let session = get_session_by_token(&pool, &token)
            .await
            .expect("Failed to get session");

        assert_eq!(session.user_id, user_id);
        assert_eq!(session.token, token);

        let expires_diff =
            (session.expires_at.and_utc().timestamp() - expires_at.and_utc().timestamp()).abs();
        assert!(
            expires_diff <= 1,
            "Expiration timestamps should match within 1 second"
        );
    }

    #[tokio::test]
    async fn test_get_nonexistent_session() {
        let pool = SqlitePool::connect("sqlite::memory:")
            .await
            .expect("Failed to create in-memory database");

        sqlx::migrate!("./migrations")
            .run(&pool)
            .await
            .expect("Failed to run migrations");

        let result = get_session_by_token(&pool, "nonexistent_token").await;

        assert!(result.is_err(), "Should return error for nonexistent token");

        if let Err(err) = result {
            match err {
                AppError::Authentication(msg) => {
                    assert_eq!(msg, "Invalid session token");
                }
                _ => panic!("Expected Authentication error, got {:?}", err),
            }
        }
    }

    #[tokio::test]
    async fn test_invalidate_session() {
        let (user_id, token, expires_at, pool) = create_test_session().await;

        // Create a session
        create_user_session(&pool, user_id, &token, expires_at)
            .await
            .expect("Failed to create session");

        // Verify it exists
        let session = get_session_by_token(&pool, &token).await;
        assert!(session.is_ok(), "Session should exist before invalidation");

        // Invalidate the session
        invalidate_session(&pool, &token)
            .await
            .expect("Failed to invalidate session");

        // Verify it no longer exists
        let result = get_session_by_token(&pool, &token).await;
        assert!(
            result.is_err(),
            "Session should not exist after invalidation"
        );
    }

    #[tokio::test]
    async fn test_clean_expired_sessions() {
        // Create a single database for all sessions
        let test_db = TestDbBuilder::new()
            .student("test_session_user", None)
            .build()
            .await
            .expect("Failed to build test database");

        let pool = test_db.pool.clone();
        let user_id = test_db
            .user_id("test_session_user")
            .expect("User not found");

        let token1 = format!("test_token_expired_{}", Uuid::new_v4());
        let token2 = format!("test_token_soon_{}", Uuid::new_v4());
        let token3 = format!("test_token_later_{}", Uuid::new_v4());

        let expired_at = (Utc::now() - Duration::hours(1)).naive_utc();
        create_user_session(&pool, user_id, &token1, expired_at)
            .await
            .expect("Failed to create expired session");

        let expires_soon = (Utc::now() + Duration::minutes(1)).naive_utc();
        create_user_session(&pool, user_id, &token2, expires_soon)
            .await
            .expect("Failed to create expiring soon session");

        let expires_later = (Utc::now() + Duration::days(1)).naive_utc();
        create_user_session(&pool, user_id, &token3, expires_later)
            .await
            .expect("Failed to create future session");

        let cleaned_count = clean_expired_sessions(&pool)
            .await
            .expect("Failed to clean expired sessions");

        assert_eq!(
            cleaned_count, 1,
            "Should have cleaned exactly 1 expired session"
        );

        let result1 = get_session_by_token(&pool, &token1).await;
        assert!(result1.is_err(), "Expired session should be removed");

        let result2 = get_session_by_token(&pool, &token2).await;
        assert!(result2.is_ok(), "Non-expired session should still exist");

        let result3 = get_session_by_token(&pool, &token3).await;
        assert!(result3.is_ok(), "Future session should still exist");
    }

    #[tokio::test]
    async fn test_session_validity() {
        let test_db = TestDbBuilder::new()
            .student("test_session_user", None)
            .build()
            .await
            .expect("Failed to build test database");

        let pool = test_db.pool.clone();
        let user_id = test_db
            .user_id("test_session_user")
            .expect("User not found");

        let expired_token = format!("test_token_expired_{}", Uuid::new_v4());
        let expired_at = (Utc::now() - Duration::hours(1)).naive_utc();

        create_user_session(&pool, user_id, &expired_token, expired_at)
            .await
            .expect("Failed to create expired session");

        let session = get_session_by_token(&pool, &expired_token)
            .await
            .expect("Should be able to retrieve expired session");

        assert!(!session.is_valid(), "Expired session should be invalid");

        let (user_id, token, expires_at, pool) = create_test_session().await;
        create_user_session(&pool, user_id, &token, expires_at)
            .await
            .expect("Failed to create valid session");

        let valid_session = get_session_by_token(&pool, &token)
            .await
            .expect("Should be able to retrieve valid session");

        assert!(valid_session.is_valid(), "Future session should be valid");
    }
}
