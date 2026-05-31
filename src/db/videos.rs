use chrono::Utc;
use sqlx::{Pool, Sqlite};
use tracing::{info, instrument};

use crate::error::AppError;
use crate::models::{DbVideo, ProcessingStatus, Video, VideoKind};

#[instrument(skip(pool))]
pub async fn next_video_position(pool: &Pool<Sqlite>, technique_id: i64) -> Result<i64, AppError> {
    let row = sqlx::query!(
        "SELECT COALESCE(MAX(position), -1) AS max_position
         FROM videos
         WHERE technique_id = ?",
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
    let res = sqlx::query!(
        "INSERT INTO videos (
            technique_id, title, description, position, kind, processing_status,
            uploaded_by_id
         ) VALUES (?, ?, ?, ?, ?, ?, ?)",
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
            technique_id, title, description, position, kind, processing_status,
            external_url, external_host, external_video_id, uploaded_by_id
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
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
                created_at, updated_at
         FROM videos
         WHERE id = ?",
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
                created_at, updated_at
         FROM videos
         WHERE technique_id = ?
         ORDER BY position ASC, id ASC",
        technique_id
    )
    .fetch_all(pool)
    .await?;
    Ok(rows.into_iter().map(Video::from).collect())
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
             WHERE id = ? AND technique_id = ?",
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

#[instrument(skip(pool))]
pub async fn delete_video(pool: &Pool<Sqlite>, id: i64) -> Result<Option<String>, AppError> {
    let row = sqlx::query!("SELECT storage_key FROM videos WHERE id = ?", id)
        .fetch_optional(pool)
        .await?;
    let storage_key = row.and_then(|r| r.storage_key);
    sqlx::query!("DELETE FROM videos WHERE id = ?", id)
        .execute(pool)
        .await?;
    Ok(storage_key)
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
