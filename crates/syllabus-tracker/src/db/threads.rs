//! Threads and comments: anchor-agnostic conversation primitive. Owns the
//! anchor/visibility vocabulary, the (kind, visibility) allow-matrix, and the
//! CRUD SQL. Activity-feed emission is handled here (PR5).

use chrono::NaiveDateTime;
use serde::Serialize;
use sqlx::{Pool, Sqlite};
use tracing::{info, instrument};

use crate::db::activity::{emit, NewActivity, Verb};
use crate::error::AppError;

/// The kinds of thing a thread can anchor to. Mirrors the `anchor_kind` CHECK
/// in `config/schema.sql` and (later) the shared frontend EntityRef union.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AnchorKind {
    StudentProfile,
    Technique,
    Video,
    VideoTimestamp,
    Sst,
    PinnedTechnique,
}

impl AnchorKind {
    pub fn as_str(self) -> &'static str {
        match self {
            AnchorKind::StudentProfile => "student_profile",
            AnchorKind::Technique => "technique",
            AnchorKind::Video => "video",
            AnchorKind::VideoTimestamp => "video_timestamp",
            AnchorKind::Sst => "sst",
            AnchorKind::PinnedTechnique => "pinned_technique",
        }
    }

    pub fn from_str_kind(s: &str) -> Option<AnchorKind> {
        match s {
            "student_profile" => Some(AnchorKind::StudentProfile),
            "technique" => Some(AnchorKind::Technique),
            "video" => Some(AnchorKind::Video),
            "video_timestamp" => Some(AnchorKind::VideoTimestamp),
            "sst" => Some(AnchorKind::Sst),
            "pinned_technique" => Some(AnchorKind::PinnedTechnique),
            _ => None,
        }
    }

    /// Whether a `broadcast` thread is legal on this anchor (global/library
    /// anchors only). Mirrors the third CHECK in the schema and spec D4.
    pub fn allows_broadcast(self) -> bool {
        matches!(
            self,
            AnchorKind::Technique | AnchorKind::Video | AnchorKind::VideoTimestamp
        )
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ThreadVisibility {
    Broadcast,
    Private,
}

impl ThreadVisibility {
    pub fn as_str(self) -> &'static str {
        match self {
            ThreadVisibility::Broadcast => "broadcast",
            ThreadVisibility::Private => "private",
        }
    }
}

/// A fully-specified anchor: the kind plus the single id that kind addresses
/// (and a seconds offset for `video_timestamp`).
#[derive(Debug, Clone, Copy)]
pub struct Anchor {
    pub kind: AnchorKind,
    /// The id of the anchored entity (student id / technique id / video id /
    /// sst id). For `pinned_technique` this is the technique id; the student is
    /// carried separately in `pinned_student_id`.
    pub id: i64,
    pub video_ts_seconds: Option<i64>,
    /// Only set for `pinned_technique` (its anchor is the (student, technique)
    /// pair, so both ids are needed).
    pub pinned_student_id: Option<i64>,
}

/// Input for creating a thread (the root post).
pub struct NewThread {
    pub author_id: i64,
    pub anchor: Anchor,
    pub visibility: ThreadVisibility,
    /// Required iff `visibility == Private`.
    pub scope_student_id: Option<i64>,
    pub body: String,
}

/// Resolve an `Anchor` into the five typed columns the `threads` table stores.
/// Returns (student_id, technique_id, video_id, video_ts_seconds, sst_id).
#[allow(clippy::type_complexity)]
fn anchor_columns(
    anchor: &Anchor,
) -> (Option<i64>, Option<i64>, Option<i64>, Option<i64>, Option<i64>) {
    match anchor.kind {
        AnchorKind::StudentProfile => (Some(anchor.id), None, None, None, None),
        AnchorKind::Technique => (None, Some(anchor.id), None, None, None),
        AnchorKind::Video => (None, None, Some(anchor.id), None, None),
        AnchorKind::VideoTimestamp => (None, None, Some(anchor.id), anchor.video_ts_seconds, None),
        AnchorKind::Sst => (None, None, None, None, Some(anchor.id)),
        AnchorKind::PinnedTechnique => (anchor.pinned_student_id, Some(anchor.id), None, None, None),
    }
}

