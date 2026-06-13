//! Activity read side. Owns the per-viewer unread rule, the ActivityRow shape,
//! cursor operations (Task 20), and the keyset-paginated feed query and
//! unread-count query. All SQL functions require sqlx-prepare after any change.

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
    pub thread_id: Option<i64>,
    pub payload_json: Option<String>,
    pub unread: bool,
    pub context_kind: Option<String>,
}

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

/// Return a keyset-paginated page of the viewer's activity feed.
///
/// Role predicate:
/// - Student: `target_student_id = viewer`
/// - Coach/Admin: `actor_user_id != viewer` (all gym activity except own rows)
///
/// Results are ordered `occurred_at DESC, id DESC`. Pass `before` to continue
/// after a previous page (keyset on `(occurred_at, id) < before`).
///
/// Each row's `unread` flag is set when the cursor/override logic marks the row
/// unread AND `notifies(verb, actor, viewer, true)` returns true.
///
/// Because the role predicate differs structurally, two query variants are
/// used (student vs coach). Each variant handles the optional `before` clause
/// via `IS NULL OR (...)` so sqlx offline cache only needs two entries.
pub async fn feed(
    pool: &Pool<Sqlite>,
    viewer: i64,
    role: Role,
    before: Option<(NaiveDateTime, i64)>,
    limit: i64,
) -> Result<Vec<ActivityRow>, AppError> {
    let (before_ts, before_id) = match before {
        Some((ts, id)) => (Some(ts), Some(id)),
        None => (None, None),
    };

    match role {
        Role::Student => {
            let rows = sqlx::query!(
                r#"SELECT act.id               AS "id!: i64",
                          act.occurred_at      AS "occurred_at!: String",
                          act.verb             AS "verb!: String",
                          act.actor_user_id    AS "actor_user_id!: i64",
                          u.display_name       AS "actor_name?: String",
                          act.target_student_id AS "target_student_id?: i64",
                          act.technique_id     AS "technique_id?: i64",
                          t.name               AS "technique_name?: String",
                          act.syllabus_id      AS "syllabus_id?: i64",
                          s.name               AS "syllabus_name?: String",
                          act.sst_id           AS "sst_id?: i64",
                          act.video_id         AS "video_id?: i64",
                          v.title              AS "video_title?: String",
                          act.thread_id        AS "thread_id?: i64",
                          act.payload_json     AS "payload_json?: String",
                          act.context_kind     AS "context_kind?: String",
                          CASE
                            WHEN ov.seen = 1 THEN 0
                            WHEN ov.seen = 0 THEN 1
                            WHEN act.id <= COALESCE(c.max_seen_id, 0) THEN 0
                            ELSE 1
                          END AS "is_after_cursor!: i64"
                   FROM activity act
                   LEFT JOIN users u      ON u.id = act.actor_user_id
                   LEFT JOIN techniques t ON t.id = act.technique_id
                   LEFT JOIN syllabi s    ON s.id = act.syllabus_id
                   LEFT JOIN videos v     ON v.id = act.video_id
                   LEFT JOIN activity_cursors c
                          ON c.viewer_user_id = ?
                   LEFT JOIN activity_seen_overrides ov
                          ON ov.viewer_user_id = ? AND ov.activity_id = act.id
                   WHERE act.target_student_id = ?
                     AND (? IS NULL OR (act.occurred_at, act.id) < (?, ?))
                   ORDER BY act.occurred_at DESC, act.id DESC
                   LIMIT ?"#,
                viewer,
                viewer,
                viewer,
                before_ts,
                before_ts,
                before_id,
                limit,
            )
            .fetch_all(pool)
            .await?;

            Ok(rows
                .into_iter()
                .map(|r| {
                    let is_after = r.is_after_cursor == 1;
                    let unread = is_after && notifies(&r.verb, r.actor_user_id, viewer, true);
                    ActivityRow {
                        id: r.id,
                        occurred_at: r.occurred_at,
                        verb: r.verb,
                        actor_user_id: r.actor_user_id,
                        actor_name: r.actor_name,
                        target_student_id: r.target_student_id,
                        technique_id: r.technique_id,
                        technique_name: r.technique_name,
                        syllabus_id: r.syllabus_id,
                        syllabus_name: r.syllabus_name,
                        sst_id: r.sst_id,
                        video_id: r.video_id,
                        video_title: r.video_title,
                        thread_id: r.thread_id,
                        payload_json: r.payload_json,
                        unread,
                        context_kind: r.context_kind,
                    }
                })
                .collect())
        }
        Role::Coach | Role::Admin => {
            let rows = sqlx::query!(
                r#"SELECT act.id               AS "id!: i64",
                          act.occurred_at      AS "occurred_at!: String",
                          act.verb             AS "verb!: String",
                          act.actor_user_id    AS "actor_user_id!: i64",
                          u.display_name       AS "actor_name?: String",
                          act.target_student_id AS "target_student_id?: i64",
                          act.technique_id     AS "technique_id?: i64",
                          t.name               AS "technique_name?: String",
                          act.syllabus_id      AS "syllabus_id?: i64",
                          s.name               AS "syllabus_name?: String",
                          act.sst_id           AS "sst_id?: i64",
                          act.video_id         AS "video_id?: i64",
                          v.title              AS "video_title?: String",
                          act.thread_id        AS "thread_id?: i64",
                          act.payload_json     AS "payload_json?: String",
                          act.context_kind     AS "context_kind?: String",
                          CASE
                            WHEN ov.seen = 1 THEN 0
                            WHEN ov.seen = 0 THEN 1
                            WHEN act.id <= COALESCE(c.max_seen_id, 0) THEN 0
                            ELSE 1
                          END AS "is_after_cursor!: i64"
                   FROM activity act
                   LEFT JOIN users u      ON u.id = act.actor_user_id
                   LEFT JOIN techniques t ON t.id = act.technique_id
                   LEFT JOIN syllabi s    ON s.id = act.syllabus_id
                   LEFT JOIN videos v     ON v.id = act.video_id
                   LEFT JOIN activity_cursors c
                          ON c.viewer_user_id = ?
                   LEFT JOIN activity_seen_overrides ov
                          ON ov.viewer_user_id = ? AND ov.activity_id = act.id
                   WHERE act.actor_user_id != ?
                     AND (? IS NULL OR (act.occurred_at, act.id) < (?, ?))
                   ORDER BY act.occurred_at DESC, act.id DESC
                   LIMIT ?"#,
                viewer,
                viewer,
                viewer,
                before_ts,
                before_ts,
                before_id,
                limit,
            )
            .fetch_all(pool)
            .await?;

            Ok(rows
                .into_iter()
                .map(|r| {
                    let is_after = r.is_after_cursor == 1;
                    let unread = is_after && notifies(&r.verb, r.actor_user_id, viewer, true);
                    ActivityRow {
                        id: r.id,
                        occurred_at: r.occurred_at,
                        verb: r.verb,
                        actor_user_id: r.actor_user_id,
                        actor_name: r.actor_name,
                        target_student_id: r.target_student_id,
                        technique_id: r.technique_id,
                        technique_name: r.technique_name,
                        syllabus_id: r.syllabus_id,
                        syllabus_name: r.syllabus_name,
                        sst_id: r.sst_id,
                        video_id: r.video_id,
                        video_title: r.video_title,
                        thread_id: r.thread_id,
                        payload_json: r.payload_json,
                        unread,
                        context_kind: r.context_kind,
                    }
                })
                .collect())
        }
    }
}

