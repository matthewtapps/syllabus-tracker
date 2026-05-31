use std::sync::Arc;

use chrono::{DateTime, Utc};
use rocket::data::{ByteUnit, ToByteUnit};
use rocket::form::Form;
use rocket::fs::TempFile;
use rocket::http::Status;
use rocket::serde::{json::Json, Deserialize, Serialize};
use rocket::tokio;
use rocket::State;
use sqlx::{Pool, Sqlite};
use tracing::{instrument, warn};
use uuid::Uuid;

use crate::auth::{Permission, User};
use crate::db;
use crate::models::{ProcessingStatus, Video};
use crate::videos::embeds;
use crate::videos::metrics::{kv, video_metrics};
use crate::videos::pipeline::{
    self, max_video_bytes, signed_download_ttl, signed_playback_ttl, PipelineContext,
};
use crate::videos::storage::DynVideoStorage;

#[derive(Serialize)]
pub struct ListVideosResponse {
    pub videos: Vec<Video>,
}

#[derive(Serialize)]
pub struct UploadResponse {
    pub video_id: i64,
    pub processing_status: String,
}

#[derive(Serialize)]
pub struct StatusResponse {
    pub processing_status: String,
    pub processing_error: Option<String>,
}

#[derive(Serialize)]
pub struct SignedUrlResponse {
    pub url: String,
    pub expires_at: DateTime<Utc>,
}

#[derive(FromForm)]
pub struct UploadForm<'r> {
    pub file: TempFile<'r>,
    pub title: String,
    pub description: Option<String>,
}

#[derive(Deserialize)]
pub struct LinkVideoRequest {
    pub title: String,
    pub description: Option<String>,
    pub url: String,
}

#[derive(Deserialize)]
pub struct UpdateVideoRequest {
    pub title: Option<String>,
    pub description: Option<String>,
    pub position: Option<i64>,
}

#[derive(Deserialize)]
pub struct ReorderRequest {
    pub ordered_ids: Vec<i64>,
}

#[derive(FromForm)]
pub struct ReplaceForm<'r> {
    pub file: TempFile<'r>,
    pub reset_stats: Option<bool>,
}

pub fn upload_byte_limit() -> ByteUnit {
    (max_video_bytes() as u64).bytes() + 16.mebibytes()
}

#[instrument(skip(form, pool, ctx))]
#[post("/techniques/<tid>/videos/upload", data = "<form>")]
pub async fn api_video_upload(
    tid: i64,
    user: User,
    mut form: Form<UploadForm<'_>>,
    pool: &State<Pool<Sqlite>>,
    ctx: &State<Arc<PipelineContext>>,
) -> Result<Json<UploadResponse>, Status> {
    user.require_permission(Permission::UploadVideos)?;

    let metrics = video_metrics();
    if !is_mp4(form.file.content_type()) {
        metrics
            .uploads_total
            .add(1, &[kv("result", "fail_format")]);
        return Err(Status::UnsupportedMediaType);
    }

    if form.file.len() > max_video_bytes() as u64 {
        metrics
            .uploads_total
            .add(1, &[kv("result", "fail_size")]);
        return Err(Status::PayloadTooLarge);
    }

    tokio::fs::create_dir_all(pipeline::temp_dir())
        .await
        .map_err(|_| Status::InternalServerError)?;
    let mut dest = pipeline::temp_dir();
    dest.push(format!("{}.mp4", Uuid::new_v4()));

    form.file
        .persist_to(&dest)
        .await
        .map_err(|e| {
            warn!("failed to persist upload: {}", e);
            Status::InternalServerError
        })?;

    let video_id = db::create_processing_video(
        pool.inner(),
        tid,
        form.title.trim(),
        form.description.as_deref(),
        user.id,
    )
    .await
    .map_err(Status::from)?;

    let ctx_clone = ctx.inner().clone();
    let dest_clone = dest.clone();
    tokio::spawn(async move {
        pipeline::process_uploaded_video(ctx_clone, video_id, tid, dest_clone).await;
    });

    Ok(Json(UploadResponse {
        video_id,
        processing_status: ProcessingStatus::Processing.as_str().to_string(),
    }))
}

