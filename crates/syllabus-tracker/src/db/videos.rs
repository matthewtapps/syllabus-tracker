use std::collections::HashMap;

use chrono::Utc;
use sqlx::{Pool, Sqlite};
use tracing::{info, instrument};

use crate::db::activity::{
    NewActivity, Verb, affected_students_for_technique, emit, emit_fanout, payload,
};
use crate::error::AppError;
use crate::models::{DbVideo, ProcessingStatus, Video, VideoKind};

/// The kinds of thing a video can hang off. Typed-column polymorphism,
/// mirrors `threads::AnchorKind`. Camp and match parents are added when
/// those tables exist.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum VideoParent {
    Technique(i64),
    StudentProfile(i64),
    /// A video reply living under a thread. Per CX-010 a thread can NOT be
    /// started on a video whose parent is a thread (no endless reply chains);
    /// that guard lives in `db::threads::validate_anchor` (a later task).
    Thread(i64),
    Loose,
}

/// The four typed columns a `VideoParent` resolves to in the `videos` table.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ParentColumns {
    pub kind: &'static str,
    pub technique_id: Option<i64>,
    pub student_id: Option<i64>,
    pub thread_id: Option<i64>,
}

impl VideoParent {
    pub fn columns(self) -> ParentColumns {
        match self {
            VideoParent::Technique(id) => ParentColumns {
                kind: "technique", technique_id: Some(id), student_id: None, thread_id: None,
            },
            VideoParent::StudentProfile(id) => ParentColumns {
                kind: "student_profile", technique_id: None, student_id: Some(id), thread_id: None,
            },
            VideoParent::Thread(id) => ParentColumns {
                kind: "thread", technique_id: None, student_id: None, thread_id: Some(id),
            },
            VideoParent::Loose => ParentColumns {
                kind: "loose", technique_id: None, student_id: None, thread_id: None,
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
           AND (thread_id    IS ? OR (thread_id    IS NULL AND ? IS NULL))",
        c.kind,
        c.technique_id,
        c.technique_id,
        c.student_id,
        c.student_id,
        c.thread_id,
        c.thread_id,
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
            title, description, position, kind, processing_status, uploaded_by_id
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        c.kind,
        c.technique_id,
        c.student_id,
        c.thread_id,
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
        let affected = affected_students_for_technique(&mut tx, technique_id).await?;
        emit_fanout(
            &mut tx,
            NewActivity::new(Verb::VideoAdded, uploaded_by_id)
                .video(video_id)
                .technique(technique_id),
            &affected,
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
            title, description, position, kind, processing_status,
            external_url, external_host, external_video_id, uploaded_by_id
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        c.kind,
        c.technique_id,
        c.student_id,
        c.thread_id,
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
        let affected = affected_students_for_technique(&mut tx, technique_id).await?;
        emit_fanout(
            &mut tx,
            NewActivity::new(Verb::VideoAdded, uploaded_by_id)
                .video(video_id)
                .technique(technique_id),
            &affected,
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
        "SELECT id, parent_kind, technique_id, student_id, thread_id, title, description,
                position, kind, processing_status, processing_error, storage_key, bytes,
                duration_seconds, width, height,
                external_url, external_host, external_video_id, uploaded_by_id,
                created_at, updated_at, hidden_at
         FROM videos
         WHERE id = ? AND deleted_at IS NULL",
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
        "SELECT id, parent_kind, technique_id, student_id, thread_id, title, description,
                position, kind, processing_status, processing_error, storage_key, bytes,
                duration_seconds, width, height,
                external_url, external_host, external_video_id, uploaded_by_id,
                created_at, updated_at, hidden_at
         FROM videos
         WHERE technique_id = ? AND deleted_at IS NULL
         ORDER BY position ASC, id ASC",
        technique_id
    )
    .fetch_all(pool)
    .await?;
    Ok(rows.into_iter().map(Video::from).collect())
}

/// Lists videos for a technique in a specific (student, syllabus) context,
/// filtered to what the student should actually see: globally-visible by
/// default, then per-(student, syllabus, video) overrides from
/// `student_syllabus_video_visibility` layered on top. Does NOT join the
/// legacy `video_student_visibility` table -- syllabus context uses the
/// new override table only. Library context (PR 1) uses
/// list_videos_for_technique_global_visible and never applies overrides.
#[instrument(skip(pool))]
pub async fn list_videos_for_technique_in_syllabus_visible_to(
    pool: &Pool<Sqlite>,
    technique_id: i64,
    syllabus_id: i64,
    student_id: i64,
) -> Result<Vec<Video>, AppError> {
    let rows = sqlx::query_as!(
        DbVideo,
        "SELECT v.id, v.parent_kind, v.technique_id, v.student_id, v.thread_id,
                v.title, v.description, v.position, v.kind,
                v.processing_status, v.processing_error, v.storage_key, v.bytes,
                v.duration_seconds, v.width, v.height,
                v.external_url, v.external_host, v.external_video_id, v.uploaded_by_id,
                v.created_at, v.updated_at, v.hidden_at
         FROM videos v
         LEFT JOIN student_syllabus_video_visibility ssvv
                ON ssvv.video_id = v.id
               AND ssvv.student_id = ?
               AND ssvv.syllabus_id = ?
         WHERE v.technique_id = ?
           AND v.deleted_at IS NULL
           AND COALESCE(ssvv.visible, v.hidden_at IS NULL) = 1
         ORDER BY v.position ASC, v.id ASC",
        student_id,
        syllabus_id,
        technique_id,
    )
    .fetch_all(pool)
    .await?;
    Ok(rows.into_iter().map(Video::from).collect())
}

/// Lists the globally-visible (not soft-deleted, not globally-hidden) videos
/// for a technique. Used by the library video read for student viewers. The
/// legacy per-student `video_student_visibility` table is intentionally NOT
/// joined: library context is "see the technique in the abstract", and
/// per-student overrides only apply inside a syllabus assignment.
#[instrument(skip(pool))]
pub async fn list_videos_for_technique_global_visible(
    pool: &Pool<Sqlite>,
    technique_id: i64,
) -> Result<Vec<Video>, AppError> {
    let rows = sqlx::query_as!(
        DbVideo,
        "SELECT id, parent_kind, technique_id, student_id, thread_id, title, description,
                position, kind, processing_status, processing_error, storage_key, bytes,
                duration_seconds, width, height,
                external_url, external_host, external_video_id, uploaded_by_id,
                created_at, updated_at, hidden_at
         FROM videos
         WHERE technique_id = ?
           AND deleted_at IS NULL
           AND hidden_at IS NULL
         ORDER BY position ASC, id ASC",
        technique_id,
    )
    .fetch_all(pool)
    .await?;
    Ok(rows.into_iter().map(Video::from).collect())
}

/// Lists the globally-visible (not soft-deleted, not globally-hidden) videos
/// hanging off a given parent. Used by profile/thread/loose surfaces, which
/// per CX-019 apply only the global hide (no per-student override layers).
// Consumed by the profile/thread/loose video surfaces in later PRs; kept here
// so this slab delivers the read primitive alongside the write path.
#[allow(dead_code)]
#[instrument(skip(pool))]
pub async fn list_videos_for_parent_global_visible(
    pool: &Pool<Sqlite>,
    parent: VideoParent,
) -> Result<Vec<Video>, AppError> {
    let c = parent.columns();
    let rows = sqlx::query_as!(
        DbVideo,
        "SELECT id, parent_kind, technique_id, student_id, thread_id, title, description,
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
         ORDER BY position ASC, id ASC",
        c.kind,
        c.technique_id,
        c.technique_id,
        c.student_id,
        c.student_id,
        c.thread_id,
        c.thread_id,
    )
    .fetch_all(pool)
    .await?;
    Ok(rows.into_iter().map(Video::from).collect())
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
        "SELECT v.id, v.parent_kind, v.technique_id, v.student_id, v.thread_id,
                v.title, v.description, v.position, v.kind,
                v.processing_status, v.processing_error, v.storage_key, v.bytes,
                v.duration_seconds, v.width, v.height,
                v.external_url, v.external_host, v.external_video_id, v.uploaded_by_id,
                v.created_at, v.updated_at, v.hidden_at
         FROM videos v
         LEFT JOIN video_student_visibility vsv
                ON vsv.video_id = v.id AND vsv.student_id = ?
         WHERE v.technique_id = ?
           AND v.deleted_at IS NULL
           AND COALESCE(vsv.visible, v.hidden_at IS NULL) = 1
         ORDER BY v.position ASC, v.id ASC",
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
                WHEN vsv.visible IS NOT NULL THEN vsv.visible
                WHEN v.hidden_at IS NULL THEN 1
                ELSE 0
            END AS \"visible!: i64\"
         FROM videos v
         LEFT JOIN video_student_visibility vsv
                ON vsv.video_id = v.id AND vsv.student_id = ?
         WHERE v.id = ?",
        student_id,
        video_id,
    )
    .fetch_optional(pool)
    .await?;
    Ok(row.map(|r| r.visible != 0).unwrap_or(false))
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
        let affected = affected_students_for_technique(&mut tx, technique_id).await?;
        emit_fanout(
            &mut tx,
            NewActivity::new(Verb::VideoVisibilitySet, actor_id)
                .video(video_id)
                .technique(technique_id)
                .payload(payload::video_visibility_set("global", !hidden)),
            &affected,
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
    let now = Utc::now().naive_utc();
    match visible {
        Some(b) => {
            sqlx::query!(
                "INSERT INTO video_student_visibility
                    (video_id, student_id, visible, set_by_id, set_at)
                 VALUES (?, ?, ?, ?, ?)
                 ON CONFLICT (video_id, student_id) DO UPDATE
                    SET visible = excluded.visible,
                        set_by_id = excluded.set_by_id,
                        set_at = excluded.set_at",
                video_id,
                student_id,
                b,
                actor_id,
                now,
            )
            .execute(pool)
            .await?;
        }
        None => {
            sqlx::query!(
                "DELETE FROM video_student_visibility
                 WHERE video_id = ? AND student_id = ?",
                video_id,
                student_id,
            )
            .execute(pool)
            .await?;
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
        "SELECT video_id, visible FROM video_student_visibility
         WHERE student_id = ? AND video_id IN ({placeholders})"
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
             WHERE id = ? AND technique_id = ? AND deleted_at IS NULL",
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
    let now = chrono::Utc::now().naive_utc();
    let mut tx = pool.begin().await?;
    match visible {
        Some(b) => {
            sqlx::query!(
                "INSERT INTO student_syllabus_video_visibility
                    (student_id, syllabus_id, video_id, visible, updated_by_id, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?)
                 ON CONFLICT (student_id, syllabus_id, video_id) DO UPDATE
                    SET visible = excluded.visible,
                        updated_by_id = excluded.updated_by_id,
                        updated_at = excluded.updated_at",
                student_id,
                syllabus_id,
                video_id,
                b,
                by_user_id,
                now,
            )
            .execute(&mut *tx)
            .await?;
        }
        None => {
            sqlx::query!(
                "DELETE FROM student_syllabus_video_visibility
                 WHERE student_id = ? AND syllabus_id = ? AND video_id = ?",
                student_id,
                syllabus_id,
                video_id,
            )
            .execute(&mut *tx)
            .await?;
        }
    }
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
    // Build an IN-list via query_builder so we keep the dynamic-length
    // shape that SQLx's compile-time macro doesn't handle.
    let mut qb = sqlx::QueryBuilder::<sqlx::Sqlite>::new(
        "SELECT video_id, visible FROM student_syllabus_video_visibility \
         WHERE student_id = ",
    );
    qb.push_bind(student_id);
    qb.push(" AND syllabus_id = ");
    qb.push_bind(syllabus_id);
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

#[cfg(test)]
mod parent_tests {
    use super::*;

    #[test]
    fn parent_columns_map_each_kind_to_exactly_one_id() {
        assert_eq!(
            VideoParent::Technique(7).columns(),
            ParentColumns { kind: "technique", technique_id: Some(7), student_id: None, thread_id: None }
        );
        assert_eq!(
            VideoParent::StudentProfile(3).columns(),
            ParentColumns { kind: "student_profile", technique_id: None, student_id: Some(3), thread_id: None }
        );
        assert_eq!(
            VideoParent::Thread(11).columns(),
            ParentColumns { kind: "thread", technique_id: None, student_id: None, thread_id: Some(11) }
        );
        assert_eq!(
            VideoParent::Loose.columns(),
            ParentColumns { kind: "loose", technique_id: None, student_id: None, thread_id: None }
        );
    }
}
