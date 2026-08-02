use std::collections::HashMap;

use chrono::Utc;
use sqlx::{Pool, Sqlite};
use tracing::{info, instrument};

use crate::db::activity::{
    NewActivity, Verb, emit, emit_broadcast, payload,
};
use crate::error::AppError;
use crate::models::{DbVideo, ProcessingStatus, Video, VideoKind};

/// The kinds of thing a video can hang off. Typed-column polymorphism,
/// mirrors `threads::AnchorKind`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum VideoParent {
    Technique(i64),
    StudentProfile(i64),
    /// A video reply living under a thread. Per CX-010 a thread can NOT be
    /// started on a video whose parent is a thread (no endless reply chains);
    /// that guard lives in `db::threads::validate_anchor` (a later task).
    Thread(i64),
    /// A video on a syllabus-technique membership row (`syllabus_techniques.id`).
    SyllabusTechnique(i64),
    /// A video on a per-(assignment, technique) progress row
    /// (`student_syllabus_techniques.id`).
    StudentSyllabusTechnique(i64),
    Camp(i64),
    Loose,
}

/// A coach visibility-override scope. Mirrors the exclusive-arc parent pattern
/// (`VideoParent`): exactly one entity is referenced, the DB enforces it via a
/// CHECK + per-scope FK cascade on `video_visibility_overrides`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum VisibilityScope {
    Student(i64),
    Syllabus(i64),
    Assignment(i64),
    Camp(i64),
}

impl VisibilityScope {
    pub fn kind(&self) -> &'static str {
        match self {
            VisibilityScope::Student(_) => "student",
            VisibilityScope::Syllabus(_) => "syllabus",
            VisibilityScope::Assignment(_) => "assignment",
            VisibilityScope::Camp(_) => "camp",
        }
    }

    /// Returns `(student_id, syllabus_id, assignment_id, camp_id)` with exactly
    /// one `Some`, matching the table's typed columns.
    pub fn columns(&self) -> (Option<i64>, Option<i64>, Option<i64>, Option<i64>) {
        match *self {
            VisibilityScope::Student(id) => (Some(id), None, None, None),
            VisibilityScope::Syllabus(id) => (None, Some(id), None, None),
            VisibilityScope::Assignment(id) => (None, None, Some(id), None),
            VisibilityScope::Camp(id) => (None, None, None, Some(id)),
        }
    }
}

/// The typed columns a `VideoParent` resolves to in the `videos` table.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ParentColumns {
    pub kind: &'static str,
    pub technique_id: Option<i64>,
    pub student_id: Option<i64>,
    pub thread_id: Option<i64>,
    pub syllabus_technique_id: Option<i64>,
    pub student_syllabus_technique_id: Option<i64>,
    pub camp_id: Option<i64>,
}

impl VideoParent {
    /// Resolves a `(kind, id)` pair from a request into a typed parent. Mirrors
    /// `threads::AnchorKind::from_str_kind`. Only the three technique tiers are
    /// constructable from a create request; profile / thread / loose videos are
    /// created on their own dedicated surfaces, so they return `None` here.
    pub fn from_kind_id(kind: &str, id: i64) -> Option<VideoParent> {
        match kind {
            "technique" => Some(VideoParent::Technique(id)),
            "syllabus_technique" => Some(VideoParent::SyllabusTechnique(id)),
            "student_syllabus_technique" => Some(VideoParent::StudentSyllabusTechnique(id)),
            _ => None,
        }
    }

    pub fn columns(self) -> ParentColumns {
        match self {
            VideoParent::Technique(id) => ParentColumns {
                kind: "technique", technique_id: Some(id), student_id: None, thread_id: None,
                syllabus_technique_id: None, student_syllabus_technique_id: None, camp_id: None,
            },
            VideoParent::StudentProfile(id) => ParentColumns {
                kind: "student_profile", technique_id: None, student_id: Some(id), thread_id: None,
                syllabus_technique_id: None, student_syllabus_technique_id: None, camp_id: None,
            },
            VideoParent::Thread(id) => ParentColumns {
                kind: "thread", technique_id: None, student_id: None, thread_id: Some(id),
                syllabus_technique_id: None, student_syllabus_technique_id: None, camp_id: None,
            },
            VideoParent::SyllabusTechnique(id) => ParentColumns {
                kind: "syllabus_technique", technique_id: None, student_id: None, thread_id: None,
                syllabus_technique_id: Some(id), student_syllabus_technique_id: None, camp_id: None,
            },
            VideoParent::StudentSyllabusTechnique(id) => ParentColumns {
                kind: "student_syllabus_technique", technique_id: None, student_id: None, thread_id: None,
                syllabus_technique_id: None, student_syllabus_technique_id: Some(id), camp_id: None,
            },
            VideoParent::Camp(id) => ParentColumns {
                kind: "camp", technique_id: None, student_id: None, thread_id: None,
                syllabus_technique_id: None, student_syllabus_technique_id: None, camp_id: Some(id),
            },
            VideoParent::Loose => ParentColumns {
                kind: "loose", technique_id: None, student_id: None, thread_id: None,
                syllabus_technique_id: None, student_syllabus_technique_id: None, camp_id: None,
            },
        }
    }
}

/// Confirms the parent row exists before inserting a video against it.
/// Loose has no parent to check.
#[instrument(skip(pool))]
pub async fn validate_parent(pool: &Pool<Sqlite>, parent: VideoParent) -> Result<(), AppError> {
    let exists = match parent {
        VideoParent::Technique(id) => {
            sqlx::query_scalar!("SELECT 1 FROM techniques WHERE id = ?", id)
                .fetch_optional(pool).await?.is_some()
        }
        VideoParent::StudentProfile(id) => {
            sqlx::query_scalar!("SELECT 1 FROM users WHERE id = ?", id)
                .fetch_optional(pool).await?.is_some()
        }
        VideoParent::Thread(id) => {
            sqlx::query_scalar!("SELECT 1 FROM threads WHERE id = ? AND deleted_at IS NULL", id)
                .fetch_optional(pool).await?.is_some()
        }
        VideoParent::SyllabusTechnique(id) => {
            sqlx::query_scalar!("SELECT 1 FROM syllabus_techniques WHERE id = ?", id)
                .fetch_optional(pool).await?.is_some()
        }
        VideoParent::StudentSyllabusTechnique(id) => {
            sqlx::query_scalar!("SELECT 1 FROM student_syllabus_techniques WHERE id = ?", id)
                .fetch_optional(pool).await?.is_some()
        }
        VideoParent::Camp(id) => {
            sqlx::query_scalar!("SELECT 1 FROM camps WHERE id = ? AND archived_at IS NULL", id)
                .fetch_optional(pool).await?.is_some()
        }
        VideoParent::Loose => true,
    };
    if exists {
        Ok(())
    } else {
        Err(AppError::NotFound("parent for video not found".into()))
    }
}

#[instrument(skip(pool))]
pub async fn next_video_position(pool: &Pool<Sqlite>, parent: VideoParent) -> Result<i64, AppError> {
    let c = parent.columns();
    let row = sqlx::query!(
        "SELECT COALESCE(MAX(position), -1) AS max_position
         FROM videos
         WHERE deleted_at IS NULL
           AND parent_kind = ?
           AND (technique_id IS ? OR (technique_id IS NULL AND ? IS NULL))
           AND (student_id   IS ? OR (student_id   IS NULL AND ? IS NULL))
           AND (thread_id    IS ? OR (thread_id    IS NULL AND ? IS NULL))
           AND (syllabus_technique_id IS ? OR (syllabus_technique_id IS NULL AND ? IS NULL))
           AND (student_syllabus_technique_id IS ? OR (student_syllabus_technique_id IS NULL AND ? IS NULL))
           AND (camp_id      IS ? OR (camp_id      IS NULL AND ? IS NULL))",
        c.kind,
        c.technique_id,
        c.technique_id,
        c.student_id,
        c.student_id,
        c.thread_id,
        c.thread_id,
        c.syllabus_technique_id,
        c.syllabus_technique_id,
        c.student_syllabus_technique_id,
        c.student_syllabus_technique_id,
        c.camp_id,
        c.camp_id,
    )
    .fetch_one(pool)
    .await?;
    Ok(row.max_position + 1)
}

#[instrument(skip(pool))]
pub async fn create_processing_video(
    pool: &Pool<Sqlite>,
    parent: VideoParent,
    title: &str,
    description: Option<&str>,
    uploaded_by_id: i64,
) -> Result<i64, AppError> {
    info!("Creating processing video");
    validate_parent(pool, parent).await?;
    let c = parent.columns();
    let position = next_video_position(pool, parent).await?;
    let kind = VideoKind::Native.as_str();
    let status = ProcessingStatus::Processing.as_str();
    let mut tx = pool.begin().await?;
    let res = sqlx::query!(
        "INSERT INTO videos (
            parent_kind, technique_id, student_id, thread_id,
            syllabus_technique_id, student_syllabus_technique_id, camp_id,
            title, description, position, kind, processing_status, uploaded_by_id
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        c.kind,
        c.technique_id,
        c.student_id,
        c.thread_id,
        c.syllabus_technique_id,
        c.student_syllabus_technique_id,
        c.camp_id,
        title,
        description,
        position,
        kind,
        status,
        uploaded_by_id,
    )
    .execute(&mut *tx)
    .await?;
    let video_id = res.last_insert_rowid();
    if let VideoParent::Technique(technique_id) = parent {
        emit_broadcast(
            &mut tx,
            NewActivity::new(Verb::VideoAdded, uploaded_by_id)
                .video(video_id)
                .technique(technique_id),
        )
        .await?;
    }
    tx.commit().await?;
    Ok(video_id)
}

pub struct NewExternalVideo<'a> {
    pub parent: VideoParent,
    pub title: &'a str,
    pub description: Option<&'a str>,
    pub uploaded_by_id: i64,
    pub kind: VideoKind,
    pub external_url: &'a str,
    pub external_host: Option<&'a str>,
    pub external_video_id: Option<&'a str>,
}