#[instrument(skip(pool))]
#[get("/videos/<vid>/status")]
pub async fn api_video_status(
    vid: i64,
    _user: User,
    pool: &State<Pool<Sqlite>>,
) -> Result<Json<StatusResponse>, Status> {
    let video = db::get_video(pool.inner(), vid)
        .await
        .map_err(Status::from)?
        .ok_or(Status::NotFound)?;
    Ok(Json(StatusResponse {
        processing_status: video.processing_status.as_str().to_string(),
        processing_error: video.processing_error,
    }))
}

#[instrument(skip(body, pool))]
#[post("/techniques/<tid>/videos/link", data = "<body>")]
pub async fn api_video_link(
    tid: i64,
    user: User,
    body: Json<LinkVideoRequest>,
    pool: &State<Pool<Sqlite>>,
) -> Result<Json<Video>, Status> {
    user.require_permission(Permission::UploadVideos)?;
    let req = body.into_inner();
    let trimmed_title = req.title.trim();
    if trimmed_title.is_empty() || req.url.trim().is_empty() {
        return Err(Status::UnprocessableEntity);
    }

    let parsed = embeds::parse(&req.url);
    let id = db::create_external_video(
        pool.inner(),
        db::NewExternalVideo {
            technique_id: tid,
            title: trimmed_title,
            description: req.description.as_deref(),
            uploaded_by_id: user.id,
            kind: parsed.kind,
            external_url: &parsed.canonical_url,
            external_host: Some(parsed.host.as_str()),
            external_video_id: parsed.video_id.as_deref(),
        },
    )
    .await
    .map_err(Status::from)?;

    let video = db::get_video(pool.inner(), id)
        .await
        .map_err(Status::from)?
        .ok_or(Status::InternalServerError)?;
    Ok(Json(video))
}

#[instrument(skip(pool))]
#[get("/techniques/<tid>/videos")]
pub async fn api_list_technique_videos(
    tid: i64,
    _user: User,
    pool: &State<Pool<Sqlite>>,
) -> Result<Json<ListVideosResponse>, Status> {
    let videos = db::list_videos_for_technique(pool.inner(), tid)
        .await
        .map_err(Status::from)?;
    Ok(Json(ListVideosResponse { videos }))
}

#[instrument(skip(body, pool))]
#[patch("/videos/<vid>", data = "<body>")]
pub async fn api_update_video(
    vid: i64,
    user: User,
    body: Json<UpdateVideoRequest>,
    pool: &State<Pool<Sqlite>>,
) -> Result<Status, Status> {
    user.require_permission(Permission::UploadVideos)?;
    let req = body.into_inner();
    let title = req.title.as_deref().map(str::trim);
    let description: Option<Option<String>> = req.description.map(|s| {
        let trimmed = s.trim().to_string();
        if trimmed.is_empty() { None } else { Some(trimmed) }
    });
    db::update_video_metadata(
        pool.inner(),
        vid,
        title,
        description.as_ref().map(|opt| opt.as_deref()),
        req.position,
    )
    .await
    .map_err(Status::from)?;
    Ok(Status::NoContent)
}

#[instrument(skip(body, pool))]
#[post("/techniques/<tid>/videos/reorder", data = "<body>")]
pub async fn api_reorder_videos(
    tid: i64,
    user: User,
    body: Json<ReorderRequest>,
    pool: &State<Pool<Sqlite>>,
) -> Result<Status, Status> {
    user.require_permission(Permission::UploadVideos)?;
    let req = body.into_inner();
    db::reorder_videos(pool.inner(), tid, &req.ordered_ids)
        .await
        .map_err(Status::from)?;
    Ok(Status::NoContent)
}

