//! Threads and comments: anchor-agnostic conversation primitive. Owns the
//! anchor/visibility vocabulary, the (kind, visibility) allow-matrix, and the
//! CRUD SQL. No activity-feed emission here yet (PR5 wires that).

use chrono::NaiveDateTime;
use serde::Serialize;
use sqlx::{Pool, Sqlite};
use tracing::{info, instrument};

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
            r#"SELECT EXISTS(SELECT 1 FROM users WHERE id = ?) AS "e!: i64""#,
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
        _ => {
            return Err(AppError::Validation(format!(
                "anchor kind {} is not supported yet",
                anchor.kind.as_str()
            )));
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
    let id = sqlx::query_scalar!(
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
    .fetch_one(pool)
    .await?;
    Ok(id)
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
    pub visibility: String,
    pub scope_student_id: Option<i64>,
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
    if let Some(parent_id) = parent_comment_id {
        let parent_parent = sqlx::query_scalar!(
            r#"SELECT parent_comment_id AS "parent_comment_id?: i64"
               FROM thread_comments WHERE id = ?"#,
            parent_id
        )
        .fetch_optional(pool)
        .await?;

        match parent_parent {
            None => return Err(AppError::Validation("parent comment not found".to_string())),
            Some(Some(_)) => {
                return Err(AppError::Validation(
                    "cannot reply to a reply (one level of nesting)".to_string(),
                ))
            }
            Some(None) => {} // top-level parent, ok
        }
    }

    let comment_id = sqlx::query_scalar!(
        r#"INSERT INTO thread_comments (thread_id, parent_comment_id, author_id, body)
           VALUES (?, ?, ?, ?)
           RETURNING id AS "id!: i64""#,
        thread_id,
        parent_comment_id,
        author_id,
        body,
    )
    .fetch_one(pool)
    .await?;

    sqlx::query!(
        "UPDATE threads SET last_activity_at = CURRENT_TIMESTAMP WHERE id = ?",
        thread_id
    )
    .execute(pool)
    .await?;

    info!(thread_id, comment_id, "created comment");
    Ok(comment_id)
}

fn viewer_can_see(viewer: &Viewer, visibility: &str, scope_student_id: Option<i64>) -> bool {
    viewer.is_coach || visibility == "broadcast" || scope_student_id == Some(viewer.user_id)
}

#[instrument(skip(pool))]
pub async fn get_thread(
    pool: &Pool<Sqlite>,
    thread_id: i64,
    viewer: Viewer,
) -> Result<Option<ThreadView>, AppError> {
    let row = sqlx::query!(
        r#"SELECT id AS "id!: i64",
                  anchor_kind,
                  created_by_id AS "author_id!: i64",
                  visibility,
                  scope_student_id AS "scope_student_id?: i64",
                  body,
                  created_at AS "created_at!: NaiveDateTime",
                  deleted_at AS "deleted_at?: NaiveDateTime"
           FROM threads WHERE id = ?"#,
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
        r#"SELECT id AS "id!: i64",
                  thread_id AS "thread_id!: i64",
                  parent_comment_id AS "parent_comment_id?: i64",
                  author_id AS "author_id!: i64",
                  body,
                  created_at AS "created_at!: NaiveDateTime",
                  deleted_at AS "deleted_at?: NaiveDateTime"
           FROM thread_comments
           WHERE thread_id = ?
           ORDER BY created_at, id"#,
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
        visibility: row.visibility,
        scope_student_id: row.scope_student_id,
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
    let (student_id, technique_id, _video_id, _video_ts, _sst_id) = anchor_columns(&anchor);

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
        other => {
            return Err(AppError::Validation(format!(
                "anchor kind {} is not supported yet",
                other.as_str()
            )));
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
pub async fn soft_delete_comment(
    pool: &Pool<Sqlite>,
    comment_id: i64,
    actor_id: i64,
) -> Result<(), AppError> {
    sqlx::query!(
        "UPDATE thread_comments SET deleted_at = CURRENT_TIMESTAMP, deleted_by_id = ?
         WHERE id = ? AND deleted_at IS NULL",
        actor_id,
        comment_id,
    )
    .execute(pool)
    .await?;
    Ok(())
}

#[instrument(skip(pool))]
pub async fn soft_delete_thread(
    pool: &Pool<Sqlite>,
    thread_id: i64,
    actor_id: i64,
) -> Result<(), AppError> {
    sqlx::query!(
        "UPDATE threads SET deleted_at = CURRENT_TIMESTAMP, deleted_by_id = ?
         WHERE id = ? AND deleted_at IS NULL",
        actor_id,
        thread_id,
    )
    .execute(pool)
    .await?;
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