#[instrument(skip(pool, input))]
pub async fn create_external_video(
    pool: &Pool<Sqlite>,
    input: NewExternalVideo<'_>,
) -> Result<i64, AppError> {
    info!("Creating external video");
    validate_parent(pool, input.parent).await?;
    let c = input.parent.columns();
    let position = next_video_position(pool, input.parent).await?;
    let kind_str = input.kind.as_str();
    let status = ProcessingStatus::Ready.as_str();
    let uploaded_by_id = input.uploaded_by_id;
    let mut tx = pool.begin().await?;
    let res = sqlx::query!(
        "INSERT INTO videos (
            parent_kind, technique_id, student_id, thread_id,
            syllabus_technique_id, student_syllabus_technique_id, camp_id,
            title, description, position, kind, processing_status,
            external_url, external_host, external_video_id, uploaded_by_id
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        c.kind,
        c.technique_id,
        c.student_id,
        c.thread_id,
        c.syllabus_technique_id,
        c.student_syllabus_technique_id,
        c.camp_id,
        input.title,
        input.description,
        position,
        kind_str,
        status,
        input.external_url,
        input.external_host,
        input.external_video_id,
        input.uploaded_by_id,
    )
    .execute(&mut *tx)
    .await?;
    let video_id = res.last_insert_rowid();
    if let VideoParent::Technique(technique_id) = input.parent {
        emit_broadcast(
            &mut tx,
            NewActivity::new(Verb::VideoAdded, uploaded_by_id)
                .video(video_id)
                .technique(technique_id),
        )
        .await?;
    }
    tx.commit().await?;
    Ok(video_id)
}

#[instrument(skip(pool))]
pub async fn finalize_video_ready(
    pool: &Pool<Sqlite>,
    id: i64,
    storage_key: &str,
    bytes: i64,
    duration_seconds: i64,
    width: Option<i64>,
    height: Option<i64>,
) -> Result<(), AppError> {
    let status = ProcessingStatus::Ready.as_str();
    let now = Utc::now().naive_utc();
    sqlx::query!(
        "UPDATE videos
         SET processing_status = ?,
             processing_error = NULL,
             storage_key = ?,
             bytes = ?,
             duration_seconds = ?,
             width = ?,
             height = ?,
             updated_at = ?
         WHERE id = ?",
        status,
        storage_key,
        bytes,
        duration_seconds,
        width,
        height,
        now,
        id,
    )
    .execute(pool)
    .await?;
    Ok(())
}

#[instrument(skip(pool))]
pub async fn mark_video_failed(pool: &Pool<Sqlite>, id: i64, error: &str) -> Result<(), AppError> {
    let status = ProcessingStatus::Failed.as_str();
    let now = Utc::now().naive_utc();
    sqlx::query!(
        "UPDATE videos
         SET processing_status = ?, processing_error = ?, updated_at = ?
         WHERE id = ?",
        status,
        error,
        now,
        id,
    )
    .execute(pool)
    .await?;
    Ok(())
}

/// Idempotent variant of [`finalize_video_ready`]: skips the update if the
/// row is already `ready`. Safe to call more than once (e.g. from a webhook
/// that may fire twice).
#[instrument(skip(pool))]
pub async fn finalize_video_ready_if_not_ready(
    pool: &Pool<Sqlite>,
    id: i64,
    storage_key: &str,
    bytes: i64,
    duration_seconds: i64,
    width: Option<i64>,
    height: Option<i64>,
) -> Result<(), AppError> {
    let ready_status = ProcessingStatus::Ready.as_str();
    let now = Utc::now().naive_utc();
    sqlx::query!(
        "UPDATE videos
         SET processing_status = ?,
             processing_error = NULL,
             storage_key = ?,
             bytes = ?,
             duration_seconds = ?,
             width = ?,
             height = ?,
             updated_at = ?
         WHERE id = ?
           AND processing_status != ?",
        ready_status,
        storage_key,
        bytes,
        duration_seconds,
        width,
        height,
        now,
        id,
        ready_status,
    )
    .execute(pool)
    .await?;
    Ok(())
}

/// Idempotent variant of [`mark_video_failed`]: skips the update if the row
/// is already `ready` so a late failure report cannot overwrite a success.
#[instrument(skip(pool))]
pub async fn mark_video_failed_if_not_ready(
    pool: &Pool<Sqlite>,
    id: i64,
    error: &str,
) -> Result<(), AppError> {
    let failed_status = ProcessingStatus::Failed.as_str();
    let ready_status = ProcessingStatus::Ready.as_str();
    let now = Utc::now().naive_utc();
    sqlx::query!(
        "UPDATE videos
         SET processing_status = ?, processing_error = ?, updated_at = ?
         WHERE id = ?
           AND processing_status != ?",
        failed_status,
        error,
        now,
        id,
        ready_status,
    )
    .execute(pool)
    .await?;
    Ok(())
}

#[instrument(skip(pool))]
pub async fn get_db_video(pool: &Pool<Sqlite>, id: i64) -> Result<Option<DbVideo>, AppError> {
    let row = sqlx::query_as!(
        DbVideo,
        r#"SELECT id, parent_kind, technique_id, student_id, thread_id,
                camp_id AS "camp_id?: i64", title, description,
                position, kind, processing_status, processing_error, storage_key, bytes,
                duration_seconds, width, height,
                external_url, external_host, external_video_id, uploaded_by_id,
                created_at, updated_at, hidden_at
         FROM videos
         WHERE id = ? AND deleted_at IS NULL"#,
        id
    )
    .fetch_optional(pool)
    .await?;
    Ok(row)
}

#[instrument(skip(pool))]
pub async fn get_video(pool: &Pool<Sqlite>, id: i64) -> Result<Option<Video>, AppError> {
    Ok(get_db_video(pool, id).await?.map(Video::from))
}

/// Lists all non-deleted videos for a technique. This is the coach-facing
/// view: hidden videos are returned, the caller decides whether to badge
/// them. For the student-facing view that filters down to effective
/// visibility, use [`list_videos_for_technique_visible_to`].
#[instrument(skip(pool))]
pub async fn list_videos_for_technique(
    pool: &Pool<Sqlite>,
    technique_id: i64,
) -> Result<Vec<Video>, AppError> {
    let rows = sqlx::query_as!(
        DbVideo,
        r#"SELECT id, parent_kind, technique_id, student_id, thread_id,
                camp_id AS "camp_id?: i64", title, description,
                position, kind, processing_status, processing_error, storage_key, bytes,
                duration_seconds, width, height,
                external_url, external_host, external_video_id, uploaded_by_id,
                created_at, updated_at, hidden_at
         FROM videos
         WHERE technique_id = ? AND parent_kind = 'technique' AND deleted_at IS NULL
         ORDER BY position ASC, id ASC"#,
        technique_id
    )
    .fetch_all(pool)
    .await?;
    Ok(rows.into_iter().map(Video::from).collect())
}

/// Lists videos for a technique in a specific (student, syllabus) context,
/// filtered to what the student should actually see. Visibility is resolved
/// through [`effective_video_visible`] against the (student, syllabus)
/// assignment, so the full override precedence (assignment > syllabus >
/// student scope, SST-hidden cascade, global hide) applies. If the student
/// has no ACTIVE assignment for this syllabus, nothing is visible.
///
/// Candidates are unioned across all three owning tiers: the technique's T1
/// videos, this syllabus's T2 (`syllabus_technique`) videos for the technique,
/// and this assignment's T3 (`student_syllabus_technique`) videos for it.
#[instrument(skip(pool))]
pub async fn list_videos_for_technique_in_syllabus_visible_to(
    pool: &Pool<Sqlite>,
    technique_id: i64,
    syllabus_id: i64,
    student_id: i64,
) -> Result<Vec<Video>, AppError> {
    let assignment_id = sqlx::query_scalar!(
        r#"SELECT id AS "id!: i64"
           FROM syllabus_assignments
           WHERE student_id = ? AND syllabus_id = ?
             AND unassigned_at IS NULL"#,
        student_id,
        syllabus_id,
    )
    .fetch_optional(pool)
    .await?;
    let Some(assignment_id) = assignment_id else {
        return Ok(Vec::new());
    };

    // Candidate videos for the technique across all three owning tiers; the
    // resolver decides which the student actually sees in this assignment's
    // context. The owned-in-scope gate inside `effective_video_visible` already
    // excludes T2 rows from other syllabi and T3 rows from other assignments,
    // but we narrow the candidate set up front (this syllabus's membership row,
    // this assignment's SST) so the read stays cheap.
    //   - T1: parent_kind='technique' AND technique_id = :technique_id
    //   - T2: parent_kind='syllabus_technique' AND syllabus_technique_id IN
    //         (this syllabus's membership rows for this technique)
    //   - T3: parent_kind='student_syllabus_technique' AND
    //         student_syllabus_technique_id IN (this assignment's SST rows for
    //         this technique)
    // Ordered T1, T2, T3 (tier first), then position, id within each tier.
    let candidates = sqlx::query_as!(
        DbVideo,
        r#"SELECT id, parent_kind, technique_id, student_id, thread_id,
                camp_id AS "camp_id?: i64", title, description,
                position, kind, processing_status, processing_error, storage_key, bytes,
                duration_seconds, width, height,
                external_url, external_host, external_video_id, uploaded_by_id,
                created_at, updated_at, hidden_at
         FROM videos
         WHERE deleted_at IS NULL
           AND (
                 (parent_kind = 'technique' AND technique_id = ?1)
              OR (parent_kind = 'syllabus_technique'
                  AND syllabus_technique_id IN (
                        SELECT id FROM syllabus_techniques
                        WHERE syllabus_id = ?2 AND technique_id = ?1))
              OR (parent_kind = 'student_syllabus_technique'
                  AND student_syllabus_technique_id IN (
                        SELECT id FROM student_syllabus_techniques
                        WHERE assignment_id = ?3 AND technique_id = ?1))
               )
         ORDER BY
            CASE parent_kind
                WHEN 'technique' THEN 0
                WHEN 'syllabus_technique' THEN 1
                ELSE 2
            END ASC,
            position ASC,
            id ASC"#,
        technique_id,
        syllabus_id,
        assignment_id,
    )
    .fetch_all(pool)
    .await?;

    let mut visible = Vec::with_capacity(candidates.len());
    for row in candidates {
        let video = Video::from(row);
        if effective_video_visible(pool, video.id, assignment_id).await? {
            visible.push(video);
        }
    }

    // Clips referenced onto the technique, and onto this assignment's row for
    // it, list after the tiers that own their videos.
    visible.extend(
        crate::db::list_referenced_videos_visible_in_assignment(
            pool,
            crate::db::ReferenceParent::Technique(technique_id),
            assignment_id,
        )
        .await?,
    );
    let sst_ids = sqlx::query_scalar!(
        r#"SELECT id AS "id!: i64"
           FROM student_syllabus_techniques
           WHERE assignment_id = ? AND technique_id = ?"#,
        assignment_id,
        technique_id,
    )
    .fetch_all(pool)
    .await?;
    for sst_id in sst_ids {
        visible.extend(
            crate::db::list_referenced_videos_visible_in_assignment(
                pool,
                crate::db::ReferenceParent::StudentSyllabusTechnique(sst_id),
                assignment_id,
            )
            .await?,
        );
    }

    Ok(visible)
}

