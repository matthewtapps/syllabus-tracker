use std::str::FromStr;

use chrono::Utc;
use sqlx::{Pool, Sqlite};
use tracing::{info, instrument};

use crate::auth::{DbUser, Role, User};
use crate::error::AppError;

#[instrument]
pub async fn get_user(pool: &Pool<Sqlite>, id: i64) -> Result<User, AppError> {
    info!("Fetching user by ID");
    let row = sqlx::query_as!(
        DbUser,
        "SELECT id, username, role, display_name, archived, graduated_at, email, claimed_at, approved_at, first_name, last_name, reset_requested_at FROM users WHERE id=?",
        id
    )
    .fetch_optional(pool)
    .await?;

    match row {
        Some(user) => Ok(User::from(user)),
        _ => Err(AppError::NotFound(format!(
            "User with id {} not found in database",
            id
        ))),
    }
}

#[instrument]
pub async fn update_user_display_name(
    pool: &Pool<Sqlite>,
    user_id: i64,
    display_name: &str,
) -> Result<(), AppError> {
    info!("Updating user display name");
    sqlx::query!(
        "UPDATE users SET display_name = ? WHERE id = ?",
        display_name,
        user_id
    )
    .execute(pool)
    .await?;

    Ok(())
}

#[instrument(skip(pool, new_password))]
pub async fn update_user_password(
    pool: &Pool<Sqlite>,
    user_id: i64,
    new_password: &str,
) -> Result<(), AppError> {
    info!("Updating user password");
    let hashed_password = bcrypt::hash(new_password, crate::db::BCRYPT_COST)?;

    sqlx::query!(
        "UPDATE users SET password = ? WHERE id = ?",
        hashed_password,
        user_id
    )
    .execute(pool)
    .await?;

    Ok(())
}

#[instrument]
pub async fn update_username(
    pool: &Pool<Sqlite>,
    user_id: i64,
    new_username: &str,
) -> Result<(), AppError> {
    info!("Updating user username");
    let existing_user = sqlx::query!(
        "SELECT id FROM users WHERE username = ? AND id != ?",
        new_username,
        user_id
    )
    .fetch_optional(pool)
    .await?;

    if existing_user.is_some() {
        return Err(AppError::Internal(
            "Uncaught username validation error".to_string(),
        ));
    }

    sqlx::query!(
        "UPDATE users SET username = ? WHERE id = ?",
        new_username,
        user_id
    )
    .execute(pool)
    .await?;

    Ok(())
}

#[instrument(skip(pool, password))]
pub async fn authenticate_user(
    pool: &Pool<Sqlite>,
    username: &str,
    password: &str,
) -> Result<Option<User>, AppError> {
    let user_auth = sqlx::query!(
        r#"SELECT id, username, password, role, display_name, archived,
                  email, first_name, last_name,
                  graduated_at as "graduated_at?: chrono::NaiveDateTime",
                  claimed_at as "claimed_at?: chrono::NaiveDateTime",
                  approved_at as "approved_at?: chrono::NaiveDateTime",
                  reset_requested_at as "reset_requested_at?: chrono::NaiveDateTime"
           FROM users WHERE username = ?"#,
        username
    )
    .fetch_optional(pool)
    .await?;

    match user_auth {
        Some(user) => {
            // Stub (unclaimed) users have an empty password. bcrypt::verify
            // would error on a non-hash, so short-circuit cleanly here.
            if user.password.is_empty() {
                return Ok(None);
            }
            if bcrypt::verify(password, &user.password)? {
                let to_iso = |dt: chrono::NaiveDateTime| {
                    chrono::DateTime::<Utc>::from_naive_utc_and_offset(dt, Utc).to_rfc3339()
                };
                Ok(Some(User {
                    id: user.id.unwrap(),
                    username: user.username.clone().unwrap_or_default(),
                    role: Role::from_str(&user.role)?,
                    display_name: user.display_name.unwrap_or_default(),
                    archived: user.archived,
                    graduated_at: user.graduated_at.map(to_iso),
                    email: user.email,
                    claimed_at: user.claimed_at.map(to_iso),
                    approved_at: user.approved_at.map(to_iso),
                    first_name: user.first_name,
                    last_name: user.last_name,
                    reset_requested_at: user.reset_requested_at.map(to_iso),
                    last_update: None,
                    last_coach_update_at: None,
                    total_techniques: None,
                    red_count: None,
                    amber_count: None,
                    green_count: None,
                    has_unseen_activity: None,
                    last_student_initiative_at: None,
                    last_watch_at: None,
                    last_watch_video_title: None,
                }))
            } else {
                Ok(None)
            }
        }
        None => Ok(None),
    }
}