/// Seed every existing user's cursor to the current `MAX(activity.id)` so
/// pre-deploy history reads as already-seen. Idempotent: `INSERT OR IGNORE`
/// skips users who already have a cursor row. Returns the number of cursor rows
/// inserted (0 on a second run).
pub async fn run_cursor_init(pool: &Pool<Sqlite>) -> Result<i64, AppError> {
    let max_id = sqlx::query_scalar!(r#"SELECT COALESCE(MAX(id), 0) AS "m!: i64" FROM activity"#)
        .fetch_one(pool)
        .await?;

    let res = sqlx::query!(
        "INSERT OR IGNORE INTO activity_cursors (viewer_user_id, max_seen_id)
         SELECT id, ? FROM users",
        max_id,
    )
    .execute(pool)
    .await?;

    Ok(res.rows_affected() as i64)
}

/// Gym-wide recent student-engagement events for the coach dashboard glance.
/// Read-only: unlike the cursor-advancing `/activity/feed` route, this never
/// touches `activity_cursors`, so opening the dashboard does not clear the
/// navbar unread badge. `unread` is always false here (the dashboard does not
/// render unread styling).
pub async fn dashboard_activity_feed(
    pool: &Pool<Sqlite>,
    limit: i64,
) -> Result<Vec<ActivityRow>, AppError> {
    let rows = sqlx::query!(
        r#"SELECT act.id                AS "id!: i64",
                  act.occurred_at       AS "occurred_at!: String",
                  act.verb              AS "verb!: String",
                  act.actor_user_id     AS "actor_user_id!: i64",
                  u.display_name        AS "actor_name?: String",
                  act.target_student_id AS "target_student_id?: i64",
                  act.technique_id      AS "technique_id?: i64",
                  t.name                AS "technique_name?: String",
                  act.syllabus_id       AS "syllabus_id?: i64",
                  s.name                AS "syllabus_name?: String",
                  act.sst_id            AS "sst_id?: i64",
                  act.video_id          AS "video_id?: i64",
                  v.title               AS "video_title?: String",
                  act.payload_json      AS "payload_json?: String",
                  act.context_kind      AS "context_kind?: String"
           FROM activity act
           JOIN users u           ON u.id = act.actor_user_id
           LEFT JOIN techniques t ON t.id = act.technique_id
           LEFT JOIN syllabi s    ON s.id = act.syllabus_id
           LEFT JOIN videos v     ON v.id = act.video_id
           WHERE (
                   u.role = 'student'
                   AND act.verb IN (
                     -- Positive student-engagement verbs only. Undo/delete and
                     -- coach-curation verbs (technique_unpinned, attempt_deleted,
                     -- sst_added/hidden, syllabus_technique_added, etc.) are
                     -- history, not dashboard signal. syllabus_graduated is the
                     -- one milestone surfaced regardless of who fired it.
                     'video_watched', 'attempt_logged', 'attempt_edited',
                     'sst_status_changed', 'sst_student_notes_edited', 'technique_pinned'
                   )
                 )
              OR act.verb = 'syllabus_graduated'
           ORDER BY act.occurred_at DESC, act.id DESC
           LIMIT ?"#,
        limit,
    )
    .fetch_all(pool)
    .await?;

    Ok(rows
        .into_iter()
        .map(|r| ActivityRow {
            id: r.id,
            occurred_at: r.occurred_at,
            verb: r.verb,
            actor_user_id: r.actor_user_id,
            actor_name: r.actor_name,
            target_student_id: r.target_student_id,
            technique_id: r.technique_id,
            technique_name: r.technique_name,
            syllabus_id: r.syllabus_id,
            syllabus_name: r.syllabus_name,
            sst_id: r.sst_id,
            video_id: r.video_id,
            video_title: r.video_title,
            thread_id: None,
            payload_json: r.payload_json,
            unread: false,
            context_kind: r.context_kind,
        })
        .collect())
}

/// Count unread rows in the viewer's feed.
///
/// An unread row satisfies ALL of:
/// - `is_after_cursor = 1` (not seen by cursor or override)
/// - `actor_user_id != viewer` (own actions are never unread)
/// - `verb IN (<notifiable verbs>)` (non-notifiable verbs never count)
///
/// The notifiable-verb IN list is built dynamically from `Verb::ALL` at
/// runtime. Because sqlx offline cache cannot verify a dynamically-composed
/// query string, this uses the runtime-build pattern from `db/watch.rs`
/// (`format!` + `.bind()` loop). The placeholder count is derived from the
/// static `Verb::ALL` array (no user input), so there is no injection risk.
pub async fn unread_count(pool: &Pool<Sqlite>, viewer: i64, role: Role) -> Result<i64, AppError> {
    let notifiable_verbs: Vec<&'static str> = Verb::ALL
        .iter()
        .filter(|v| v.notifiable())
        .map(|v| v.as_str())
        .collect();

    let placeholders = vec!["?"; notifiable_verbs.len()].join(", ");

    let feed_predicate = match role {
        Role::Student => "act.target_student_id = ?",
        Role::Coach | Role::Admin => "act.actor_user_id != ?",
    };

    let query = format!(
        r#"SELECT COUNT(*) FROM activity act
           LEFT JOIN activity_cursors c
                  ON c.viewer_user_id = ?
           LEFT JOIN activity_seen_overrides ov
                  ON ov.viewer_user_id = ? AND ov.activity_id = act.id
           WHERE {feed_predicate}
             AND act.actor_user_id != ?
             AND act.verb IN ({placeholders})
             AND CASE
                   WHEN ov.seen = 1 THEN 0
                   WHEN ov.seen = 0 THEN 1
                   WHEN act.id <= COALESCE(c.max_seen_id, 0) THEN 0
                   ELSE 1
                 END = 1"#,
        feed_predicate = feed_predicate,
        placeholders = placeholders,
    );

    // Bind order: cursor join (viewer), override join (viewer),
    // feed predicate (viewer), actor != viewer (viewer),
    // then one bind per notifiable verb.
    let mut q = sqlx::query_scalar::<_, i64>(&query)
        .bind(viewer)
        .bind(viewer)
        .bind(viewer)
        .bind(viewer);
    for verb in &notifiable_verbs {
        q = q.bind(*verb);
    }

    let count = q.fetch_one(pool).await?;
    Ok(count)
}