/// Lists the globally-visible (not soft-deleted, not globally-hidden) videos
/// for a technique. Used by the library video read for student viewers.
/// Per-student / per-assignment overrides are intentionally NOT applied:
/// library context is "see the technique in the abstract", and overrides
/// only apply inside a syllabus assignment.
#[instrument(skip(pool))]
pub async fn list_videos_for_technique_global_visible(
    pool: &Pool<Sqlite>,
    technique_id: i64,
) -> Result<Vec<Video>, AppError> {
    let rows = sqlx::query_as!(
        DbVideo,
        r#"SELECT id, parent_kind, technique_id, student_id, thread_id,
                camp_id AS "camp_id?: i64", title, description,
                position, kind, processing_status, processing_error, storage_key, bytes,
                duration_seconds, width, height,
                external_url, external_host, external_video_id, uploaded_by_id,
                created_at, updated_at, hidden_at
         FROM videos
         WHERE technique_id = ?
           AND parent_kind = 'technique'
           AND deleted_at IS NULL
           AND hidden_at IS NULL
         ORDER BY position ASC, id ASC"#,
        technique_id,
    )
    .fetch_all(pool)
    .await?;
    Ok(rows.into_iter().map(Video::from).collect())
}

/// Lists the globally-visible (not soft-deleted, not globally-hidden) videos
/// hanging off a given parent. Used by profile/thread/loose surfaces, which
/// per CX-019 apply only the global hide (no per-student override layers).
#[instrument(skip(pool))]
pub async fn list_videos_for_parent_global_visible(
    pool: &Pool<Sqlite>,
    parent: VideoParent,
) -> Result<Vec<Video>, AppError> {
    let c = parent.columns();
    let rows = sqlx::query_as!(
        DbVideo,
        r#"SELECT id, parent_kind, technique_id, student_id, thread_id,
                camp_id AS "camp_id?: i64", title, description,
                position, kind, processing_status, processing_error, storage_key, bytes,
                duration_seconds, width, height,
                external_url, external_host, external_video_id, uploaded_by_id,
                created_at, updated_at, hidden_at
         FROM videos
         WHERE deleted_at IS NULL AND hidden_at IS NULL
           AND parent_kind = ?
           AND (technique_id IS ? OR (technique_id IS NULL AND ? IS NULL))
           AND (student_id   IS ? OR (student_id   IS NULL AND ? IS NULL))
           AND (thread_id    IS ? OR (thread_id    IS NULL AND ? IS NULL))
           AND (syllabus_technique_id IS ? OR (syllabus_technique_id IS NULL AND ? IS NULL))
           AND (student_syllabus_technique_id IS ? OR (student_syllabus_technique_id IS NULL AND ? IS NULL))
           AND (camp_id      IS ? OR (camp_id      IS NULL AND ? IS NULL))
         ORDER BY position ASC, id ASC"#,
        c.kind,
        c.technique_id,
        c.technique_id,
        c.student_id,
        c.student_id,
        c.thread_id,
        c.thread_id,
        c.syllabus_technique_id,
        c.syllabus_technique_id,
        c.student_syllabus_technique_id,
        c.student_syllabus_technique_id,
        c.camp_id,
        c.camp_id,
    )
    .fetch_all(pool)
    .await?;
    Ok(rows.into_iter().map(Video::from).collect())
}

/// Returns true if a camp-owned video is visible to a student viewer.
///
/// Precedence (highest first):
///   1. `deleted_at IS NOT NULL` -> never visible.
///   2. Camp-scope override (`scope_kind='camp'`, `camp_id=camp_id`) present
///      -> its `visible` value wins.
///   3. No override: follow the global `hidden_at IS NULL` flag.
///
/// Coaches see all alive camp videos (including globally-hidden and
/// camp-hidden ones). For the student-facing list the SQL in
/// `list_videos_for_camp` encodes the same logic in a single LEFT JOIN
/// for efficiency; this function documents the canonical precedence.
#[allow(dead_code)]
fn effective_camp_video_visible(
    deleted_at_is_null: bool,
    camp_override: Option<bool>,
    hidden_at_is_null: bool,
) -> bool {
    if !deleted_at_is_null {
        return false;
    }
    match camp_override {
        Some(v) => v,
        None => hidden_at_is_null,
    }
}

/// Lists camp-owned videos applying CC-015 visibility precedence:
///   deleted -> excluded; camp-scope override present -> its `visible`;
///   else global `hidden_at IS NULL`.
///
/// Returns the effectively-visible subset for everyone today (coaches and
/// students alike). TODO(CC-015 follow-up): add a `viewer_is_coach` bypass so
/// coaches also see camp-hidden clips, badged, the way the syllabus surface
/// does for globally-hidden videos.
#[instrument(skip(pool))]
pub async fn list_videos_for_camp(
    pool: &Pool<Sqlite>,
    camp_id: i64,
) -> Result<Vec<Video>, AppError> {
    // The effective_camp_video_visible resolver is expressed directly in SQL
    // via a LEFT JOIN on the camp-scope override. The CASE matches the
    // precedence documented on effective_camp_video_visible above.
    let rows = sqlx::query_as!(
        DbVideo,
        r#"SELECT v.id, v.parent_kind, v.technique_id, v.student_id, v.thread_id,
                v.camp_id AS "camp_id?: i64",
                v.title, v.description, v.position, v.kind,
                v.processing_status, v.processing_error, v.storage_key, v.bytes,
                v.duration_seconds, v.width, v.height,
                v.external_url, v.external_host, v.external_video_id, v.uploaded_by_id,
                v.created_at, v.updated_at, v.hidden_at
         FROM videos v
         LEFT JOIN video_visibility_overrides ov
                ON ov.video_id = v.id
               AND ov.scope_kind = 'camp'
               AND ov.camp_id = ?1
         WHERE v.camp_id = ?1
           AND v.deleted_at IS NULL
           AND CASE
                 WHEN ov.visible IS NOT NULL THEN ov.visible
                 ELSE (v.hidden_at IS NULL)
               END = 1
         ORDER BY v.position ASC, v.id ASC"#,
        camp_id,
    )
    .fetch_all(pool)
    .await?;
    Ok(rows.into_iter().map(Video::from).collect())
}

/// Sets or clears a camp-scope visibility override for a video.
///
/// `visible=true` force-shows the video in this camp's list even if it
/// is globally hidden. `visible=false` hides it from the camp list for
/// students (coaches bypass the filter). The override row is upserted so
/// calling this again with a different value updates it in place.
///
/// Decision: keep a row for both visible=true and visible=false (no
/// delete-on-default). This mirrors `set_video_student_visibility` and
/// makes force-show explicit. A future "reset to default" action can call
/// `clear_video_override(pool, VisibilityScope::Camp(camp_id), video_id)`.
#[instrument(skip(pool))]
pub async fn set_video_camp_visibility(
    pool: &Pool<Sqlite>,
    video_id: i64,
    camp_id: i64,
    visible: bool,
    by_id: i64,
) -> Result<(), AppError> {
    set_video_override(pool, VisibilityScope::Camp(camp_id), video_id, visible, by_id).await
}

/// Lists videos for a technique, filtered to what `student_id` should
/// actually see (effective visibility: per-student override beats global
/// hide, soft-deleted videos always excluded).
#[deprecated(note = "Legacy per-student visibility join. Library reads should use \
            list_videos_for_technique_global_visible; syllabus-context \
            reads (PR 3+) use the per-syllabus override table.")]
#[instrument(skip(pool))]
pub async fn list_videos_for_technique_visible_to(
    pool: &Pool<Sqlite>,
    technique_id: i64,
    student_id: i64,
) -> Result<Vec<Video>, AppError> {
    let rows = sqlx::query_as!(
        DbVideo,
        r#"SELECT v.id, v.parent_kind, v.technique_id, v.student_id, v.thread_id,
                v.camp_id AS "camp_id?: i64",
                v.title, v.description, v.position, v.kind,
                v.processing_status, v.processing_error, v.storage_key, v.bytes,
                v.duration_seconds, v.width, v.height,
                v.external_url, v.external_host, v.external_video_id, v.uploaded_by_id,
                v.created_at, v.updated_at, v.hidden_at
         FROM videos v
         LEFT JOIN video_visibility_overrides vsv
                ON vsv.video_id = v.id
               AND vsv.scope_kind = 'student'
               AND vsv.student_id = ?
         WHERE v.technique_id = ?
           AND v.deleted_at IS NULL
           AND COALESCE(vsv.visible, v.hidden_at IS NULL) = 1
         ORDER BY v.position ASC, v.id ASC"#,
        student_id,
        technique_id,
    )
    .fetch_all(pool)
    .await?;
    Ok(rows.into_iter().map(Video::from).collect())
}

/// Returns the effective visibility for a single (video, student) pair.
/// Used by playback / download guards to refuse access if the student
/// shouldn't be able to see the video. Coaches bypass this check.
#[instrument(skip(pool))]
pub async fn video_visible_to_student(
    pool: &Pool<Sqlite>,
    video_id: i64,
    student_id: i64,
) -> Result<bool, AppError> {
    let row = sqlx::query!(
        "SELECT
            CASE
                WHEN v.deleted_at IS NOT NULL THEN 0
                WHEN ov.visible IS NOT NULL THEN ov.visible
                WHEN v.hidden_at IS NULL THEN 1
                ELSE 0
            END AS \"visible!: i64\"
         FROM videos v
         LEFT JOIN video_visibility_overrides ov
                ON ov.video_id = v.id
               AND ov.scope_kind = 'student'
               AND ov.student_id = ?
         WHERE v.id = ?",
        student_id,
        video_id,
    )
    .fetch_optional(pool)
    .await?;
    Ok(row.map(|r| r.visible != 0).unwrap_or(false))
}