#[instrument(skip(pool, password))]
pub async fn create_user(
    pool: &Pool<Sqlite>,
    username: &str,
    password: &str,
    role: &str,
    display_name: Option<&str>,
) -> Result<i64, AppError> {
    info!("Creating new user");

    let existing_user = sqlx::query!("SELECT id FROM users WHERE username = ?", username)
        .fetch_optional(pool)
        .await?;

    if existing_user.is_some() {
        return Err(AppError::Internal(
            "Uncaught username validation error".to_string(),
        ));
    }

    let hashed_password = bcrypt::hash(password, crate::db::BCRYPT_COST)?;

    let res = sqlx::query!(
        "INSERT INTO users (username, display_name, password, role) VALUES (?, ?, ?, ?)",
        username,
        display_name,
        hashed_password,
        role
    )
    .execute(pool)
    .await?;

    Ok(res.last_insert_rowid())
}

pub async fn find_user_by_username(
    pool: &Pool<Sqlite>,
    username: &str,
) -> Result<Option<User>, AppError> {
    let row = sqlx::query_as!(
        DbUser,
        "SELECT id, username, role, display_name, archived, graduated_at, email, claimed_at, approved_at, first_name, last_name, reset_requested_at FROM users WHERE username = ?",
        username
    )
    .fetch_optional(pool)
    .await?;

    Ok(row.map(User::from))
}

#[instrument]
pub async fn get_users_by_role(
    pool: &Pool<Sqlite>,
    role: &str,
    show_archived: bool,
) -> Result<Vec<User>, AppError> {
    info!(role = %role, show_archived = %show_archived, "Getting users by role");

    let query = if show_archived {
        "SELECT id, username, role, display_name, archived, graduated_at, email, claimed_at, approved_at, first_name, last_name, reset_requested_at FROM users WHERE role = ?"
    } else {
        "SELECT id, username, role, display_name, archived, graduated_at, email, claimed_at, approved_at, first_name, last_name, reset_requested_at FROM users WHERE role = ? AND archived IS 0"
    };

    let rows = sqlx::query_as::<_, DbUser>(query)
        .bind(role)
        .fetch_all(pool)
        .await?;

    Ok(rows.into_iter().map(User::from).collect())
}

#[instrument]
pub async fn get_all_users(pool: &Pool<Sqlite>) -> Result<Vec<User>, AppError> {
    let rows = sqlx::query_as::<_, DbUser>("SELECT * FROM Users")
        .fetch_all(pool)
        .await?;

    let users: Vec<User> = rows.into_iter().map(User::from).collect();

    if users.is_empty() {
        return Err(AppError::NotFound("No users found".to_string()));
    }

    Ok(users)
}

#[instrument]
pub async fn update_user_admin(
    pool: &Pool<Sqlite>,
    user_id: i64,
    username: &str,
    display_name: &str,
    role: &str,
) -> Result<(), AppError> {
    info!("Admin updating user");

    let existing_user = sqlx::query!(
        "SELECT id FROM users WHERE username = ? AND id != ?",
        username,
        user_id
    )
    .fetch_optional(pool)
    .await?;

    if existing_user.is_some() {
        return Err(AppError::Internal(
            "Uncaught username validation error".to_string(),
        ));
    }

    sqlx::query!(
        "UPDATE users SET username = ?, display_name = ?, role = ? WHERE id = ?",
        username,
        display_name,
        role,
        user_id
    )
    .execute(pool)
    .await?;

    Ok(())
}

#[instrument]
pub async fn set_user_graduated(
    pool: &Pool<Sqlite>,
    user_id: i64,
    graduated: bool,
    actor_id: Option<i64>,
) -> Result<bool, AppError> {
    info!("Setting graduated state");

    if graduated {
        let now = Utc::now().naive_utc();
        sqlx::query!(
            "UPDATE users SET graduated_at = ?, graduated_by_id = ? WHERE id = ?",
            now,
            actor_id,
            user_id
        )
        .execute(pool)
        .await?;
    } else {
        sqlx::query!(
            "UPDATE users SET graduated_at = NULL, graduated_by_id = NULL WHERE id = ?",
            user_id
        )
        .execute(pool)
        .await?;
    }

    Ok(graduated)
}

