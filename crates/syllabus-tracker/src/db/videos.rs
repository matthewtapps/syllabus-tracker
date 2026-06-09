use std::collections::HashMap;

use chrono::Utc;
use sqlx::{Pool, Sqlite};
use tracing::{info, instrument};

use crate::error::AppError;
use crate::models::{DbVideo, ProcessingStatus, Video, VideoKind};

/// Next position for a technique-anchored video. M7 / CX-018: filters on
/// `(parent_kind='technique', parent_id)` so the same code path will work
/// once the back-compat `technique_id` column is dropped at M16. The legacy
/// column is still populated by INSERTs in this PR to keep older read paths
/// alive through the migration window.
#[instrument(skip(pool))]
pub async fn next_video_position(pool: &Pool<Sqlite>, technique_id: i64) -> Result<i64, AppError> {
    let row = sqlx::query!(
        "SELECT COALESCE(MAX(position), -1) AS max_position
         FROM videos
         WHERE parent_kind = 'technique' AND parent_id = ? AND deleted_at IS NULL",
        technique_id
    )
    .fetch_one(pool)
    .await?;
    Ok(row.max_position + 1)
}

#[instrument(skip(pool))]
pub async fn create_processing_video(
    pool: &Pool<Sqlite>,
    technique_id: i64,
    title: &str,
    description: Option<&str>,
    uploaded_by_id: i64,
) -> Result<i64, AppError> {
    info!("Creating processing video");
    let position = next_video_position(pool, technique_id).await?;
    let kind = VideoKind::Native.as_str();
    let status = ProcessingStatus::Processing.as_str();
    // Both `technique_id` and `(parent_kind='technique', parent_id)` are
    // populated until the M16 cleanup drops the legacy column.
    let res = sqlx::query!(
        "INSERT INTO videos (
            technique_id, parent_kind, parent_id,
            title, description, position, kind, processing_status,
            uploaded_by_id
         ) VALUES (?, 'technique', ?, ?, ?, ?, ?, ?, ?)",
        technique_id,
        technique_id,
        title,
        description,
        position,
        kind,
        status,
        uploaded_by_id,
    )
    .execute(pool)
    .await?;
    Ok(res.last_insert_rowid())
}

pub struct NewExternalVideo<'a> {
    pub technique_id: i64,
    pub title: &'a str,
    pub description: Option<&'a str>,
    pub uploaded_by_id: i64,
    pub kind: VideoKind,
    pub external_url: &'a str,
    pub external_host: Option<&'a str>,
    pub external_video_id: Option<&'a str>,
}