/// Playback/download guard for direct-URL access. A globally-owned video is
/// reachable from multiple syllabi, so the student may see it if it is visible
/// under ANY of their (non-unassigned) assignments. Library/profile/thread
/// surfaces have their own reads; this guards the per-student video access.
///
/// Syllabus-owned tiers (technique / syllabus_technique / student_syllabus_technique)
/// are resolved through [`effective_video_visible`] against each of the
/// student's live assignments: visible under one is enough. The non-syllabus
/// surfaces the old guard implicitly served (student_profile / thread / loose)
/// were never per-syllabus scoped, so they fall back to the global rule
/// (`deleted_at` IS NULL AND `hidden_at` IS NULL).
#[instrument(skip(pool))]
pub async fn video_visible_to_student_anywhere(
    pool: &Pool<Sqlite>,
    video_id: i64,
    student_id: i64,
) -> Result<bool, AppError> {
    let parent_kind = sqlx::query_scalar!(
        r#"SELECT parent_kind AS "parent_kind!: String"
           FROM videos
           WHERE id = ? AND deleted_at IS NULL"#,
        video_id,
    )
    .fetch_optional(pool)
    .await?;
    let Some(parent_kind) = parent_kind else {
        // No live row (missing or soft-deleted) -> never visible.
        return Ok(false);
    };

    // Thread replies are scoped by their parent thread's visibility, NOT the
    // naive global hide. A student may play a reply only if they could see the
    // thread (broadcast, or they are its scope student). Coaches bypass this
    // function entirely at the call site.
    if parent_kind == "thread" {
        let row = sqlx::query!(
            r#"SELECT t.visibility,
                      t.scope_student_id AS "scope?: i64",
                      (v.hidden_at IS NULL) AS "not_hidden!: i64"
               FROM videos v
               JOIN threads t ON t.id = v.thread_id
               WHERE v.id = ? AND t.deleted_at IS NULL"#,
            video_id,
        )
        .fetch_optional(pool)
        .await?;
        let Some(row) = row else { return Ok(false); };
        let can_see = row.visibility == "broadcast" || row.scope == Some(student_id);
        return Ok(can_see && row.not_hidden != 0);
    }

    // Non-syllabus surfaces have no per-assignment scoping; follow the global
    // rule only. (deleted_at was already excluded above.)
    if !matches!(
        parent_kind.as_str(),
        "technique" | "syllabus_technique" | "student_syllabus_technique"
    ) {
        let visible = sqlx::query_scalar!(
            r#"SELECT (hidden_at IS NULL) AS "visible!: bool"
               FROM videos
               WHERE id = ?"#,
            video_id,
        )
        .fetch_one(pool)
        .await?;
        return Ok(visible);
    }

    // Syllabus-owned tiers: visible if effectively visible under ANY of the
    // student's live (non-unassigned) assignments.
    let assignment_ids = sqlx::query_scalar!(
        r#"SELECT id AS "id!: i64"
           FROM syllabus_assignments
           WHERE student_id = ? AND unassigned_at IS NULL"#,
        student_id,
    )
    .fetch_all(pool)
    .await?;

    for assignment_id in assignment_ids {
        if effective_video_visible(pool, video_id, assignment_id).await? {
            return Ok(true);
        }
    }
    Ok(false)
}

/// Single source of truth for whether a student sees a video within a given
/// assignment (an assignment row = a (student_id, syllabus_id) pair).
///
/// Precedence, highest first:
///   1. soft-deleted (`videos.deleted_at`)          -> never visible
///   2. owning-technique SST hidden (`student_syllabus_techniques.hidden_at`
///      for this assignment + the video's owning technique) -> hidden
///   3. assignment-scope override (`scope_kind='assignment'`, assignment_id=assignment_id)
///   4. syllabus-scope override   (`scope_kind='syllabus'`,   syllabus_id=assignment's syllabus_id)
///   5. student-scope override    (`scope_kind='student'`,    student_id=assignment's student_id)
///   6. owned-in-scope ? global `videos.hidden_at` : absent (not a candidate -> hidden)
///
/// "Owned-in-scope" means the video's parent tier resolves into this
/// assignment: T1 (technique) is owned by any assignment whose SST ladder
/// reaches the technique; T2 (syllabus_technique) only if that membership row
/// belongs to this assignment's syllabus; T3 (student_syllabus_technique) only
/// if that SST belongs to this assignment.
///
/// Resolving the owning technique across tiers (for the SST-hidden cascade and
/// the owned-in-scope test) is done with COALESCE over three LEFT JOINs:
///   - T1: `videos.technique_id` directly.
///   - T2: `syllabus_techniques.technique_id` via `videos.syllabus_technique_id`,
///     also yielding that membership's `syllabus_id` for the owned-in-scope test.
///   - T3: the video's `student_syllabus_technique_id`, whose row gives both the
///     `technique_id` and the `assignment_id` it belongs to.
/// The cascade SST is then the `student_syllabus_techniques` row for
/// (assignment_id, resolved owning technique_id).
#[instrument(skip(pool))]
pub async fn effective_video_visible(
    pool: &Pool<Sqlite>,
    video_id: i64,
    assignment_id: i64,
) -> Result<bool, AppError> {
    let row = sqlx::query!(
        r#"
        SELECT
            CASE
                -- 1. Soft delete trumps everything.
                WHEN v.deleted_at IS NOT NULL THEN 0
                -- Owned-in-scope gate: the video's parent tier must resolve into
                -- this assignment. T1 -> the technique is on the ladder (resolved
                -- technique_id is non-null); T2 -> the membership's syllabus equals
                -- this assignment's syllabus; T3 -> the parent SST is this
                -- assignment's SST. If not owned in scope, it's not a candidate.
                WHEN owning_technique_id IS NULL THEN 0
                WHEN v.parent_kind = 'syllabus_technique' AND st.syllabus_id IS NOT sa.syllabus_id THEN 0
                WHEN v.parent_kind = 'student_syllabus_technique' AND parent_sst.assignment_id IS NOT sa.id THEN 0
                -- 2. Owning-technique SST hidden for this assignment cascades a hide.
                WHEN cascade_sst.hidden_at IS NOT NULL THEN 0
                -- 3. Assignment-scope override (explicit show/hide).
                WHEN ov_assignment.visible IS NOT NULL THEN ov_assignment.visible
                -- 4. Syllabus-scope override.
                WHEN ov_syllabus.visible IS NOT NULL THEN ov_syllabus.visible
                -- 5. Student-scope override.
                WHEN ov_student.visible IS NOT NULL THEN ov_student.visible
                -- 6. No override: follow the global hide flag.
                WHEN v.hidden_at IS NULL THEN 1
                ELSE 0
            END AS "visible!: i64"
        FROM videos v
        -- The assignment under which we're resolving (gives student_id + syllabus_id).
        JOIN syllabus_assignments sa ON sa.id = ?2
        -- T2: the membership row, for its technique_id + syllabus_id.
        LEFT JOIN syllabus_techniques st
               ON st.id = v.syllabus_technique_id
        -- T3: the parent SST, for its technique_id + assignment_id.
        LEFT JOIN student_syllabus_techniques parent_sst
               ON parent_sst.id = v.student_syllabus_technique_id
        -- Resolve the owning technique across the three owning tiers.
        , (SELECT
              COALESCE(
                  (SELECT technique_id FROM videos WHERE id = ?1 AND parent_kind = 'technique'),
                  (SELECT technique_id FROM syllabus_techniques
                    WHERE id = (SELECT syllabus_technique_id FROM videos WHERE id = ?1)),
                  (SELECT technique_id FROM student_syllabus_techniques
                    WHERE id = (SELECT student_syllabus_technique_id FROM videos WHERE id = ?1))
              ) AS owning_technique_id
          ) owner
        -- 2. The cascade SST = this assignment's row for the owning technique.
        LEFT JOIN student_syllabus_techniques cascade_sst
               ON cascade_sst.assignment_id = sa.id
              AND cascade_sst.technique_id = owner.owning_technique_id
        -- 3/4/5. The three override scopes.
        LEFT JOIN video_visibility_overrides ov_assignment
               ON ov_assignment.video_id = v.id
              AND ov_assignment.scope_kind = 'assignment'
              AND ov_assignment.assignment_id = sa.id
        LEFT JOIN video_visibility_overrides ov_syllabus
               ON ov_syllabus.video_id = v.id
              AND ov_syllabus.scope_kind = 'syllabus'
              AND ov_syllabus.syllabus_id = sa.syllabus_id
        LEFT JOIN video_visibility_overrides ov_student
               ON ov_student.video_id = v.id
              AND ov_student.scope_kind = 'student'
              AND ov_student.student_id = sa.student_id
        WHERE v.id = ?1
        "#,
        video_id,
        assignment_id,
    )
    .fetch_optional(pool)
    .await?;
    Ok(row.map(|r| r.visible != 0).unwrap_or(false))
}

/// Number of rows moved by [`run_video_visibility_backfill`], for logging.
#[derive(Debug, Default, Clone, Copy)]
pub struct VideoVisibilityBackfillCounts {
    /// Rows copied from `student_syllabus_video_visibility` that had a
    /// matching assignment row.
    pub assignment_inserted: u64,
    /// `student_syllabus_video_visibility` rows skipped because no
    /// `syllabus_assignments` row exists for their (student, syllabus).
    pub assignment_orphaned: u64,
    /// Rows copied from `video_student_visibility`.
    pub student_inserted: u64,
}

/// Whether a base table exists in the connected SQLite database. Used by the
/// backfill to no-op against a DB whose legacy tables are already dropped.
async fn table_exists(pool: &Pool<Sqlite>, name: &str) -> Result<bool, AppError> {
    let found: Option<i64> = sqlx::query_scalar(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?",
    )
    .bind(name)
    .fetch_optional(pool)
    .await?;
    Ok(found.is_some())
}

