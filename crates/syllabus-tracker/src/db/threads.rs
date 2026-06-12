//! Threads and comments: anchor-agnostic conversation primitive. Owns the
//! anchor/visibility vocabulary, the (kind, visibility) allow-matrix, and the
//! CRUD SQL. No activity-feed emission here yet (PR5 wires that).

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