#[instrument(skip(form, pool, ctx))]
#[post("/videos/<vid>/replace", data = "<form>")]
pub async fn api_replace_video(
    vid: i64,
    user: User,
    mut form: Form<ReplaceForm<'_>>,
    pool: &State<Pool<Sqlite>>,
    ctx: &State<Arc<PipelineContext>>,
) -> Result<Json<UploadResponse>, Status> {
    user.require_permission(Permission::UploadVideos)?;
    if !is_mp4(form.file.content_type()) {
        return Err(Status::UnsupportedMediaType);
    }
    if form.file.len() > max_video_bytes() as u64 {
        return Err(Status::PayloadTooLarge);
    }

    let video = db::get_db_video(pool.inner(), vid)
        .await
        .map_err(Status::from)?
        .ok_or(Status::NotFound)?;
    let technique_id = video.technique_id.ok_or(Status::InternalServerError)?;
    let existing_storage_key = video.storage_key.clone();

    tokio::fs::create_dir_all(pipeline::temp_dir())
        .await
        .map_err(|_| Status::InternalServerError)?;
    let mut dest = pipeline::temp_dir();
    dest.push(format!("{}.mp4", Uuid::new_v4()));
    form.file
        .persist_to(&dest)
        .await
        .map_err(|_| Status::InternalServerError)?;

    db::reset_video_to_processing(pool.inner(), vid)
        .await
        .map_err(Status::from)?;

    if form.reset_stats.unwrap_or(false) {
        db::clear_video_watch_state(pool.inner(), vid)
            .await
            .map_err(Status::from)?;
    }

    let ctx_clone = ctx.inner().clone();
    let dest_clone = dest.clone();
    tokio::spawn(async move {
        pipeline::process_uploaded_video(ctx_clone, vid, technique_id, dest_clone).await;
    });

    if let Some(key) = existing_storage_key {
        let storage = ctx.inner().storage.clone();
        tokio::spawn(async move {
            if let Err(e) = storage.delete(&key).await {
                warn!("failed to delete previous storage object {}: {}", key, e);
            }
        });
    }

    Ok(Json(UploadResponse {
        video_id: vid,
        processing_status: ProcessingStatus::Processing.as_str().to_string(),
    }))
}

#[instrument(skip(pool, storage))]
#[delete("/videos/<vid>")]
pub async fn api_delete_video(
    vid: i64,
    user: User,
    pool: &State<Pool<Sqlite>>,
    storage: &State<DynVideoStorage>,
) -> Result<Status, Status> {
    user.require_permission(Permission::DeleteVideos)?;
    let storage_key = db::delete_video(pool.inner(), vid)
        .await
        .map_err(Status::from)?;
    if let Some(key) = storage_key {
        let storage = storage.inner().clone();
        tokio::spawn(async move {
            if let Err(e) = storage.delete(&key).await {
                warn!("failed to delete storage object {}: {}", key, e);
            }
        });
    }
    Ok(Status::NoContent)
}

#[instrument(skip(pool, storage))]
#[get("/videos/<vid>/playback-url")]
pub async fn api_video_playback_url(
    vid: i64,
    _user: User,
    pool: &State<Pool<Sqlite>>,
    storage: &State<DynVideoStorage>,
) -> Result<Json<SignedUrlResponse>, Status> {
    let db_video = db::get_db_video(pool.inner(), vid)
        .await
        .map_err(Status::from)?
        .ok_or(Status::NotFound)?;
    let status =
        ProcessingStatus::from_db_str(db_video.processing_status.as_deref().unwrap_or("processing"));
    if status != ProcessingStatus::Ready {
        return Err(Status::Conflict);
    }
    let key = db_video.storage_key.ok_or(Status::Conflict)?;
    let ttl = signed_playback_ttl();
    let started = std::time::Instant::now();
    let url = storage
        .presign_get(&key, ttl)
        .await
        .map_err(|_| Status::InternalServerError)?;
    video_metrics()
        .signed_url_mint_duration_ms
        .record(started.elapsed().as_millis() as u64, &[]);
    let expires_at = Utc::now() + chrono::Duration::from_std(ttl).unwrap_or_default();
    Ok(Json(SignedUrlResponse { url, expires_at }))
}

