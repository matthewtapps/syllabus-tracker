//! Pointers that put an existing clip on a technique or a student's syllabus
//! technique without moving it. The clip keeps its own parent; a reference only
//! decides where else it shows and whether it is hidden there.

use sqlx::{Pool, Sqlite};
use tracing::instrument;

use crate::error::AppError;
use crate::models::{DbVideo, Video, naive_to_utc};

/// What a reference points at. Typed-column polymorphism, mirrors
/// [`crate::db::videos::VideoParent`] but only for the tiers that can hold one.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ReferenceParent {
    Technique(i64),
    StudentSyllabusTechnique(i64),
}

impl ReferenceParent {
    pub fn kind(&self) -> &'static str {
        match self {
            ReferenceParent::Technique(_) => "technique",
            ReferenceParent::StudentSyllabusTechnique(_) => "student_syllabus_technique",
        }
    }

    pub fn id(&self) -> i64 {
        match self {
            ReferenceParent::Technique(id) | ReferenceParent::StudentSyllabusTechnique(id) => *id,
        }
    }

    pub fn from_kind_id(kind: &str, id: i64) -> Option<Self> {
        match kind {
            "technique" => Some(ReferenceParent::Technique(id)),
            "student_syllabus_technique" => Some(ReferenceParent::StudentSyllabusTechnique(id)),
            _ => None,
        }
    }
}

/// A referenced clip as a surface renders it: the video itself plus the
/// reference row that put it there.
#[derive(Debug, Clone)]
pub struct ReferencedVideo {
    pub video: Video,
    pub reference_id: i64,
    /// Set when the clip is hidden at this destination only; the original is
    /// untouched.
    pub hidden_at: Option<chrono::DateTime<chrono::Utc>>,
}

/// Points `video_id` at `parent`. Idempotent: referencing the same clip twice
/// returns the existing reference rather than failing.
///
/// `title` names a clip that has none, the same rule the thread reference path
/// uses. A clip that is already named keeps its name, because one clip carries
/// one title everywhere it is shown.
#[instrument(skip(pool))]
pub async fn add_video_reference(
    pool: &Pool<Sqlite>,
    video_id: i64,
    parent: ReferenceParent,
    title: Option<&str>,
    created_by_id: i64,
) -> Result<i64, AppError> {
    let current_title = sqlx::query_scalar!(
        r#"SELECT title AS "title!: String" FROM videos WHERE id = ? AND deleted_at IS NULL"#,
        video_id,
    )
    .fetch_optional(pool)
    .await?;
    let Some(current_title) = current_title else {
        return Err(AppError::NotFound(format!("video {video_id}")));
    };

    validate_reference_parent(pool, parent).await?;
    if owns_video(pool, video_id, parent).await? {
        return Err(AppError::Validation(
            "that video already lives here".to_string(),
        ));
    }

    if current_title.trim().is_empty() {
        let provided = title
            .map(str::trim)
            .filter(|t| !t.is_empty())
            .ok_or_else(|| {
                AppError::Validation(
                    "a title is required when referencing a video with no title".to_string(),
                )
            })?;
        sqlx::query!(
            "UPDATE videos SET title = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
            provided,
            video_id,
        )
        .execute(pool)
        .await?;
    }

    let (technique_id, sst_id) = match parent {
        ReferenceParent::Technique(id) => (Some(id), None),
        ReferenceParent::StudentSyllabusTechnique(id) => (None, Some(id)),
    };
    if let Some(existing) = find_reference(pool, video_id, parent).await? {
        return Ok(existing);
    }

    let kind = parent.kind();
    let position = next_position(pool, parent).await?;
    let id = sqlx::query_scalar!(
        r#"INSERT INTO video_references
              (video_id, parent_kind, technique_id, student_syllabus_technique_id,
               position, created_by_id)
           VALUES (?, ?, ?, ?, ?, ?)
           RETURNING id AS "id!: i64""#,
        video_id,
        kind,
        technique_id,
        sst_id,
        position,
        created_by_id,
    )
    .fetch_one(pool)
    .await?;
    Ok(id)
}

#[instrument(skip(pool))]
pub async fn remove_video_reference(pool: &Pool<Sqlite>, reference_id: i64) -> Result<(), AppError> {
    sqlx::query!("DELETE FROM video_references WHERE id = ?", reference_id)
        .execute(pool)
        .await?;
    Ok(())
}

/// Hides or shows a referenced clip at its destination only.
#[instrument(skip(pool))]
pub async fn set_video_reference_hidden(
    pool: &Pool<Sqlite>,
    reference_id: i64,
    hidden: bool,
) -> Result<(), AppError> {
    if hidden {
        sqlx::query!(
            "UPDATE video_references SET hidden_at = CURRENT_TIMESTAMP WHERE id = ?",
            reference_id,
        )
        .execute(pool)
        .await?;
    } else {
        sqlx::query!(
            "UPDATE video_references SET hidden_at = NULL WHERE id = ?",
            reference_id,
        )
        .execute(pool)
        .await?;
    }
    Ok(())
}