/// Create a self-registered student. Username and password are set;
/// claimed_at is now; approved_at is NULL until a coach approves.
#[instrument(skip(pool, password))]
pub async fn create_self_registered_user(
    pool: &Pool<Sqlite>,
    username: &str,
    password: &str,
    first_name: Option<&str>,
    last_name: Option<&str>,
) -> Result<i64, AppError> {
    info!("Self-registering user");

    let existing = sqlx::query!("SELECT id FROM users WHERE username = ?", username)
        .fetch_optional(pool)
        .await?;
    if existing.is_some() {
        return Err(AppError::Internal("Username already taken".to_string()));
    }

    let hashed = bcrypt::hash(password, crate::db::BCRYPT_COST)?;
    let display_name = match (first_name, last_name) {
        (Some(f), Some(l)) => format!("{} {}", f, l),
        (Some(f), None) => f.to_string(),
        (None, Some(l)) => l.to_string(),
        (None, None) => username.to_string(),
    };
    let now = Utc::now().naive_utc();

    let res = sqlx::query!(
        "INSERT INTO users
            (username, password, role, display_name, first_name, last_name, claimed_at)
         VALUES (?, ?, 'student', ?, ?, ?, ?)",
        username,
        hashed,
        display_name,
        first_name,
        last_name,
        now
    )
    .execute(pool)
    .await?;

    Ok(res.last_insert_rowid())
}

/// Approve a self-registered user. Idempotent.
#[instrument]
pub async fn approve_user(pool: &Pool<Sqlite>, user_id: i64) -> Result<(), AppError> {
    info!("Approving user");
    let now = Utc::now().naive_utc();
    sqlx::query!(
        "UPDATE users SET approved_at = ? WHERE id = ? AND approved_at IS NULL",
        now,
        user_id
    )
    .execute(pool)
    .await?;
    Ok(())
}

/// Create a "stub" user: no username, no password, just display name and role.
/// Coaches use this to pre-populate a student's record before they claim.
#[instrument]
pub async fn create_user_stub(
    pool: &Pool<Sqlite>,
    display_name: &str,
    email: Option<&str>,
    role: &str,
) -> Result<i64, AppError> {
    info!("Creating stub user");
    // Coach-driven creates are implicitly approved.
    let now = Utc::now().naive_utc();
    let res = sqlx::query!(
        "INSERT INTO users (username, password, display_name, role, email, approved_at)
         VALUES (NULL, '', ?, ?, ?, ?)",
        display_name,
        role,
        email,
        now
    )
    .execute(pool)
    .await?;
    Ok(res.last_insert_rowid())
}

/// Flag a user as having requested a password reset. Silently no-ops if the
/// username doesn't exist (we don't want to leak whether usernames are real
/// to anonymous callers).
#[instrument]
pub async fn request_password_reset(
    pool: &Pool<Sqlite>,
    username: &str,
) -> Result<(), AppError> {
    info!("Recording password reset request");
    let now = Utc::now().naive_utc();
    sqlx::query!(
        "UPDATE users SET reset_requested_at = ? WHERE username = ?",
        now,
        username
    )
    .execute(pool)
    .await?;
    Ok(())
}

#[instrument]
pub async fn set_user_archived(
    pool: &Pool<Sqlite>,
    user_id: i64,
    archive: bool,
) -> Result<bool, AppError> {
    info!("Toggling user archived status");

    sqlx::query!(
        "UPDATE users SET archived = ? WHERE id = ?",
        archive,
        user_id
    )
    .execute(pool)
    .await?;

    Ok(archive)
}

#[instrument]
pub async fn update_user_role(
    pool: &Pool<Sqlite>,
    user_id: i64,
    role: &str,
) -> Result<(), AppError> {
    info!("Updating user role");
    sqlx::query!("UPDATE users SET role = ? WHERE id = ?", role, user_id)
        .execute(pool)
        .await?;

    Ok(())
}