#[instrument(skip(pool, storage))]
#[get("/videos/<vid>/download-url")]
pub async fn api_video_download_url(
    vid: i64,
    _user: User,
    pool: &State<Pool<Sqlite>>,
    storage: &State<DynVideoStorage>,
) -> Result<Json<SignedUrlResponse>, Status> {
    let db_video = db::get_db_video(pool.inner(), vid)
        .await
        .map_err(Status::from)?
        .ok_or(Status::NotFound)?;
    let status =
        ProcessingStatus::from_db_str(db_video.processing_status.as_deref().unwrap_or("processing"));
    if status != ProcessingStatus::Ready {
        return Err(Status::Conflict);
    }
    let key = db_video.storage_key.ok_or(Status::Conflict)?;
    let title = db_video.title.unwrap_or_else(|| format!("video-{}", vid));
    let filename = sanitised_download_name(&title);
    let ttl = signed_download_ttl();
    let started = std::time::Instant::now();
    let url = storage
        .presign_attachment_get(&key, ttl, &filename)
        .await
        .map_err(|_| Status::InternalServerError)?;
    video_metrics()
        .signed_url_mint_duration_ms
        .record(started.elapsed().as_millis() as u64, &[]);
    let expires_at = Utc::now() + chrono::Duration::from_std(ttl).unwrap_or_default();
    Ok(Json(SignedUrlResponse { url, expires_at }))
}

#[derive(Deserialize)]
pub struct WatchEventBatch {
    pub play_id: String,
    pub events: Vec<WatchEventItem>,
}

#[derive(Deserialize)]
pub struct WatchEventItem {
    pub event: String,
    pub seconds_watched: Option<i64>,
}

const ALLOWED_WATCH_EVENTS: &[&str] = &[
    "started",
    "progress_25",
    "progress_50",
    "progress_75",
    "completed",
    "opened",
];

#[instrument(skip(body, pool))]
#[post("/videos/<vid>/watch-events", data = "<body>")]
pub async fn api_video_watch_events(
    vid: i64,
    user: User,
    body: Json<WatchEventBatch>,
    pool: &State<Pool<Sqlite>>,
) -> Result<Status, Status> {
    let req = body.into_inner();
    let play_id = req.play_id.trim();
    if play_id.is_empty() || play_id.len() > 64 {
        return Err(Status::UnprocessableEntity);
    }
    if req.events.is_empty() || req.events.len() > 32 {
        return Err(Status::UnprocessableEntity);
    }
    let mut inputs = Vec::with_capacity(req.events.len());
    for event in req.events {
        if !ALLOWED_WATCH_EVENTS.contains(&event.event.as_str()) {
            return Err(Status::UnprocessableEntity);
        }
        let seconds = event.seconds_watched.map(|s| s.max(0));
        inputs.push(db::WatchEventInput {
            event: event.event,
            seconds_watched: seconds,
        });
    }
    db::ingest_watch_events(pool.inner(), vid, user.id, play_id, &inputs)
        .await
        .map_err(Status::from)?;
    let metrics = video_metrics();
    for input in &inputs {
        metrics
            .watch_events_total
            .add(1, &[kv("event", input.event.clone())]);
        if input.event == "started" {
            metrics.watch_plays_total.add(1, &[]);
        }
    }
    Ok(Status::NoContent)
}

#[instrument(skip(pool))]
#[post("/videos/privacy-ack")]
pub async fn api_video_privacy_ack(
    user: User,
    pool: &State<Pool<Sqlite>>,
) -> Result<Status, Status> {
    db::record_privacy_ack(pool.inner(), user.id)
        .await
        .map_err(Status::from)?;
    Ok(Status::NoContent)
}

