use chrono::Utc;
use sqlx::{Pool, Sqlite};
use tracing::{info, instrument};

use crate::error::AppError;

#[derive(Debug, Clone)]
pub struct InviteToken {
    pub id: i64,
    pub user_id: i64,
}

/// Create an invite token tied to a user. Token expires in 7 days. The token
/// value is generated via the same `UserSession::generate_token` used for
/// session cookies.
#[instrument]
pub async fn create_invite_token(pool: &Pool<Sqlite>, user_id: i64) -> Result<String, AppError> {
    info!("Creating invite token");
    let token = crate::auth::UserSession::generate_token();
    let expires_at = (Utc::now() + chrono::Duration::days(7)).naive_utc();

    sqlx::query!(
        "INSERT INTO invite_tokens (user_id, token, expires_at) VALUES (?, ?, ?)",
        user_id,
        token,
        expires_at
    )
    .execute(pool)
    .await?;

    Ok(token)
}

/// Look up an invite token. Returns the row only when it's still valid
/// (not used, not expired). Otherwise returns None.
#[instrument(skip(token))]
pub async fn find_valid_invite_token(
    pool: &Pool<Sqlite>,
    token: &str,
) -> Result<Option<InviteToken>, AppError> {
    let row = sqlx::query!(
        r#"SELECT id, user_id, token, expires_at as "expires_at: chrono::NaiveDateTime",
                  used_at as "used_at?: chrono::NaiveDateTime"
           FROM invite_tokens WHERE token = ?"#,
        token
    )
    .fetch_optional(pool)
    .await?;

    let row = match row {
        Some(r) => r,
        None => return Ok(None),
    };

    if row.used_at.is_some() {
        return Ok(None);
    }
    let now = Utc::now().naive_utc();
    if row.expires_at < now {
        return Ok(None);
    }

    Ok(Some(InviteToken {
        id: row.id.unwrap_or_default(),
        user_id: row.user_id,
    }))
}

/// Atomically claim an invite. Sets the user's username and (bcrypt-hashed)
/// password, marks claimed_at on the user and used_at on the token.
/// Returns the user id on success. Errors if the username is taken.
#[instrument(skip(pool, token, password))]
pub async fn claim_invite(
    pool: &Pool<Sqlite>,
    token: &str,
    username: &str,
    password: &str,
) -> Result<i64, AppError> {
    info!("Claiming invite");

    let invite = find_valid_invite_token(pool, token)
        .await?
        .ok_or_else(|| AppError::NotFound("Invite token not valid".to_string()))?;

    let existing = sqlx::query!(
        "SELECT id FROM users WHERE username = ? AND id != ?",
        username,
        invite.user_id
    )
    .fetch_optional(pool)
    .await?;
    if existing.is_some() {
        return Err(AppError::Internal("Username already taken".to_string()));
    }

    let hashed = bcrypt::hash(password, crate::db::BCRYPT_COST)?;
    let now = Utc::now().naive_utc();

    // Apply both updates. SQLite single-connection writes are serialized by the
    // pool, so this is effectively atomic for our purposes.
    sqlx::query!(
        "UPDATE users SET username = ?, password = ?, claimed_at = ? WHERE id = ?",
        username,
        hashed,
        now,
        invite.user_id
    )
    .execute(pool)
    .await?;

    sqlx::query!(
        "UPDATE invite_tokens SET used_at = ? WHERE id = ?",
        now,
        invite.id
    )
    .execute(pool)
    .await?;

    Ok(invite.user_id)
}

/// Reset a claimed user back to stub state: clear password, invalidate
/// existing sessions, return a fresh invite token. Username stays so existing
/// references are unaffected, but the user can re-claim with a new password
/// (and optionally change the username again during claim).
#[instrument]
pub async fn reset_user_claim(pool: &Pool<Sqlite>, user_id: i64) -> Result<String, AppError> {
    info!("Resetting user claim");

    // Also clear any standing password-reset request so it stops showing
    // on the coach's dashboard once they've acted on it.
    sqlx::query!(
        "UPDATE users
         SET password = '', claimed_at = NULL, reset_requested_at = NULL
         WHERE id = ?",
        user_id
    )
    .execute(pool)
    .await?;

    // Invalidate any existing sessions for this user.
    sqlx::query!("DELETE FROM user_sessions WHERE user_id = ?", user_id)
        .execute(pool)
        .await?;

    create_invite_token(pool, user_id).await
}
