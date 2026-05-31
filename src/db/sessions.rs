use chrono::{NaiveDateTime, Utc};
use sqlx::{Pool, Sqlite};
use tracing::{info, instrument};

use crate::auth::{DbUserSession, UserSession};
use crate::error::AppError;

#[instrument(skip(pool, token))]
pub async fn create_user_session(
    pool: &Pool<Sqlite>,
    user_id: i64,
    token: &str,
    expires_at: NaiveDateTime,
) -> Result<i64, AppError> {
    info!("Creating user session");

    let res = sqlx::query!(
        "INSERT INTO user_sessions (user_id, token, expires_at) VALUES (?, ?, ?)",
        user_id,
        token,
        expires_at
    )
    .execute(pool)
    .await?;

    Ok(res.last_insert_rowid())
}

#[instrument(skip(pool, token))]
pub async fn get_session_by_token(
    pool: &Pool<Sqlite>,
    token: &str,
) -> Result<UserSession, AppError> {
    info!("Getting session by token");

    let session = sqlx::query_as!(
        DbUserSession,
        "SELECT id, user_id, token, created_at, expires_at FROM user_sessions WHERE token = ?",
        token
    )
    .fetch_optional(pool)
    .await?;

    match session {
        Some(session) => Ok(UserSession::from(session)),
        _ => Err(AppError::Authentication(
            "Invalid session token".to_string(),
        )),
    }
}

#[instrument(skip(pool, token))]
pub async fn invalidate_session(pool: &Pool<Sqlite>, token: &str) -> Result<(), AppError> {
    info!("Invalidating session");

    sqlx::query!("DELETE FROM user_sessions WHERE token = ?", token)
        .execute(pool)
        .await?;

    Ok(())
}

#[instrument(skip(pool))]
pub async fn clean_expired_sessions(pool: &Pool<Sqlite>) -> Result<u64, AppError> {
    info!("Cleaning expired sessions");

    let now = Utc::now().naive_utc();

    let result = sqlx::query!("DELETE FROM user_sessions WHERE expires_at < ?", now)
        .execute(pool)
        .await?;

    Ok(result.rows_affected())
}