#[derive(Serialize)]
pub struct PrivacyAckStatus {
    pub acked: bool,
}

#[get("/videos/privacy-ack")]
pub async fn api_video_privacy_ack_status(
    user: User,
    pool: &State<Pool<Sqlite>>,
) -> Result<Json<PrivacyAckStatus>, Status> {
    let acked = db::has_privacy_ack(pool.inner(), user.id)
        .await
        .map_err(Status::from)?;
    Ok(Json(PrivacyAckStatus { acked }))
}

#[instrument(skip(pool))]
#[get("/videos/<vid>/stats")]
pub async fn api_video_stats(
    vid: i64,
    user: User,
    pool: &State<Pool<Sqlite>>,
) -> Result<Json<db::VideoStatsSnapshot>, Status> {
    user.require_permission(Permission::ViewWatchStats)?;
    let stats = db::get_video_stats(pool.inner(), vid)
        .await
        .map_err(Status::from)?;
    Ok(Json(stats))
}

#[derive(Serialize)]
pub struct StudentWatchActivityResponse {
    pub activity: Vec<db::StudentWatchActivityRow>,
}

#[instrument(skip(pool))]
#[get("/students/<sid>/watch-activity")]
pub async fn api_student_watch_activity(
    sid: i64,
    user: User,
    pool: &State<Pool<Sqlite>>,
) -> Result<Json<StudentWatchActivityResponse>, Status> {
    user.require_permission(Permission::ViewWatchStats)?;
    let since = Utc::now() - chrono::Duration::days(30);
    let activity = db::get_student_watch_activity(pool.inner(), sid, since)
        .await
        .map_err(Status::from)?;
    Ok(Json(StudentWatchActivityResponse { activity }))
}

#[derive(Serialize)]
pub struct WatchStateResponse {
    pub videos: std::collections::HashMap<i64, db::WatchAggregateRow>,
}

#[instrument(skip(pool))]
#[get("/me/watch-state?<video_ids>")]
pub async fn api_my_watch_state(
    video_ids: Vec<i64>,
    user: User,
    pool: &State<Pool<Sqlite>>,
) -> Result<Json<WatchStateResponse>, Status> {
    let videos = db::get_my_watch_state(pool.inner(), user.id, &video_ids)
        .await
        .map_err(Status::from)?;
    Ok(Json(WatchStateResponse { videos }))
}

#[instrument(skip(pool))]
#[get("/dashboard/video-overview")]
pub async fn api_dashboard_video_overview(
    user: User,
    pool: &State<Pool<Sqlite>>,
) -> Result<Json<db::DashboardVideoOverview>, Status> {
    user.require_permission(Permission::ViewWatchStats)?;
    let since = Utc::now() - chrono::Duration::days(7);
    let overview = db::get_dashboard_video_overview(pool.inner(), since)
        .await
        .map_err(Status::from)?;
    Ok(Json(overview))
}

#[instrument(skip(pool))]
#[get("/admin/storage")]
pub async fn api_admin_storage(
    user: User,
    pool: &State<Pool<Sqlite>>,
) -> Result<Json<db::StorageOverview>, Status> {
    user.require_permission(Permission::ViewStorageStats)?;
    let overview = db::get_storage_overview(pool.inner(), 10)
        .await
        .map_err(Status::from)?;
    Ok(Json(overview))
}

fn is_mp4(content_type: Option<&rocket::http::ContentType>) -> bool {
    match content_type {
        Some(ct) => {
            let mt = ct.media_type();
            mt.top() == "video" && mt.sub() == "mp4"
        }
        None => false,
    }
}

fn sanitised_download_name(title: &str) -> String {
    let cleaned: String = title
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.' || c == ' ' {
                c
            } else {
                '_'
            }
        })
        .collect();
    let trimmed = cleaned.trim();
    let base = if trimmed.is_empty() { "video" } else { trimmed };
    if base.ends_with(".mp4") {
        base.to_string()
    } else {
        format!("{}.mp4", base)
    }
}