/// Confirm the anchored parent row exists. PR1 supports profile + technique;
/// the remaining kinds are enabled in their surface PRs.
#[instrument(skip(pool))]
async fn validate_anchor(pool: &Pool<Sqlite>, anchor: &Anchor) -> Result<(), AppError> {
    let exists = match anchor.kind {
        AnchorKind::StudentProfile => sqlx::query_scalar!(
            r#"SELECT EXISTS(SELECT 1 FROM users WHERE id = ? AND role = 'student') AS "e!: i64""#,
            anchor.id
        )
        .fetch_one(pool)
        .await?,
        AnchorKind::Technique => sqlx::query_scalar!(
            r#"SELECT EXISTS(SELECT 1 FROM techniques WHERE id = ?) AS "e!: i64""#,
            anchor.id
        )
        .fetch_one(pool)
        .await?,
        AnchorKind::Video | AnchorKind::VideoTimestamp => sqlx::query_scalar!(
            r#"SELECT EXISTS(
                  SELECT 1 FROM videos
                  WHERE id = ? AND deleted_at IS NULL AND hidden_at IS NULL
               ) AS "e!: i64""#,
            anchor.id
        )
        .fetch_one(pool)
        .await?,
        AnchorKind::Sst => sqlx::query_scalar!(
            r#"SELECT EXISTS(SELECT 1 FROM student_syllabus_techniques WHERE id = ?) AS "e!: i64""#,
            anchor.id
        )
        .fetch_one(pool)
        .await?,
        AnchorKind::PinnedTechnique => {
            let student_id = anchor.pinned_student_id.ok_or_else(|| {
                AppError::Validation("pinned anchor requires a student".to_string())
            })?;
            sqlx::query_scalar!(
                r#"SELECT EXISTS(
                      SELECT 1 FROM student_pinned_techniques
                      WHERE student_id = ? AND technique_id = ?
                   ) AS "e!: i64""#,
                student_id,
                anchor.id
            )
            .fetch_one(pool)
            .await?
        }
    };
    if exists == 0 {
        return Err(AppError::Validation(format!(
            "anchor {} #{} does not exist",
            anchor.kind.as_str(),
            anchor.id
        )));
    }
    Ok(())
}