/// One-shot idempotent backfill of the two legacy visibility tables into the
/// unified `video_visibility_overrides` table. Run once before the legacy
/// tables are dropped (see `bin/backfill_video_visibility.rs`).
///
/// Uses runtime queries (not the `query!` macros) on purpose: the legacy
/// tables are removed from `config/schema.sql` in this same change, so the
/// compile-time macro could no longer verify a read against them. The
/// backfill must still be able to read them at runtime on a not-yet-migrated
/// database.
///
/// Mapping (per the V3b decisions):
///   - `student_syllabus_video_visibility(student,syllabus,video)` ->
///     `('assignment', syllabus_assignments.id, video, visible)`. Rows with
///     NO matching assignment row are orphaned and skipped (counted).
///   - `video_student_visibility(student,video)` ->
///     `('student', student_id, video, visible)` (no fan-out).
///
/// Idempotent via `INSERT OR IGNORE` against the partial unique indexes
/// (`idx_vvo_student` / `idx_vvo_syllabus` / `idx_vvo_assignment`).
pub async fn run_video_visibility_backfill(
    pool: &Pool<Sqlite>,
) -> Result<VideoVisibilityBackfillCounts, AppError> {
    // Both legacy tables are dropped by the migration that ships with this
    // change. If they are already gone (the migration ran first, or a fresh DB
    // never had them) the backfill is a no-op.
    let has_ssvv = table_exists(pool, "student_syllabus_video_visibility").await?;
    let has_vsv = table_exists(pool, "video_student_visibility").await?;

    let mut tx = pool.begin().await?;

    let (assignment_inserted, assignment_orphaned) = if has_ssvv {
        // assignment scope: only rows that have a matching assignment.
        let assignment_res = sqlx::query(
            "INSERT OR IGNORE INTO video_visibility_overrides
                (scope_kind, assignment_id, video_id, visible, set_by_id, set_at)
             SELECT 'assignment', sa.id, ssvv.video_id, ssvv.visible,
                    ssvv.updated_by_id, ssvv.updated_at
             FROM student_syllabus_video_visibility ssvv
             JOIN syllabus_assignments sa
                  ON sa.student_id = ssvv.student_id
                 AND sa.syllabus_id = ssvv.syllabus_id",
        )
        .execute(&mut *tx)
        .await?;

        // Count orphans (ssvv rows with no matching assignment) for the log.
        let orphaned: i64 = sqlx::query_scalar(
            "SELECT COUNT(*)
             FROM student_syllabus_video_visibility ssvv
             WHERE NOT EXISTS (
                 SELECT 1 FROM syllabus_assignments sa
                 WHERE sa.student_id = ssvv.student_id
                   AND sa.syllabus_id = ssvv.syllabus_id
             )",
        )
        .fetch_one(&mut *tx)
        .await?;
        (assignment_res.rows_affected(), orphaned as u64)
    } else {
        (0, 0)
    };

    let student_inserted = if has_vsv {
        // student scope: straight copy, no fan-out.
        let student_res = sqlx::query(
            "INSERT OR IGNORE INTO video_visibility_overrides
                (scope_kind, student_id, video_id, visible, set_by_id, set_at)
             SELECT 'student', vsv.student_id, vsv.video_id, vsv.visible,
                    vsv.set_by_id, vsv.set_at
             FROM video_student_visibility vsv",
        )
        .execute(&mut *tx)
        .await?;
        student_res.rows_affected()
    } else {
        0
    };

    tx.commit().await?;

    let counts = VideoVisibilityBackfillCounts {
        assignment_inserted,
        assignment_orphaned,
        student_inserted,
    };
    info!(
        assignment_inserted = counts.assignment_inserted,
        assignment_orphaned = counts.assignment_orphaned,
        student_inserted = counts.student_inserted,
        "Backfilled legacy video visibility into video_visibility_overrides",
    );
    Ok(counts)
}

/// Upserts an explicit visibility override for a video at the given scope
/// (`student` / `syllabus` / `assignment`). `visible = true` forces the video
/// shown, `false` forces it hidden, within that scope. Absence of a row =
/// inherit (see [`effective_video_visible`]).
#[instrument(skip(pool))]
pub async fn set_video_override(
    pool: &Pool<Sqlite>,
    scope: VisibilityScope,
    video_id: i64,
    visible: bool,
    by_id: i64,
) -> Result<(), AppError> {
    let kind = scope.kind();
    let (student_id, syllabus_id, assignment_id, camp_id) = scope.columns();
    let mut tx = pool.begin().await?;
    sqlx::query!(
        "DELETE FROM video_visibility_overrides
         WHERE scope_kind = ?
           AND student_id IS ? AND syllabus_id IS ? AND assignment_id IS ? AND camp_id IS ?
           AND video_id = ?",
        kind, student_id, syllabus_id, assignment_id, camp_id, video_id,
    ).execute(&mut *tx).await?;
    sqlx::query!(
        "INSERT INTO video_visibility_overrides
            (scope_kind, student_id, syllabus_id, assignment_id, camp_id, video_id, visible, set_by_id, set_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)",
        kind, student_id, syllabus_id, assignment_id, camp_id, video_id, visible, by_id,
    ).execute(&mut *tx).await?;
    tx.commit().await?;
    Ok(())
}

/// Removes an explicit override at the given scope, reverting that scope to
/// inherited visibility. No-op if no row exists.
#[instrument(skip(pool))]
pub async fn clear_video_override(
    pool: &Pool<Sqlite>,
    scope: VisibilityScope,
    video_id: i64,
) -> Result<(), AppError> {
    let kind = scope.kind();
    let (student_id, syllabus_id, assignment_id, camp_id) = scope.columns();
    sqlx::query!(
        "DELETE FROM video_visibility_overrides
         WHERE scope_kind = ?
           AND student_id IS ? AND syllabus_id IS ? AND assignment_id IS ? AND camp_id IS ?
           AND video_id = ?",
        kind, student_id, syllabus_id, assignment_id, camp_id, video_id,
    )
    .execute(pool)
    .await?;
    Ok(())
}

/// Promotes a student-only (T3, `parent_kind='student_syllabus_technique'`)
/// video to a global library video (T1, `parent_kind='technique'`) in place,
/// preserving the `video.id` (and thus watch history). The owning technique is
/// resolved from the parent SST's `technique_id`. Any now-meaningless
/// visibility overrides on the video are cleared, since at the global tier the
/// per-(assignment/syllabus/student) hide overrides no longer make sense.
///
/// No-op (returns `Ok(false)`) if the video is not a T3 video or is deleted.
#[instrument(skip(pool))]
pub async fn promote_video_to_global(
    pool: &Pool<Sqlite>,
    video_id: i64,
) -> Result<bool, AppError> {
    let mut tx = pool.begin().await?;

    // Resolve the owning technique via the parent SST. Only T3 alive videos
    // are eligible.
    let technique_id: Option<i64> = sqlx::query_scalar!(
        r#"SELECT sst.technique_id AS "technique_id!: i64"
           FROM videos v
           JOIN student_syllabus_techniques sst
                  ON sst.id = v.student_syllabus_technique_id
           WHERE v.id = ?
             AND v.parent_kind = 'student_syllabus_technique'
             AND v.deleted_at IS NULL"#,
        video_id,
    )
    .fetch_optional(&mut *tx)
    .await?;

    let Some(technique_id) = technique_id else {
        tx.rollback().await?;
        return Ok(false);
    };

    // Re-parent in place: flip the typed columns to the technique tier.
    sqlx::query!(
        "UPDATE videos
         SET parent_kind = 'technique',
             technique_id = ?,
             student_syllabus_technique_id = NULL,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ?",
        technique_id,
        video_id,
    )
    .execute(&mut *tx)
    .await?;

    // Clear all per-scope visibility overrides; they were scoped to the old
    // student-only tier and no longer apply once the video is global.
    sqlx::query!(
        "DELETE FROM video_visibility_overrides WHERE video_id = ?",
        video_id,
    )
    .execute(&mut *tx)
    .await?;

    tx.commit().await?;
    Ok(true)
}

/// Marks rows stuck in `processing` for longer than `older_than_secs` seconds
/// as `failed`. Called periodically on the remote-processor path to time
/// out jobs that never delivered a callback.
///
/// Returns the number of rows updated.
#[instrument(skip(pool))]
pub async fn fail_stale_processing(
    pool: &Pool<Sqlite>,
    older_than_secs: i64,
) -> Result<u64, AppError> {
    let cutoff = format!("-{older_than_secs} seconds");
    let res = sqlx::query!(
        "UPDATE videos
         SET processing_status = 'failed',
             processing_error  = 'processing timed out',
             updated_at        = CURRENT_TIMESTAMP
         WHERE processing_status = 'processing'
           AND updated_at <= datetime('now', ?)",
        cutoff,
    )
    .execute(pool)
    .await?;
    Ok(res.rows_affected())
}

/// Flips every `processing` row to `failed` with a standard error message.
/// Called once at startup on the host-processor path to clear zombie rows that
/// were left in-flight when the previous process was killed mid-transcode.
/// Returns the number of rows updated.
pub async fn reconcile_interrupted_processing(pool: &Pool<Sqlite>) -> Result<u64, AppError> {
    let now = Utc::now().naive_utc();
    let res = sqlx::query!(
        "UPDATE videos
         SET processing_status = 'failed',
             processing_error = 'interrupted by restart',
             updated_at = ?
         WHERE processing_status = 'processing'",
        now,
    )
    .execute(pool)
    .await?;
    Ok(res.rows_affected())
}

/// Sets (or clears) the global hide flag on a video. Emits a fan-out
/// `video_visibility_set` activity row for every affected student.
#[instrument(skip(pool))]
pub async fn set_video_hidden_globally(
    pool: &Pool<Sqlite>,
    video_id: i64,
    hidden: bool,
    actor_id: i64,
) -> Result<bool, AppError> {
    let now = Utc::now().naive_utc();
    let technique_id = sqlx::query_scalar!(
        r#"SELECT technique_id AS "technique_id?: i64" FROM videos WHERE id = ?"#,
        video_id,
    )
    .fetch_one(pool)
    .await?;
    let mut tx = pool.begin().await?;
    let result = if hidden {
        sqlx::query!(
            "UPDATE videos SET hidden_at = ?, updated_at = ?
             WHERE id = ? AND deleted_at IS NULL AND hidden_at IS NULL",
            now,
            now,
            video_id,
        )
        .execute(&mut *tx)
        .await?
    } else {
        sqlx::query!(
            "UPDATE videos SET hidden_at = NULL, updated_at = ?
             WHERE id = ? AND deleted_at IS NULL AND hidden_at IS NOT NULL",
            now,
            video_id,
        )
        .execute(&mut *tx)
        .await?
    };
    // Only technique-parented videos have syllabus students to fan out to.
    // Profile/thread/loose videos have no such audience, so skip the emit.
    if let Some(technique_id) = technique_id {
        emit_broadcast(
            &mut tx,
            NewActivity::new(Verb::VideoVisibilitySet, actor_id)
                .video(video_id)
                .technique(technique_id)
                .payload(payload::video_visibility_set("global", !hidden)),
        )
        .await?;
    }
    tx.commit().await?;
    Ok(result.rows_affected() > 0)
}

/// Sets, updates, or clears the per-student visibility override for a
/// video. `Some(true)` = always show, `Some(false)` = always hide,
/// `None` = clear the override (revert to following the global default).
#[instrument(skip(pool))]
pub async fn set_video_student_visibility(
    pool: &Pool<Sqlite>,
    video_id: i64,
    student_id: i64,
    visible: Option<bool>,
    actor_id: i64,
) -> Result<(), AppError> {
    match visible {
        Some(b) => {
            set_video_override(pool, VisibilityScope::Student(student_id), video_id, b, actor_id)
                .await?
        }
        None => {
            clear_video_override(pool, VisibilityScope::Student(student_id), video_id).await?
        }
    }
    Ok(())
}

/// Returns a map of video_id -> override.visible for a batch of videos
/// against a single student. Used to annotate the coach's view of a
/// student's technique page.
#[instrument(skip(pool, video_ids))]
pub async fn list_video_student_overrides(
    pool: &Pool<Sqlite>,
    video_ids: &[i64],
    student_id: i64,
) -> Result<HashMap<i64, bool>, AppError> {
    if video_ids.is_empty() {
        return Ok(HashMap::new());
    }
    // sqlx can't bind a Vec directly into IN (...); build a CSV placeholder
    // list. Inputs are i64 read from our own DB, so the format is safe.
    let placeholders = video_ids
        .iter()
        .map(|id| id.to_string())
        .collect::<Vec<_>>()
        .join(",");
    let sql = format!(
        "SELECT video_id, visible FROM video_visibility_overrides
         WHERE scope_kind = 'student' AND student_id = ? AND video_id IN ({placeholders})"
    );
    let rows: Vec<(i64, bool)> = sqlx::query_as(&sql)
        .bind(student_id)
        .fetch_all(pool)
        .await?;
    Ok(rows.into_iter().collect())
}