#[instrument(skip(pool, input), fields(technique_id = input.technique_id))]
pub async fn create_external_video(
    pool: &Pool<Sqlite>,
    input: NewExternalVideo<'_>,
) -> Result<i64, AppError> {
    info!("Creating external video");
    let position = next_video_position(pool, input.technique_id).await?;
    let kind_str = input.kind.as_str();
    let status = ProcessingStatus::Ready.as_str();
    let res = sqlx::query!(
        "INSERT INTO videos (
            technique_id, parent_kind, parent_id,
            title, description, position, kind, processing_status,
            external_url, external_host, external_video_id, uploaded_by_id
         ) VALUES (?, 'technique', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        input.technique_id,
        input.technique_id,
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
    .execute(pool)
    .await?;
    Ok(res.last_insert_rowid())
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
pub async fn mark_video_failed(
    pool: &Pool<Sqlite>,
    id: i64,
    error: &str,
) -> Result<(), AppError> {
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

#[instrument(skip(pool))]
pub async fn get_db_video(pool: &Pool<Sqlite>, id: i64) -> Result<Option<DbVideo>, AppError> {
    let row = sqlx::query_as!(
        DbVideo,
        "SELECT id, technique_id, title, description, position, kind,
                processing_status, processing_error, storage_key, bytes,
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
        "SELECT id, technique_id, title, description, position, kind,
                processing_status, processing_error, storage_key, bytes,
                duration_seconds, width, height,
                external_url, external_host, external_video_id, uploaded_by_id,
                created_at, updated_at, hidden_at
         FROM videos
         WHERE parent_kind = 'technique' AND parent_id = ?
           AND deleted_at IS NULL
         ORDER BY position ASC, id ASC",
        technique_id
    )
    .fetch_all(pool)
    .await?;
    Ok(rows.into_iter().map(Video::from).collect())
}

/// The context in which a student is viewing a video. Determines which
/// per-student override table (if any) layers on top of the global
/// `videos.hidden_at` flag.
///
/// - `Library`: only `videos.hidden_at` applies. Per-student overrides
///   are ignored, because the library is a shared browse surface; a
///   student should never see a different library from their peers
///   beyond what's globally hidden.
/// - `Syllabus`: `videos.hidden_at` + the syllabus-scoped per-student
///   overrides (the table currently named `video_student_visibility`).
///   The default for legacy callers — preserves the prior behaviour.
/// - `Camp(camp_id)`: `videos.hidden_at` + the camp-scoped overrides
///   (M8 work, table not yet created). Until M8 lands, this arm just
///   falls through to global-hide-only behaviour with a TODO.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum VisibilityContext {
    Library,
    Syllabus,
    Camp(i64),
}

impl VisibilityContext {
    /// Parse from the `ctx` query param. Recognised forms:
    /// `library`, `syllabus`, `camp:<id>`. Missing / unknown values
    /// default to `Syllabus` (the legacy behaviour).
    pub fn parse(raw: Option<&str>) -> Result<Self, &'static str> {
        match raw {
            None | Some("syllabus") => Ok(VisibilityContext::Syllabus),
            Some("library") => Ok(VisibilityContext::Library),
            Some(s) if s.starts_with("camp:") => {
                let id_str = &s["camp:".len()..];
                id_str
                    .parse::<i64>()
                    .map(VisibilityContext::Camp)
                    .map_err(|_| "invalid camp id in ctx")
            }
            Some(_) => Err("unknown ctx value"),
        }
    }
}

/// Lists videos for a technique, filtered to what `student_id` should
/// actually see in the given context. Soft-deleted videos always
/// excluded.
#[instrument(skip(pool))]
pub async fn list_videos_for_technique_visible_to(
    pool: &Pool<Sqlite>,
    technique_id: i64,
    student_id: i64,
    ctx: VisibilityContext,
) -> Result<Vec<Video>, AppError> {
    let rows = match ctx {
        VisibilityContext::Library | VisibilityContext::Camp(_) => {
            // Library: no per-student overrides apply, only global hide.
            // Camp: M8 will add `camp_video_visibility`; for now we fall
            // back to global-hide-only since no camp_id exists yet.
            sqlx::query_as!(
                DbVideo,
                "SELECT v.id, v.technique_id, v.title, v.description, v.position, v.kind,
                        v.processing_status, v.processing_error, v.storage_key, v.bytes,
                        v.duration_seconds, v.width, v.height,
                        v.external_url, v.external_host, v.external_video_id, v.uploaded_by_id,
                        v.created_at, v.updated_at, v.hidden_at
                 FROM videos v
                 WHERE v.parent_kind = 'technique' AND v.parent_id = ?
                   AND v.deleted_at IS NULL
                   AND v.hidden_at IS NULL
                 ORDER BY v.position ASC, v.id ASC",
                technique_id,
            )
            .fetch_all(pool)
            .await?
        }
        VisibilityContext::Syllabus => {
            sqlx::query_as!(
                DbVideo,
                "SELECT v.id, v.technique_id, v.title, v.description, v.position, v.kind,
                        v.processing_status, v.processing_error, v.storage_key, v.bytes,
                        v.duration_seconds, v.width, v.height,
                        v.external_url, v.external_host, v.external_video_id, v.uploaded_by_id,
                        v.created_at, v.updated_at, v.hidden_at
                 FROM videos v
                 LEFT JOIN video_student_visibility vsv
                        ON vsv.video_id = v.id AND vsv.student_id = ?
                 WHERE v.parent_kind = 'technique' AND v.parent_id = ?
                   AND v.deleted_at IS NULL
                   AND COALESCE(vsv.visible, v.hidden_at IS NULL) = 1
                 ORDER BY v.position ASC, v.id ASC",
                student_id,
                technique_id,
            )
            .fetch_all(pool)
            .await?
        }
    };
    Ok(rows.into_iter().map(Video::from).collect())
}

/// Returns the effective visibility for a single (video, student) pair
/// in the given context. Used by playback / download guards to refuse
/// access if the student shouldn't be able to see the video in that
/// context. Coaches bypass this check at the route level.
#[instrument(skip(pool))]
pub async fn video_visible_to_student(
    pool: &Pool<Sqlite>,
    video_id: i64,
    student_id: i64,
    ctx: VisibilityContext,
) -> Result<bool, AppError> {
    let row = match ctx {
        VisibilityContext::Library | VisibilityContext::Camp(_) => {
            // Library / Camp (until M8): only the global hide applies.
            sqlx::query!(
                "SELECT
                    CASE
                        WHEN v.deleted_at IS NOT NULL THEN 0
                        WHEN v.hidden_at IS NULL THEN 1
                        ELSE 0
                    END AS \"visible!: i64\"
                 FROM videos v
                 WHERE v.id = ?",
                video_id,
            )
            .fetch_optional(pool)
            .await?
            .map(|r| r.visible)
        }
        VisibilityContext::Syllabus => sqlx::query!(
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
        .await?
        .map(|r| r.visible),
    };
    Ok(row.map(|v| v != 0).unwrap_or(false))
}

/// Sets (or clears) the global hide flag on a video. `actor_id` is not
/// currently recorded on the video itself — the audit lives in app logs.
#[instrument(skip(pool))]
pub async fn set_video_hidden_globally(
    pool: &Pool<Sqlite>,
    video_id: i64,
    hidden: bool,
) -> Result<bool, AppError> {
    let now = Utc::now().naive_utc();
    let result = if hidden {
        sqlx::query!(
            "UPDATE videos SET hidden_at = ?, updated_at = ?
             WHERE id = ? AND deleted_at IS NULL AND hidden_at IS NULL",
            now,
            now,
            video_id,
        )
        .execute(pool)
        .await?
    } else {
        sqlx::query!(
            "UPDATE videos SET hidden_at = NULL, updated_at = ?
             WHERE id = ? AND deleted_at IS NULL AND hidden_at IS NOT NULL",
            now,
            video_id,
        )
        .execute(pool)
        .await?
    };
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
        sqlx::query!("UPDATE videos SET title = ?, updated_at = ? WHERE id = ?", title, now, id)
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
             WHERE id = ? AND parent_kind = 'technique' AND parent_id = ?
               AND deleted_at IS NULL",
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
    sqlx::query!("DELETE FROM video_watch_events WHERE video_id = ?", video_id)
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
