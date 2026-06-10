//! Activity read side. Owns the per-viewer unread rule, the ActivityRow shape,
//! cursor operations (Task 20), and in later tasks the keyset-paginated feed
//! query and unread-count query. All SQL functions require sqlx-prepare after
//! any change.

use chrono::NaiveDateTime;
use serde::Serialize;
use sqlx::{Pool, Sqlite};

use crate::auth::Role;
use crate::db::activity::Verb;
use crate::error::AppError;

/// The PR-1 derived notify rule, viewer-relative. `in_feed` is supplied by the
/// feed query (target_student_id = viewer for a student; actor != viewer for a
/// coach). Unknown verbs are treated as non-notifiable.
pub fn notifies(verb: &str, actor_user_id: i64, viewer_id: i64, in_feed: bool) -> bool {
    let notifiable = Verb::from_str_verb(verb)
        .map(|v| v.notifiable())
        .unwrap_or(false);
    notifiable && actor_user_id != viewer_id && in_feed
}

/// One row rendered into a feed. Joined names are nullable because the entity
/// FK may have been SET NULL by a deletion (greyed history).
/// Used by Tasks 21+ (feed query).
#[allow(dead_code)]
#[derive(Debug, Serialize)]
pub struct ActivityRow {
    pub id: i64,
    pub occurred_at: String,
    pub verb: String,
    pub actor_user_id: i64,
    pub actor_name: Option<String>,
    pub target_student_id: Option<i64>,
    pub technique_id: Option<i64>,
    pub technique_name: Option<String>,
    pub syllabus_id: Option<i64>,
    pub syllabus_name: Option<String>,
    pub sst_id: Option<i64>,
    pub video_id: Option<i64>,
    pub video_title: Option<String>,
    pub payload_json: Option<String>,
    pub unread: bool,
}

// NaiveDateTime is used in Task 21+ for keyset pagination.
#[allow(dead_code)]
fn _uses_naive_datetime(_: NaiveDateTime) {}

/// Return the current `max_seen_id` for `viewer`, or 0 if no cursor row exists.
pub async fn current_max_seen(pool: &Pool<Sqlite>, viewer: i64) -> Result<i64, AppError> {
    let val = sqlx::query_scalar!(
        r#"SELECT max_seen_id AS "m!: i64" FROM activity_cursors WHERE viewer_user_id = ?"#,
        viewer
    )
    .fetch_optional(pool)
    .await?
    .unwrap_or(0);
    Ok(val)
}

/// Snapshot MAX(id) over the viewer's feed. Student: rows targeting that
/// student. Coach: rows from any actor other than the viewer. Returns 0 if the
/// feed is empty.
pub async fn feed_max_id(pool: &Pool<Sqlite>, viewer: i64, role: Role) -> Result<i64, AppError> {
    let max_id = match role {
        Role::Student => {
            sqlx::query_scalar!(
                r#"SELECT COALESCE(MAX(id), 0) AS "m!: i64"
                   FROM activity
                   WHERE target_student_id = ?"#,
                viewer
            )
            .fetch_one(pool)
            .await?
        }
        Role::Coach | Role::Admin => {
            sqlx::query_scalar!(
                r#"SELECT COALESCE(MAX(id), 0) AS "m!: i64"
                   FROM activity
                   WHERE actor_user_id != ?"#,
                viewer
            )
            .fetch_one(pool)
            .await?
        }
    };
    Ok(max_id)
}

/// Upsert `activity_cursors` so `max_seen_id` is at least `new_max`, then GC
/// `seen=1` overrides at or below the new cursor value for `viewer`.
pub async fn advance_cursor_to(
    pool: &Pool<Sqlite>,
    viewer: i64,
    new_max: i64,
) -> Result<(), AppError> {
    sqlx::query!(
        "INSERT INTO activity_cursors (viewer_user_id, max_seen_id, updated_at)
         VALUES (?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT (viewer_user_id) DO UPDATE SET
            max_seen_id = MAX(max_seen_id, excluded.max_seen_id),
            updated_at  = CURRENT_TIMESTAMP",
        viewer,
        new_max,
    )
    .execute(pool)
    .await?;

    // GC: delete seen=1 overrides that are now redundant (id <= cursor).
    let max_seen_id_after = current_max_seen(pool, viewer).await?;
    sqlx::query!(
        "DELETE FROM activity_seen_overrides
         WHERE viewer_user_id = ? AND seen = 1 AND activity_id <= ?",
        viewer,
        max_seen_id_after,
    )
    .execute(pool)
    .await?;

    Ok(())
}

/// Advance the cursor to the current global MAX(activity.id), then GC.
/// Effectively marks every activity row as seen.
pub async fn mark_all_read(pool: &Pool<Sqlite>, viewer: i64) -> Result<(), AppError> {
    let global_max =
        sqlx::query_scalar!(r#"SELECT COALESCE(MAX(id), 0) AS "m!: i64" FROM activity"#)
            .fetch_one(pool)
            .await?;
    advance_cursor_to(pool, viewer, global_max).await
}

/// Upsert an override marking a single activity row as seen for `viewer`.
pub async fn mark_one_read(
    pool: &Pool<Sqlite>,
    viewer: i64,
    activity_id: i64,
) -> Result<(), AppError> {
    sqlx::query!(
        "INSERT OR REPLACE INTO activity_seen_overrides (viewer_user_id, activity_id, seen)
         VALUES (?, ?, 1)",
        viewer,
        activity_id,
    )
    .execute(pool)
    .await?;
    Ok(())
}

/// Mark a single activity row as unread for `viewer`. No-op if the row is
/// already unread (activity_id > cursor AND no seen=1 override). Otherwise
/// upsert a seen=0 override.
pub async fn mark_one_unread(
    pool: &Pool<Sqlite>,
    viewer: i64,
    activity_id: i64,
) -> Result<(), AppError> {
    let cursor = current_max_seen(pool, viewer).await?;

    let has_seen1 = sqlx::query_scalar!(
        r#"SELECT COUNT(*) AS "c!: i64" FROM activity_seen_overrides
           WHERE viewer_user_id = ? AND activity_id = ? AND seen = 1"#,
        viewer,
        activity_id,
    )
    .fetch_one(pool)
    .await?;

    if activity_id > cursor && has_seen1 == 0 {
        // Already unread via the cursor; a seen=0 override would never be GC'd
        // and adds no semantic value.
        return Ok(());
    }

    sqlx::query!(
        "INSERT OR REPLACE INTO activity_seen_overrides (viewer_user_id, activity_id, seen)
         VALUES (?, ?, 0)",
        viewer,
        activity_id,
    )
    .execute(pool)
    .await?;
    Ok(())
}