#[instrument(skip(pool))]
pub async fn update_video_metadata(
    pool: &Pool<Sqlite>,
    id: i64,
    title: Option<&str>,
    description: Option<Option<&str>>,
    position: Option<i64>,
) -> Result<(), AppError> {
    let now = Utc::now().naive_utc();
    if let Some(title) = title {
        sqlx::query!(
            "UPDATE videos SET title = ?, updated_at = ? WHERE id = ?",
            title,
            now,
            id
        )
        .execute(pool)
        .await?;
    }
    if let Some(description) = description {
        sqlx::query!(
            "UPDATE videos SET description = ?, updated_at = ? WHERE id = ?",
            description,
            now,
            id,
        )
        .execute(pool)
        .await?;
    }
    if let Some(position) = position {
        sqlx::query!(
            "UPDATE videos SET position = ?, updated_at = ? WHERE id = ?",
            position,
            now,
            id,
        )
        .execute(pool)
        .await?;
    }
    Ok(())
}

#[instrument(skip(pool))]
pub async fn reorder_videos(
    pool: &Pool<Sqlite>,
    technique_id: i64,
    ordered_ids: &[i64],
) -> Result<(), AppError> {
    let mut tx = pool.begin().await?;
    let now = Utc::now().naive_utc();
    for (index, video_id) in ordered_ids.iter().enumerate() {
        let position = index as i64;
        sqlx::query!(
            "UPDATE videos
             SET position = ?, updated_at = ?
             WHERE id = ? AND technique_id = ? AND parent_kind = 'technique' AND deleted_at IS NULL",
            position,
            now,
            video_id,
            technique_id,
        )
        .execute(&mut *tx)
        .await?;
    }
    tx.commit().await?;
    Ok(())
}

/// Soft-deletes a video. The row, storage_key, and watch history stay
/// intact so the video can be recovered by clearing `deleted_at`. Read
/// queries filter out deleted rows, so the video disappears from the UI.
/// Returns `true` if a row was marked deleted (matched and was alive).
#[instrument(skip(pool))]
pub async fn delete_video(pool: &Pool<Sqlite>, id: i64) -> Result<bool, AppError> {
    let now = Utc::now().naive_utc();
    let result = sqlx::query!(
        "UPDATE videos
         SET deleted_at = ?, updated_at = ?
         WHERE id = ? AND deleted_at IS NULL",
        now,
        now,
        id,
    )
    .execute(pool)
    .await?;
    Ok(result.rows_affected() > 0)
}

#[instrument(skip(pool))]
pub async fn reset_video_to_processing(pool: &Pool<Sqlite>, id: i64) -> Result<(), AppError> {
    let status = ProcessingStatus::Processing.as_str();
    let kind = VideoKind::Native.as_str();
    let now = Utc::now().naive_utc();
    sqlx::query!(
        "UPDATE videos
         SET processing_status = ?,
             processing_error = NULL,
             kind = ?,
             external_url = NULL,
             external_host = NULL,
             external_video_id = NULL,
             updated_at = ?
         WHERE id = ?",
        status,
        kind,
        now,
        id,
    )
    .execute(pool)
    .await?;
    Ok(())
}

#[instrument(skip(pool))]
pub async fn clear_video_watch_state(pool: &Pool<Sqlite>, video_id: i64) -> Result<(), AppError> {
    let mut tx = pool.begin().await?;
    sqlx::query!(
        "DELETE FROM video_watch_events WHERE video_id = ?",
        video_id
    )
    .execute(&mut *tx)
    .await?;
    sqlx::query!(
        "DELETE FROM video_watch_aggregates WHERE video_id = ?",
        video_id
    )
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(())
}

// Storage stats include soft-deleted videos on purpose: their blobs are
// still in R2 and still cost storage until a future hard-purge step
// removes them.
#[instrument(skip(pool))]
pub async fn total_video_storage_bytes(pool: &Pool<Sqlite>) -> Result<i64, AppError> {
    let row = sqlx::query!(
        "SELECT COALESCE(SUM(bytes), 0) AS total
         FROM videos
         WHERE storage_key IS NOT NULL"
    )
    .fetch_one(pool)
    .await?;
    Ok(row.total)
}

#[instrument(skip(pool))]
pub async fn total_video_objects(pool: &Pool<Sqlite>) -> Result<i64, AppError> {
    let row = sqlx::query!(
        "SELECT COUNT(*) AS count
         FROM videos
         WHERE storage_key IS NOT NULL"
    )
    .fetch_one(pool)
    .await?;
    Ok(row.count)
}

/// Sets, updates, or clears the per-(student, syllabus, video) override.
/// `Some(b)` upserts the row with that visibility flag; `None` removes
/// the row so the video falls back to its global visibility. Always emits
/// a per-student `video_visibility_set` activity row (non-notifiable).
#[instrument(skip(pool))]
pub async fn set_video_syllabus_visibility(
    pool: &Pool<Sqlite>,
    video_id: i64,
    syllabus_id: i64,
    student_id: i64,
    visible: Option<bool>,
    by_user_id: i64,
) -> Result<(), AppError> {
    // Resolve the assignment row for this (student, syllabus); the per-syllabus
    // override now lives at 'assignment' scope in video_visibility_overrides.
    let assignment_id = sqlx::query_scalar!(
        r#"SELECT id AS "id!: i64"
           FROM syllabus_assignments
           WHERE student_id = ? AND syllabus_id = ?"#,
        student_id,
        syllabus_id,
    )
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| AppError::NotFound("no assignment for (student, syllabus)".into()))?;

    match visible {
        Some(b) => {
            set_video_override(
                pool,
                VisibilityScope::Assignment(assignment_id),
                video_id,
                b,
                by_user_id,
            )
            .await?
        }
        None => {
            clear_video_override(pool, VisibilityScope::Assignment(assignment_id), video_id)
                .await?
        }
    }

    let mut tx = pool.begin().await?;
    emit(
        &mut tx,
        NewActivity::new(Verb::VideoVisibilitySet, by_user_id)
            .target_student(student_id)
            .video(video_id)
            .payload(payload::video_visibility_set(
                "student",
                visible.unwrap_or(true),
            )),
    )
    .await?;
    tx.commit().await?;
    Ok(())
}

/// Returns a map of `video_id -> override.visible` for the given video
/// ids within the (student, syllabus) scope. Used to annotate the coach's
/// view of the per-syllabus video list with which entries are overridden
/// vs following global visibility.
#[instrument(skip(pool, video_ids))]
pub async fn list_video_syllabus_overrides(
    pool: &Pool<Sqlite>,
    video_ids: &[i64],
    syllabus_id: i64,
    student_id: i64,
) -> Result<std::collections::HashMap<i64, bool>, AppError> {
    use std::collections::HashMap;
    if video_ids.is_empty() {
        return Ok(HashMap::new());
    }
    // The per-syllabus override now lives at 'assignment' scope in
    // video_visibility_overrides. Resolve the assignment for this
    // (student, syllabus); if none, there are no overrides to report.
    let assignment_id = sqlx::query_scalar!(
        r#"SELECT id AS "id!: i64"
           FROM syllabus_assignments
           WHERE student_id = ? AND syllabus_id = ?"#,
        student_id,
        syllabus_id,
    )
    .fetch_optional(pool)
    .await?;
    let Some(assignment_id) = assignment_id else {
        return Ok(HashMap::new());
    };
    // Build an IN-list via query_builder so we keep the dynamic-length
    // shape that SQLx's compile-time macro doesn't handle.
    let mut qb = sqlx::QueryBuilder::<sqlx::Sqlite>::new(
        "SELECT video_id, visible FROM video_visibility_overrides \
         WHERE scope_kind = 'assignment' AND assignment_id = ",
    );
    qb.push_bind(assignment_id);
    qb.push(" AND video_id IN (");
    let mut sep = qb.separated(", ");
    for id in video_ids {
        sep.push_bind(*id);
    }
    qb.push(")");
    let rows = qb.build().fetch_all(pool).await?;
    let mut map: HashMap<i64, bool> = HashMap::new();
    for row in rows {
        use sqlx::Row;
        let video_id: i64 = row.try_get("video_id")?;
        let visible: bool = row.try_get("visible")?;
        map.insert(video_id, visible);
    }
    Ok(map)
}

// ---------------------------------------------------------------------------
// Browse helpers: power the "Choose from Sillybus" navigator.
// ---------------------------------------------------------------------------

/// Whose eyes a browse runs through.
///
/// A student caller can only ever be given `Student { include_other_students:
/// false }` with their own id; the route enforces that, because widening is a
/// coach capability. Both widened forms reach every student's camps, so the
/// difference between them is only whether a student is in context at all: with
/// one, the syllabuses source still means something.
#[derive(Debug, Clone, Copy)]
pub enum BrowseScope {
    Student {
        id: i64,
        include_other_students: bool,
    },
    AllStudents,
}

impl BrowseScope {
    /// The student whose own surfaces this browse is centred on, if any.
    pub fn student_id(self) -> Option<i64> {
        match self {
            BrowseScope::Student { id, .. } => Some(id),
            BrowseScope::AllStudents => None,
        }
    }

    /// Whether camps and search reach past the student in context.
    pub fn is_widened(self) -> bool {
        !matches!(
            self,
            BrowseScope::Student {
                include_other_students: false,
                ..
            }
        )
    }
}

/// A parent row returned by the browse-parents endpoints. Carries enough
/// context to render a choosable entry in the navigator.
#[derive(Debug, Clone)]
pub struct BrowseParent {
    pub id: i64,
    pub name: String,
    pub video_count: i64,
}

/// Which surface a browsed clip was found on. `provenance` says the same thing
/// for a reader; this says it for code, so a caller can tell a clip that is
/// already public from one that lives on a single student's surface.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub enum BrowseSource {
    Library,
    Camp,
    Syllabus,
}

/// A video row returned by the browse-videos endpoints.
#[derive(Debug, Clone)]
pub struct BrowseVideo {
    pub id: i64,
    pub title: Option<String>,
    pub duration_seconds: Option<i64>,
    pub external_url: Option<String>,
    /// Human-readable provenance label, e.g. "library · Armbar".
    pub provenance: String,
    pub source: BrowseSource,
}