#[instrument(skip(pool, new))]
pub async fn create_thread(pool: &Pool<Sqlite>, new: NewThread) -> Result<i64, AppError> {
    if new.visibility == ThreadVisibility::Broadcast && !new.anchor.kind.allows_broadcast() {
        return Err(AppError::Validation(
            "broadcast is only allowed on technique/video anchors".to_string(),
        ));
    }
    if new.visibility == ThreadVisibility::Private && new.scope_student_id.is_none() {
        return Err(AppError::Validation(
            "a private thread must name a scope student".to_string(),
        ));
    }
    if new.visibility == ThreadVisibility::Broadcast && new.scope_student_id.is_some() {
        return Err(AppError::Validation(
            "a broadcast thread must not name a scope student".to_string(),
        ));
    }
    validate_anchor(pool, &new.anchor).await?;

    let (student_id, technique_id, video_id, video_ts, sst_id) = anchor_columns(&new.anchor);
    let kind = new.anchor.kind.as_str();
    let visibility = new.visibility.as_str();

    info!(anchor_kind = kind, "creating thread");

    let mut tx = pool.begin().await?;

    let thread_id = sqlx::query_scalar!(
        r#"INSERT INTO threads
              (created_by_id, body, anchor_kind, student_id, technique_id, video_id,
               video_ts_seconds, sst_id, visibility, scope_student_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           RETURNING id AS "id!: i64""#,
        new.author_id,
        new.body,
        kind,
        student_id,
        technique_id,
        video_id,
        video_ts,
        sst_id,
        visibility,
        new.scope_student_id,
    )
    .fetch_one(&mut *tx)
    .await?;

    // Emit activity row. Private threads target the scope student's feed;
    // broadcast threads are coach-only (target_student_id = NULL, per spec D8).
    let target = match new.visibility {
        ThreadVisibility::Private => new.scope_student_id,
        ThreadVisibility::Broadcast => None,
    };
    let mut ev = NewActivity::new(Verb::ThreadCommentPosted, new.author_id).thread(thread_id);
    if let Some(t) = target {
        ev = ev.target_student(t);
    }
    // Map the anchor to its typed id, then denormalise the deep-link context.
    let (technique_id, video_id, sst_id) = match new.anchor.kind {
        AnchorKind::Technique | AnchorKind::PinnedTechnique => (Some(new.anchor.id), None, None),
        AnchorKind::Video | AnchorKind::VideoTimestamp => (None, Some(new.anchor.id), None),
        AnchorKind::Sst => (None, None, Some(new.anchor.id)),
        // target_student already identifies the subject for profile threads.
        AnchorKind::StudentProfile => (None, None, None),
    };
    let ev = apply_thread_anchor_context(&mut tx, ev, technique_id, video_id, sst_id).await?;
    emit(&mut tx, ev).await?;

    tx.commit().await?;
    Ok(thread_id)
}

/// Denormalise a thread's deep-link context onto its activity row so the feed
/// can route to the surface the comment was made on, the same way the typed
/// id columns drive deep links for other verbs. Exactly one of the ids is set
/// per anchor. For an SST anchor we also resolve the owning syllabus (the SST
/// id alone cannot build the `/student/:id/syllabi/:id` URL). `target_student_id`
/// is deliberately left to the caller: it drives feed routing (broadcast
/// threads must stay coach-only), so a broadcast SST thread simply has no
/// student in its path and the frontend falls back to no deep link.
async fn apply_thread_anchor_context(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    ev: NewActivity,
    technique_id: Option<i64>,
    video_id: Option<i64>,
    sst_id: Option<i64>,
) -> Result<NewActivity, AppError> {
    if let Some(id) = sst_id {
        let syllabus_id = sqlx::query_scalar!(
            r#"SELECT a.syllabus_id AS "sid!: i64"
               FROM student_syllabus_techniques sst
               JOIN syllabus_assignments a ON a.id = sst.assignment_id
               WHERE sst.id = ?"#,
            id,
        )
        .fetch_optional(&mut **tx)
        .await?;
        let mut ev = ev.sst(id).context_kind("syllabus");
        if let Some(sid) = syllabus_id {
            ev = ev.syllabus(sid);
        }
        Ok(ev)
    } else if let Some(id) = technique_id {
        Ok(ev.technique(id).context_kind("library"))
    } else if let Some(id) = video_id {
        // Resolve the owning technique so the feed can name it and deep-link to
        // the library technique row, the same way a video_added row does.
        // Runtime query (not the macro) to stay out of the offline .sqlx cache.
        let technique_id: Option<i64> =
            sqlx::query_scalar::<_, i64>("SELECT technique_id FROM videos WHERE id = ?")
                .bind(id)
                .fetch_optional(&mut **tx)
                .await?;
        let mut ev = ev.video(id).context_kind("library");
        if let Some(tid) = technique_id {
            ev = ev.technique(tid);
        }
        Ok(ev)
    } else {
        Ok(ev)
    }
}

/// Who is asking. `is_coach` is true for Coach or Admin (gym-global role).
#[derive(Debug, Clone, Copy)]
pub struct Viewer {
    pub user_id: i64,
    pub is_coach: bool,
}

#[derive(Debug, Serialize)]
pub struct CommentView {
    pub id: i64,
    pub thread_id: i64,
    pub parent_comment_id: Option<i64>,
    pub author_id: i64,
    pub author_name: String,
    /// `None` when the comment is soft-deleted (tombstoned in the read layer).
    pub body: Option<String>,
    pub created_at: NaiveDateTime,
    pub deleted_at: Option<NaiveDateTime>,
}

#[derive(Debug, Serialize)]
pub struct ThreadView {
    pub id: i64,
    pub anchor_kind: String,
    pub author_id: i64,
    pub author_name: String,
    pub visibility: String,
    pub scope_student_id: Option<i64>,
    /// Anchor seconds for `video_timestamp` threads; `None` for every other
    /// anchor kind (including whole-video `video` threads).
    pub video_ts_seconds: Option<i64>,
    pub body: Option<String>,
    pub created_at: NaiveDateTime,
    pub deleted_at: Option<NaiveDateTime>,
    pub comments: Vec<CommentView>,
}

#[instrument(skip(pool, body))]
pub async fn create_comment(
    pool: &Pool<Sqlite>,
    thread_id: i64,
    parent_comment_id: Option<i64>,
    author_id: i64,
    body: &str,
) -> Result<i64, AppError> {
    // Fetch the thread's liveness, visibility, scope student, and anchor
    // details in one query so we can emit the activity row with the right
    // target_student_id and denormalised anchor column.
    let thread_row = sqlx::query!(
        r#"SELECT (deleted_at IS NULL)  AS "alive!: i64",
                  visibility,
                  scope_student_id      AS "scope_student_id?: i64",
                  anchor_kind,
                  technique_id          AS "technique_id?: i64",
                  video_id              AS "video_id?: i64",
                  sst_id                AS "sst_id?: i64"
           FROM threads WHERE id = ?"#,
        thread_id
    )
    .fetch_optional(pool)
    .await?;

    let thread_row = match thread_row {
        None => return Err(AppError::NotFound(format!("thread #{thread_id} not found"))),
        Some(r) if r.alive == 0 => return Err(AppError::Validation("thread is deleted".to_string())),
        Some(r) => r,
    };

    // One level of nesting: the parent (if any) must belong to THIS thread and
    // must itself be a top-level comment.
    if let Some(parent_id) = parent_comment_id {
        let parent = sqlx::query_scalar!(
            r#"SELECT (parent_comment_id IS NOT NULL) AS "is_reply!: i64"
               FROM thread_comments WHERE id = ? AND thread_id = ?"#,
            parent_id,
            thread_id,
        )
        .fetch_optional(pool)
        .await?;
        match parent {
            None => return Err(AppError::Validation("parent comment not found".to_string())),
            Some(1) => {
                return Err(AppError::Validation(
                    "cannot reply to a reply (one level of nesting)".to_string(),
                ));
            }
            _ => {}
        }
    }

    let mut tx = pool.begin().await?;

    let comment_id = sqlx::query_scalar!(
        r#"INSERT INTO thread_comments (thread_id, parent_comment_id, author_id, body)
           VALUES (?, ?, ?, ?)
           RETURNING id AS "id!: i64""#,
        thread_id,
        parent_comment_id,
        author_id,
        body,
    )
    .fetch_one(&mut *tx)
    .await?;

    sqlx::query!(
        "UPDATE threads SET last_activity_at = CURRENT_TIMESTAMP WHERE id = ?",
        thread_id
    )
    .execute(&mut *tx)
    .await?;

    // Emit activity: private threads target the scope student; broadcast = None.
    let target = if thread_row.visibility == "private" {
        thread_row.scope_student_id
    } else {
        None
    };
    let mut ev = NewActivity::new(Verb::ThreadCommentPosted, author_id).thread(thread_id);
    if let Some(t) = target {
        ev = ev.target_student(t);
    }
    // Denormalise the deep-link context from this thread's anchor columns.
    let ev = apply_thread_anchor_context(
        &mut tx,
        ev,
        thread_row.technique_id,
        thread_row.video_id,
        thread_row.sst_id,
    )
    .await?;
    emit(&mut tx, ev).await?;

    tx.commit().await?;
    Ok(comment_id)
}

fn viewer_can_see(viewer: &Viewer, visibility: &str, scope_student_id: Option<i64>) -> bool {
    viewer.is_coach || visibility == "broadcast" || scope_student_id == Some(viewer.user_id)
}

/// Counts, per video, the comment threads anchored to it (`video` and
/// `video_timestamp`) that `viewer` may see -- the count mirrors
/// [`viewer_can_see`]: a coach sees every thread, a student sees broadcast
/// threads plus their own private ones. Returns `video_id -> count` for the
/// given ids; videos with no visible threads are absent from the map.
///
/// Uses a runtime `QueryBuilder` (not the `query!` macro) for the dynamic
/// `IN (...)` list, matching `list_video_syllabus_overrides`; this also keeps
/// it out of the offline `.sqlx` cache.
#[instrument(skip(pool, video_ids))]
pub async fn count_video_comments_visible(
    pool: &Pool<Sqlite>,
    video_ids: &[i64],
    viewer: Viewer,
) -> Result<std::collections::HashMap<i64, i64>, AppError> {
    use std::collections::HashMap;
    if video_ids.is_empty() {
        return Ok(HashMap::new());
    }
    let mut qb = sqlx::QueryBuilder::<sqlx::Sqlite>::new(
        "SELECT video_id, COUNT(*) AS n FROM threads \
         WHERE deleted_at IS NULL \
           AND anchor_kind IN ('video', 'video_timestamp') \
           AND video_id IN (",
    );
    let mut sep = qb.separated(", ");
    for id in video_ids {
        sep.push_bind(*id);
    }
    qb.push(")");
    if !viewer.is_coach {
        qb.push(" AND (visibility = 'broadcast' OR scope_student_id = ");
        qb.push_bind(viewer.user_id);
        qb.push(")");
    }
    qb.push(" GROUP BY video_id");
    let rows = qb.build().fetch_all(pool).await?;
    let mut map: HashMap<i64, i64> = HashMap::new();
    for row in rows {
        use sqlx::Row;
        let video_id: i64 = row.try_get("video_id")?;
        let n: i64 = row.try_get("n")?;
        map.insert(video_id, n);
    }
    Ok(map)
}

#[instrument(skip(pool))]
pub async fn get_thread(
    pool: &Pool<Sqlite>,
    thread_id: i64,
    viewer: Viewer,
) -> Result<Option<ThreadView>, AppError> {
    let row = sqlx::query!(
        r#"SELECT t.id AS "id!: i64",
                  t.anchor_kind,
                  t.created_by_id AS "author_id!: i64",
                  COALESCE(u.display_name, u.username, '?') AS "author_name!: String",
                  t.visibility,
                  t.scope_student_id AS "scope_student_id?: i64",
                  t.video_ts_seconds AS "video_ts_seconds?: i64",
                  t.body,
                  t.created_at AS "created_at!: NaiveDateTime",
                  t.deleted_at AS "deleted_at?: NaiveDateTime"
           FROM threads t
           JOIN users u ON u.id = t.created_by_id
           WHERE t.id = ?"#,
        thread_id
    )
    .fetch_optional(pool)
    .await?;

    let row = match row {
        None => return Ok(None),
        Some(r) => r,
    };

    if !viewer_can_see(&viewer, &row.visibility, row.scope_student_id) {
        return Ok(None);
    }

    let comments = sqlx::query!(
        r#"SELECT c.id AS "id!: i64",
                  c.thread_id AS "thread_id!: i64",
                  c.parent_comment_id AS "parent_comment_id?: i64",
                  c.author_id AS "author_id!: i64",
                  COALESCE(u.display_name, u.username, '?') AS "author_name!: String",
                  c.body,
                  c.created_at AS "created_at!: NaiveDateTime",
                  c.deleted_at AS "deleted_at?: NaiveDateTime"
           FROM thread_comments c
           JOIN users u ON u.id = c.author_id
           WHERE c.thread_id = ?
           ORDER BY c.created_at, c.id"#,
        thread_id
    )
    .fetch_all(pool)
    .await?
    .into_iter()
    .map(|c| CommentView {
        id: c.id,
        thread_id: c.thread_id,
        parent_comment_id: c.parent_comment_id,
        author_id: c.author_id,
        author_name: c.author_name,
        body: if c.deleted_at.is_some() { None } else { Some(c.body) },
        created_at: c.created_at,
        deleted_at: c.deleted_at,
    })
    .collect();

    let thread_body = if row.deleted_at.is_some() { None } else { Some(row.body) };

    Ok(Some(ThreadView {
        id: row.id,
        anchor_kind: row.anchor_kind,
        author_id: row.author_id,
        author_name: row.author_name,
        visibility: row.visibility,
        scope_student_id: row.scope_student_id,
        video_ts_seconds: row.video_ts_seconds,
        body: thread_body,
        created_at: row.created_at,
        deleted_at: row.deleted_at,
        comments,
    }))
}

#[instrument(skip(pool))]
pub async fn list_threads_for_anchor(
    pool: &Pool<Sqlite>,
    anchor: Anchor,
    viewer: Viewer,
) -> Result<Vec<ThreadView>, AppError> {
    let (student_id, technique_id, video_id, _video_ts, sst_id) = anchor_columns(&anchor);

    let thread_ids: Vec<i64> = match anchor.kind {
        AnchorKind::StudentProfile => {
            sqlx::query_scalar!(
                r#"SELECT id AS "id!: i64" FROM threads
                   WHERE anchor_kind = 'student_profile' AND student_id = ? AND deleted_at IS NULL
                   ORDER BY last_activity_at DESC"#,
                student_id
            )
            .fetch_all(pool)
            .await?
        }
        AnchorKind::Technique => {
            sqlx::query_scalar!(
                r#"SELECT id AS "id!: i64" FROM threads
                   WHERE anchor_kind = 'technique' AND technique_id = ? AND deleted_at IS NULL
                   ORDER BY last_activity_at DESC"#,
                technique_id
            )
            .fetch_all(pool)
            .await?
        }
        AnchorKind::Video | AnchorKind::VideoTimestamp => {
            sqlx::query_scalar!(
                r#"SELECT id AS "id!: i64" FROM threads
                   WHERE video_id = ?
                     AND anchor_kind IN ('video', 'video_timestamp')
                     AND deleted_at IS NULL
                   ORDER BY COALESCE(video_ts_seconds, 0), last_activity_at DESC"#,
                video_id
            )
            .fetch_all(pool)
            .await?
        }
        AnchorKind::Sst => {
            sqlx::query_scalar!(
                r#"SELECT id AS "id!: i64" FROM threads
                   WHERE anchor_kind = 'sst' AND sst_id = ? AND deleted_at IS NULL
                   ORDER BY last_activity_at DESC"#,
                sst_id
            )
            .fetch_all(pool)
            .await?
        }
        AnchorKind::PinnedTechnique => {
            sqlx::query_scalar!(
                r#"SELECT id AS "id!: i64" FROM threads
                   WHERE anchor_kind = 'pinned_technique'
                     AND student_id = ? AND technique_id = ?
                     AND deleted_at IS NULL
                   ORDER BY last_activity_at DESC"#,
                student_id,
                technique_id
            )
            .fetch_all(pool)
            .await?
        }
    };

    let mut views = Vec::with_capacity(thread_ids.len());
    for id in thread_ids {
        if let Some(view) = get_thread(pool, id, viewer).await? {
            views.push(view);
        }
    }
    Ok(views)
}

#[instrument(skip(pool))]
pub async fn soft_delete_comment(pool: &Pool<Sqlite>, comment_id: i64, actor_id: i64) -> Result<(), AppError> {
    let affected = sqlx::query!(
        "UPDATE thread_comments SET deleted_at = CURRENT_TIMESTAMP, deleted_by_id = ?
         WHERE id = ? AND deleted_at IS NULL",
        actor_id,
        comment_id,
    )
    .execute(pool)
    .await?
    .rows_affected();
    if affected == 0 {
        return Err(AppError::NotFound(format!(
            "comment #{comment_id} not found or already deleted"
        )));
    }
    Ok(())
}

#[instrument(skip(pool))]
pub async fn soft_delete_thread(pool: &Pool<Sqlite>, thread_id: i64, actor_id: i64) -> Result<(), AppError> {
    let affected = sqlx::query!(
        "UPDATE threads SET deleted_at = CURRENT_TIMESTAMP, deleted_by_id = ?
         WHERE id = ? AND deleted_at IS NULL",
        actor_id,
        thread_id,
    )
    .execute(pool)
    .await?
    .rows_affected();
    if affected == 0 {
        return Err(AppError::NotFound(format!(
            "thread #{thread_id} not found or already deleted"
        )));
    }
    Ok(())
}

#[cfg(test)]
mod type_tests {
    use super::{AnchorKind, ThreadVisibility};

    #[test]
    fn anchor_kind_str_roundtrips() {
        for kind in [
            AnchorKind::StudentProfile,
            AnchorKind::Technique,
            AnchorKind::Video,
            AnchorKind::VideoTimestamp,
            AnchorKind::Sst,
            AnchorKind::PinnedTechnique,
        ] {
            assert_eq!(AnchorKind::from_str_kind(kind.as_str()), Some(kind));
        }
        assert_eq!(AnchorKind::from_str_kind("nope"), None);
    }

    #[test]
    fn only_global_anchors_allow_broadcast() {
        assert!(AnchorKind::Technique.allows_broadcast());
        assert!(AnchorKind::Video.allows_broadcast());
        assert!(AnchorKind::VideoTimestamp.allows_broadcast());
        assert!(!AnchorKind::StudentProfile.allows_broadcast());
        assert!(!AnchorKind::Sst.allows_broadcast());
        assert!(!AnchorKind::PinnedTechnique.allows_broadcast());
    }

    #[test]
    fn visibility_str() {
        assert_eq!(ThreadVisibility::Broadcast.as_str(), "broadcast");
        assert_eq!(ThreadVisibility::Private.as_str(), "private");
    }
}