/// Coach-facing: every clip referenced onto `parent`, hidden ones included.
/// A clip soft-deleted at its source drops out, so the reference renders as
/// unavailable rather than as a playable tile.
#[instrument(skip(pool))]
pub async fn list_referenced_videos(
    pool: &Pool<Sqlite>,
    parent: ReferenceParent,
) -> Result<Vec<ReferencedVideo>, AppError> {
    let kind = parent.kind();
    let parent_id = parent.id();
    let rows = sqlx::query!(
        r#"SELECT r.id AS "reference_id!: i64",
                  r.hidden_at AS "reference_hidden_at?: chrono::NaiveDateTime",
                  v.id, v.parent_kind, v.technique_id, v.student_id, v.thread_id,
                  v.camp_id AS "camp_id?: i64", v.title, v.description,
                  v.position, v.kind, v.processing_status, v.processing_error,
                  v.storage_key, v.bytes, v.duration_seconds, v.width, v.height,
                  v.external_url, v.external_host, v.external_video_id,
                  v.uploaded_by_id, v.created_at, v.updated_at, v.hidden_at
           FROM video_references r
           JOIN videos v ON v.id = r.video_id AND v.deleted_at IS NULL
           WHERE r.parent_kind = ?
             AND CASE r.parent_kind
                   WHEN 'technique' THEN r.technique_id
                   ELSE r.student_syllabus_technique_id
                 END = ?
           ORDER BY r.position ASC, r.id ASC"#,
        kind,
        parent_id,
    )
    .fetch_all(pool)
    .await?;

    Ok(rows
        .into_iter()
        .map(|r| ReferencedVideo {
            reference_id: r.reference_id,
            hidden_at: r.reference_hidden_at.map(naive_to_utc),
            video: Video::from(DbVideo {
                id: Some(r.id),
                parent_kind: r.parent_kind,
                technique_id: r.technique_id,
                student_id: r.student_id,
                thread_id: r.thread_id,
                camp_id: r.camp_id,
                title: Some(r.title),
                description: r.description,
                position: Some(r.position),
                kind: Some(r.kind),
                processing_status: Some(r.processing_status),
                processing_error: r.processing_error,
                storage_key: r.storage_key,
                bytes: r.bytes,
                duration_seconds: r.duration_seconds,
                width: r.width,
                height: r.height,
                external_url: r.external_url,
                external_host: r.external_host,
                external_video_id: r.external_video_id,
                uploaded_by_id: Some(r.uploaded_by_id),
                created_at: r.created_at,
                updated_at: r.updated_at,
                hidden_at: r.hidden_at,
            }),
        })
        .collect())
}

async fn find_reference(
    pool: &Pool<Sqlite>,
    video_id: i64,
    parent: ReferenceParent,
) -> Result<Option<i64>, AppError> {
    let kind = parent.kind();
    let parent_id = parent.id();
    let id = sqlx::query_scalar!(
        r#"SELECT id AS "id!: i64"
           FROM video_references
           WHERE video_id = ? AND parent_kind = ?
             AND CASE parent_kind
                   WHEN 'technique' THEN technique_id
                   ELSE student_syllabus_technique_id
                 END = ?"#,
        video_id,
        kind,
        parent_id,
    )
    .fetch_optional(pool)
    .await?;
    Ok(id)
}

async fn validate_reference_parent(
    pool: &Pool<Sqlite>,
    parent: ReferenceParent,
) -> Result<(), AppError> {
    let found = match parent {
        ReferenceParent::Technique(id) => sqlx::query_scalar!(
            r#"SELECT id AS "id!: i64" FROM techniques WHERE id = ?"#,
            id
        )
        .fetch_optional(pool)
        .await?,
        ReferenceParent::StudentSyllabusTechnique(id) => sqlx::query_scalar!(
            r#"SELECT id AS "id!: i64" FROM student_syllabus_techniques WHERE id = ?"#,
            id
        )
        .fetch_optional(pool)
        .await?,
    };
    if found.is_none() {
        return Err(AppError::NotFound(format!(
            "{} {}",
            parent.kind(),
            parent.id()
        )));
    }
    Ok(())
}

/// True when the clip is already owned by this destination, which would make a
/// reference a duplicate of the video's own parent.
async fn owns_video(
    pool: &Pool<Sqlite>,
    video_id: i64,
    parent: ReferenceParent,
) -> Result<bool, AppError> {
    let kind = parent.kind();
    let parent_id = parent.id();
    let found = sqlx::query_scalar!(
        r#"SELECT id AS "id!: i64"
           FROM videos
           WHERE id = ? AND parent_kind = ?
             AND CASE parent_kind
                   WHEN 'technique' THEN technique_id
                   ELSE student_syllabus_technique_id
                 END = ?"#,
        video_id,
        kind,
        parent_id,
    )
    .fetch_optional(pool)
    .await?;
    Ok(found.is_some())
}

async fn next_position(pool: &Pool<Sqlite>, parent: ReferenceParent) -> Result<i64, AppError> {
    let kind = parent.kind();
    let parent_id = parent.id();
    let max = sqlx::query_scalar!(
        r#"SELECT COALESCE(MAX(position), -1) AS "max!: i64"
           FROM video_references
           WHERE parent_kind = ?
             AND CASE parent_kind
                   WHEN 'technique' THEN technique_id
                   ELSE student_syllabus_technique_id
                 END = ?"#,
        kind,
        parent_id,
    )
    .fetch_one(pool)
    .await?;
    Ok(max + 1)
}