/// Library source: returns globally-visible (hidden_at IS NULL, deleted_at IS
/// NULL) technique rows that have at least one such video. The browse surface
/// uses the global visibility rule for the library (same as
/// `list_videos_for_technique_global_visible`); per-assignment overrides do
/// not apply here.
#[instrument(skip(pool))]
pub async fn browse_library_parents(pool: &Pool<Sqlite>) -> Result<Vec<BrowseParent>, AppError> {
    let rows = sqlx::query!(
        r#"SELECT t.id AS "id!: i64", t.name AS "name!: String",
                  COUNT(v.id) AS "video_count!: i64"
           FROM techniques t
           JOIN videos v ON v.technique_id = t.id
                        AND v.parent_kind = 'technique'
                        AND v.deleted_at IS NULL
                        AND v.hidden_at IS NULL
           WHERE t.is_global = 1
           GROUP BY t.id
           HAVING COUNT(v.id) > 0
           ORDER BY t.name ASC"#
    )
    .fetch_all(pool)
    .await?;
    Ok(rows
        .into_iter()
        .map(|r| BrowseParent {
            id: r.id,
            name: r.name,
            video_count: r.video_count,
        })
        .collect())
}

/// Library source drill-in: videos for a specific technique that are globally
/// visible (hidden_at IS NULL). Mirrors `list_videos_for_technique_global_visible`.
#[instrument(skip(pool))]
pub async fn browse_library_videos_for_technique(
    pool: &Pool<Sqlite>,
    technique_id: i64,
) -> Result<Vec<BrowseVideo>, AppError> {
    let technique_name: Option<String> = sqlx::query_scalar!(
        r#"SELECT name FROM techniques WHERE id = ?"#,
        technique_id,
    )
    .fetch_optional(pool)
    .await?;
    let label = technique_name.unwrap_or_else(|| "technique".into());
    let rows = sqlx::query!(
        r#"SELECT id AS "id!: i64", title AS "title?: String",
                  duration_seconds AS "duration_seconds?: i64",
                  external_url AS "external_url?: String"
           FROM videos
           WHERE technique_id = ?
             AND parent_kind = 'technique'
             AND deleted_at IS NULL
             AND hidden_at IS NULL
           ORDER BY position ASC, id ASC"#,
        technique_id,
    )
    .fetch_all(pool)
    .await?;
    Ok(rows
        .into_iter()
        .map(|r| BrowseVideo {
            id: r.id,
            title: r.title,
            duration_seconds: r.duration_seconds,
            external_url: r.external_url,
            provenance: format!("library · {label}"),
            source: BrowseSource::Library,
        })
        .collect())
}

/// Camps source: non-archived camps with at least one student-visible video
/// (applying camp-scope overrides). Narrowed to the student in context unless
/// the scope is widened, in which case each camp is labelled with its owner so
/// two camps of the same name stay apart.
#[instrument(skip(pool))]
pub async fn browse_camp_parents(
    pool: &Pool<Sqlite>,
    scope: BrowseScope,
) -> Result<Vec<BrowseParent>, AppError> {
    let owner_filter = camp_owner_filter(scope);
    // A camp's videos are its own footage plus every clip posted into it, since
    // attaching a clip to a camp thread reparents it to that thread and clears
    // camp_id. Visibility follows `list_videos_for_camp`: camp-scope override
    // present -> its value; otherwise hidden_at IS NULL.
    let rows = sqlx::query!(
        r#"SELECT c.id AS "id!: i64", c.name AS "name!: String",
                  COALESCE(u.display_name, u.username, '') AS "owner!: String",
                  COUNT(DISTINCT v.id) AS "video_count!: i64"
           FROM camps c
           JOIN users u ON u.id = c.student_id
           JOIN videos v ON v.id IN (
                    SELECT vc.id FROM videos vc WHERE vc.camp_id = c.id
                    UNION
                    SELECT th.attached_video_id FROM threads th
                     WHERE th.camp_id = c.id
                       AND th.anchor_kind IN ('camp', 'camp_technique')
                       AND th.deleted_at IS NULL
                       AND th.attached_video_id IS NOT NULL
                    UNION
                    SELECT tc.video_id FROM thread_comments tc
                     JOIN threads tt ON tt.id = tc.thread_id
                     WHERE tt.camp_id = c.id
                       AND tt.anchor_kind IN ('camp', 'camp_technique')
                       AND tt.deleted_at IS NULL
                       AND tc.deleted_at IS NULL
                       AND tc.video_id IS NOT NULL
                )
                        AND v.deleted_at IS NULL
           LEFT JOIN video_visibility_overrides ov
                  ON ov.video_id = v.id
                 AND ov.scope_kind = 'camp'
                 AND ov.camp_id = c.id
           WHERE (?1 IS NULL OR c.student_id = ?1)
             AND c.archived_at IS NULL
             AND CASE
                   WHEN ov.visible IS NOT NULL THEN ov.visible
                   ELSE (v.hidden_at IS NULL)
                 END = 1
           GROUP BY c.id
           HAVING COUNT(DISTINCT v.id) > 0
           ORDER BY c.created_at DESC"#,
        owner_filter,
    )
    .fetch_all(pool)
    .await?;
    Ok(rows
        .into_iter()
        .map(|r| BrowseParent {
            id: r.id,
            name: camp_label(&r.name, &r.owner, scope),
            video_count: r.video_count,
        })
        .collect())
}

/// The `student_id` a camp query filters on, or `None` once widened.
fn camp_owner_filter(scope: BrowseScope) -> Option<i64> {
    if scope.is_widened() {
        None
    } else {
        scope.student_id()
    }
}

/// A widened browse shows camps belonging to several students, so the owner has
/// to be on the label to tell two "Comp prep" camps apart.
fn camp_label(camp_name: &str, owner: &str, scope: BrowseScope) -> String {
    if scope.is_widened() && !owner.is_empty() {
        format!("{camp_name} ({owner})")
    } else {
        camp_name.to_string()
    }
}

/// Camps source drill-in: the camp's own footage plus every clip posted into
/// its threads, filtered by the camp-scope overrides (same rule as
/// `list_videos_for_camp`). Unwidened the camp must belong to the student in
/// context, otherwise this returns empty; the route checks too, but the guard
/// lives here so the function cannot be misused.
#[instrument(skip(pool))]
pub async fn browse_camp_videos(
    pool: &Pool<Sqlite>,
    camp_id: i64,
    scope: BrowseScope,
) -> Result<Vec<BrowseVideo>, AppError> {
    let owner_filter = camp_owner_filter(scope);
    let camp = sqlx::query!(
        r#"SELECT c.name AS "name!: String",
                  COALESCE(u.display_name, u.username, '') AS "owner!: String"
           FROM camps c
           JOIN users u ON u.id = c.student_id
           WHERE c.id = ?1
             AND (?2 IS NULL OR c.student_id = ?2)
             AND c.archived_at IS NULL"#,
        camp_id,
        owner_filter,
    )
    .fetch_optional(pool)
    .await?;
    let Some(camp) = camp else {
        return Ok(Vec::new());
    };
    let camp_name = camp_label(&camp.name, &camp.owner, scope);
    let rows = sqlx::query!(
        r#"SELECT v.id AS "id!: i64", v.title AS "title?: String",
                  v.duration_seconds AS "duration_seconds?: i64",
                  v.external_url AS "external_url?: String",
                  COALESCE(
                      (SELECT th.body FROM threads th
                        WHERE th.attached_video_id = v.id
                          AND th.camp_id = ?1
                          AND th.deleted_at IS NULL
                        ORDER BY th.id LIMIT 1),
                      (SELECT tc.body FROM thread_comments tc
                        JOIN threads tt ON tt.id = tc.thread_id
                       WHERE tc.video_id = v.id
                         AND tt.camp_id = ?1
                         AND tc.deleted_at IS NULL
                       ORDER BY tc.id LIMIT 1)
                  ) AS "post_body?: String"
           FROM videos v
           LEFT JOIN video_visibility_overrides ov
                  ON ov.video_id = v.id
                 AND ov.scope_kind = 'camp'
                 AND ov.camp_id = ?1
           WHERE v.id IN (
                   SELECT vc.id FROM videos vc WHERE vc.camp_id = ?1
                   UNION
                   SELECT th.attached_video_id FROM threads th
                    WHERE th.camp_id = ?1
                      AND th.anchor_kind IN ('camp', 'camp_technique')
                      AND th.deleted_at IS NULL
                      AND th.attached_video_id IS NOT NULL
                   UNION
                   SELECT tc.video_id FROM thread_comments tc
                    JOIN threads tt ON tt.id = tc.thread_id
                    WHERE tt.camp_id = ?1
                      AND tt.anchor_kind IN ('camp', 'camp_technique')
                      AND tt.deleted_at IS NULL
                      AND tc.deleted_at IS NULL
                      AND tc.video_id IS NOT NULL
                 )
             AND v.deleted_at IS NULL
             AND CASE
                   WHEN ov.visible IS NOT NULL THEN ov.visible
                   ELSE (v.hidden_at IS NULL)
                 END = 1
           ORDER BY v.position ASC, v.id ASC"#,
        camp_id,
    )
    .fetch_all(pool)
    .await?;
    Ok(rows
        .into_iter()
        .map(|r| BrowseVideo {
            id: r.id,
            title: name_or_post_opening(r.title.as_deref(), r.post_body.as_deref()),
            duration_seconds: r.duration_seconds,
            external_url: r.external_url,
            provenance: format!("camp · {camp_name}"),
            source: BrowseSource::Camp,
        })
        .collect())
}

/// What to call a clip in a picker. An untitled clip posted into a camp borrows
/// the opening of the post that carried it, which is the only thing anyone
/// wrote about it.
fn name_or_post_opening(title: Option<&str>, post_body: Option<&str>) -> Option<String> {
    if let Some(t) = title.map(str::trim).filter(|t| !t.is_empty()) {
        return Some(t.to_string());
    }
    let opening = post_body?.lines().find(|l| !l.trim().is_empty())?.trim();
    if opening.is_empty() {
        return None;
    }
    const MAX: usize = 60;
    if opening.chars().count() <= MAX {
        return Some(opening.to_string());
    }
    let cut: String = opening.chars().take(MAX).collect();
    Some(format!("{}…", cut.trim_end()))
}

/// Syllabuses source: the student's active (non-unassigned) syllabuses that
/// have at least one video visible to the student in that syllabus context.
///
/// The per-syllabus visibility model is complex (assignment > syllabus >
/// student override, SST-hidden cascade). For the parent COUNT here we use a
/// conservative proxy: count T1 globally-visible technique videos reachable
/// via the assignment's SST ladder. Full `effective_video_visible` filtering
/// happens at drill-in time. This may over-count if overrides hide some
/// videos, but that is preferable to an expensive per-row call here.
#[instrument(skip(pool))]
pub async fn browse_syllabus_parents(
    pool: &Pool<Sqlite>,
    student_id: i64,
) -> Result<Vec<BrowseParent>, AppError> {
    let rows = sqlx::query!(
        r#"SELECT sa.syllabus_id AS "id!: i64",
                  s.name AS "name!: String",
                  COUNT(DISTINCT v.id) AS "video_count!: i64"
           FROM syllabus_assignments sa
           JOIN syllabi s ON s.id = sa.syllabus_id
           -- All SST rows for this assignment (technique membership).
           JOIN student_syllabus_techniques sst ON sst.assignment_id = sa.id
           -- T1 videos for those techniques that are globally visible.
           JOIN videos v ON v.technique_id = sst.technique_id
                        AND v.parent_kind = 'technique'
                        AND v.deleted_at IS NULL
                        AND v.hidden_at IS NULL
           WHERE sa.student_id = ?
             AND sa.unassigned_at IS NULL
           GROUP BY sa.syllabus_id
           HAVING COUNT(DISTINCT v.id) > 0
           ORDER BY s.name ASC"#,
        student_id,
    )
    .fetch_all(pool)
    .await?;
    Ok(rows
        .into_iter()
        .map(|r| BrowseParent {
            id: r.id,
            name: r.name,
            video_count: r.video_count,
        })
        .collect())
}

/// Syllabuses source drill-in: videos visible to the student across all
/// techniques in a given syllabus assignment.
///
/// Uses `list_videos_for_technique_in_syllabus_visible_to` (which calls
/// `effective_video_visible`) per technique, so the full override precedence
/// applies. This is N+1 by technique but the technique count is small for any
/// single syllabus and correctness beats a single large query here.
#[instrument(skip(pool))]
pub async fn browse_syllabus_videos(
    pool: &Pool<Sqlite>,
    syllabus_id: i64,
    student_id: i64,
) -> Result<Vec<BrowseVideo>, AppError> {
    // Verify the student has an active assignment for this syllabus.
    let syllabus_name: Option<String> = sqlx::query_scalar!(
        r#"SELECT s.name
           FROM syllabus_assignments sa
           JOIN syllabi s ON s.id = sa.syllabus_id
           WHERE sa.student_id = ? AND sa.syllabus_id = ? AND sa.unassigned_at IS NULL
           LIMIT 1"#,
        student_id,
        syllabus_id,
    )
    .fetch_optional(pool)
    .await?;
    let Some(syllabus_name) = syllabus_name else {
        return Ok(Vec::new());
    };

    // Enumerate the techniques on this syllabus, ordered by SST position.
    let technique_rows = sqlx::query!(
        r#"SELECT DISTINCT sst.technique_id AS "technique_id!: i64",
                  t.name AS "technique_name!: String"
           FROM syllabus_assignments sa
           JOIN student_syllabus_techniques sst ON sst.assignment_id = sa.id
           JOIN techniques t ON t.id = sst.technique_id
           WHERE sa.student_id = ? AND sa.syllabus_id = ? AND sa.unassigned_at IS NULL
           ORDER BY t.name ASC"#,
        student_id,
        syllabus_id,
    )
    .fetch_all(pool)
    .await?;

    let mut results: Vec<BrowseVideo> = Vec::new();
    for tech in technique_rows {
        let videos = list_videos_for_technique_in_syllabus_visible_to(
            pool,
            tech.technique_id,
            syllabus_id,
            student_id,
        )
        .await?;
        for v in videos {
            let provenance = format!("{syllabus_name} · {}", tech.technique_name);
            results.push(BrowseVideo {
                id: v.id,
                title: if v.title.is_empty() { None } else { Some(v.title) },
                duration_seconds: v.duration_seconds,
                external_url: v.external_url,
                provenance,
                source: BrowseSource::Syllabus,
            });
        }
    }
    Ok(results)
}

/// Flat text search across every video the scope can reach: library (global),
/// camps (camp-scope overrides), and syllabus (effective visibility).
///
/// Only the library filter is applied inline. Camps and syllabuses reuse the
/// drill-in helpers and filter afterwards, because both apply rules too awkward
/// to restate here: a camp's clips are reachable through its threads as well as
/// its own footage, and a syllabus video's visibility resolves per assignment.
/// Going through the helpers is also what gives an untitled camp clip the same
/// borrowed name here that it has when browsing. The search term is lowercased
/// for a case-insensitive match.
#[instrument(skip(pool))]
pub async fn search_videos(
    pool: &Pool<Sqlite>,
    scope: BrowseScope,
    query: &str,
) -> Result<Vec<BrowseVideo>, AppError> {
    let pattern = format!("%{}%", query.to_lowercase());
    let mut results: Vec<BrowseVideo> = Vec::new();

    // --- Library (T1, globally visible) ---
    let lib_rows = sqlx::query!(
        r#"SELECT v.id AS "id!: i64", v.title AS "title?: String",
                  v.duration_seconds AS "duration_seconds?: i64",
                  v.external_url AS "external_url?: String",
                  t.name AS "technique_name!: String"
           FROM videos v
           JOIN techniques t ON t.id = v.technique_id
           WHERE v.parent_kind = 'technique'
             AND v.deleted_at IS NULL
             AND v.hidden_at IS NULL
             AND LOWER(COALESCE(v.title, '')) LIKE ?
           ORDER BY t.name ASC, v.position ASC, v.id ASC"#,
        pattern,
    )
    .fetch_all(pool)
    .await?;
    for r in lib_rows {
        results.push(BrowseVideo {
            id: r.id,
            title: r.title,
            duration_seconds: r.duration_seconds,
            external_url: r.external_url,
            provenance: format!("library · {}", r.technique_name),
            source: BrowseSource::Library,
        });
    }

    // --- Camps (camp-scope visibility, clips reachable via threads too) ---
    let needle = query.to_lowercase();
    for camp in browse_camp_parents(pool, scope).await? {
        for video in browse_camp_videos(pool, camp.id, scope).await? {
            let matches = video
                .title
                .as_deref()
                .is_some_and(|t| t.to_lowercase().contains(&needle));
            if matches {
                results.push(video);
            }
        }
    }

    // --- Syllabuses (effective visibility per assignment) ---
    // Enumerate the student's active assignments, then check each technique's
    // T1 videos through effective_video_visible. We filter by title in Rust
    // after the visibility check rather than adding another complex SQL query.
    // Skipped without a student: visibility here resolves per assignment, so
    // "every student's syllabus" is not a thing this can answer.
    let Some(student_id) = scope.student_id() else {
        let mut seen = std::collections::HashSet::<i64>::new();
        results.retain(|v| seen.insert(v.id));
        return Ok(results);
    };
    let assignments = sqlx::query!(
        r#"SELECT sa.id AS "id!: i64", sa.syllabus_id AS "syllabus_id!: i64",
                  s.name AS "syllabus_name!: String"
           FROM syllabus_assignments sa
           JOIN syllabi s ON s.id = sa.syllabus_id
           WHERE sa.student_id = ? AND sa.unassigned_at IS NULL
           ORDER BY s.name ASC"#,
        student_id,
    )
    .fetch_all(pool)
    .await?;

    for assignment in assignments {
        // Techniques in this assignment.
        let techs = sqlx::query!(
            r#"SELECT DISTINCT sst.technique_id AS "technique_id!: i64",
                      t.name AS "technique_name!: String"
               FROM student_syllabus_techniques sst
               JOIN techniques t ON t.id = sst.technique_id
               WHERE sst.assignment_id = ?
               ORDER BY t.name ASC"#,
            assignment.id,
        )
        .fetch_all(pool)
        .await?;

        for tech in techs {
            let videos = list_videos_for_technique_in_syllabus_visible_to(
                pool,
                tech.technique_id,
                assignment.syllabus_id,
                student_id,
            )
            .await?;
            for v in videos {
                let title_lc = v.title.to_lowercase();
                if !title_lc.contains(query.to_lowercase().as_str()) {
                    continue;
                }
                let provenance = format!(
                    "{} · {}",
                    assignment.syllabus_name, tech.technique_name
                );
                results.push(BrowseVideo {
                    id: v.id,
                    title: if v.title.is_empty() { None } else { Some(v.title) },
                    duration_seconds: v.duration_seconds,
                    external_url: v.external_url,
                    provenance,
                    source: BrowseSource::Syllabus,
                });
            }
        }
    }

    // Deduplicate by video id (a video might appear in both library and
    // syllabus context) - keep the first occurrence.
    let mut seen = std::collections::HashSet::<i64>::new();
    results.retain(|v| seen.insert(v.id));

    Ok(results)
}

#[cfg(test)]
mod parent_tests {
    use super::*;

    #[test]
    fn parent_columns_map_each_kind_to_exactly_one_id() {
        assert_eq!(
            VideoParent::Technique(7).columns(),
            ParentColumns { kind: "technique", technique_id: Some(7), student_id: None, thread_id: None, syllabus_technique_id: None, student_syllabus_technique_id: None, camp_id: None }
        );
        assert_eq!(
            VideoParent::StudentProfile(3).columns(),
            ParentColumns { kind: "student_profile", technique_id: None, student_id: Some(3), thread_id: None, syllabus_technique_id: None, student_syllabus_technique_id: None, camp_id: None }
        );
        assert_eq!(
            VideoParent::Thread(11).columns(),
            ParentColumns { kind: "thread", technique_id: None, student_id: None, thread_id: Some(11), syllabus_technique_id: None, student_syllabus_technique_id: None, camp_id: None }
        );
        assert_eq!(
            VideoParent::SyllabusTechnique(5).columns(),
            ParentColumns { kind: "syllabus_technique", technique_id: None, student_id: None, thread_id: None, syllabus_technique_id: Some(5), student_syllabus_technique_id: None, camp_id: None }
        );
        assert_eq!(
            VideoParent::StudentSyllabusTechnique(9).columns(),
            ParentColumns { kind: "student_syllabus_technique", technique_id: None, student_id: None, thread_id: None, syllabus_technique_id: None, student_syllabus_technique_id: Some(9), camp_id: None }
        );
        assert_eq!(
            VideoParent::Camp(5).columns(),
            ParentColumns { kind: "camp", technique_id: None, student_id: None, thread_id: None, syllabus_technique_id: None, student_syllabus_technique_id: None, camp_id: Some(5) }
        );
        assert_eq!(
            VideoParent::Loose.columns(),
            ParentColumns { kind: "loose", technique_id: None, student_id: None, thread_id: None, syllabus_technique_id: None, student_syllabus_technique_id: None, camp_id: None }
        );
    }
}
