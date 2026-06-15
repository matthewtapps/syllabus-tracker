use chrono::{DateTime, Utc};
use rocket::State;
use rocket::data::{ByteUnit, Data, ToByteUnit};
use rocket::form::{Errors as FormErrors, Form};
use rocket::fs::TempFile;
use rocket::http::Status;
use rocket::serde::{Deserialize, Serialize, json::Json};
use rocket::tokio;
use sqlx::{Pool, Sqlite};
use tracing::{error, info, instrument, warn};
use uuid::Uuid;

use crate::auth::{Permission, User};
use crate::db;
use crate::models::{ProcessingStatus, Video};
use crate::videos::embeds;
use crate::videos::metrics::{kv, video_metrics};
use crate::videos::pipeline::{self, apply_processing_result, max_video_bytes, signed_download_ttl, signed_playback_ttl};
use crate::videos::processor::{DynVideoProcessor, HostJob};
use crate::videos::storage::DynVideoStorage;

/// Newtype wrapping the optional callback secret managed in Rocket state.
pub struct CallbackSecret(pub Option<String>);

#[derive(Serialize)]
pub struct ListVideosResponse {
    pub videos: Vec<VideoListItem>,
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

#[instrument(skip(form, pool, processor))]
#[post("/techniques/<tid>/videos/upload", data = "<form>")]
pub async fn api_video_upload(
    tid: i64,
    user: User,
    form: Result<Form<UploadForm<'_>>, FormErrors<'_>>,
    pool: &State<Pool<Sqlite>>,
    processor: &State<DynVideoProcessor>,
) -> Result<Json<UploadResponse>, Status> {
    user.require_permission(Permission::UploadVideos)?;

    let mut form = form.map_err(|errs| {
        error!(
            technique_id = tid,
            errors = %errs,
            "video upload form failed to parse"
        );
        Status::BadRequest
    })?;

    let metrics = video_metrics();
    if !is_mp4(form.file.content_type()) {
        metrics.uploads_total.add(1, &[kv("result", "fail_format")]);
        return Err(Status::UnsupportedMediaType);
    }

    if form.file.len() > max_video_bytes() as u64 {
        metrics.uploads_total.add(1, &[kv("result", "fail_size")]);
        return Err(Status::PayloadTooLarge);
    }

    tokio::fs::create_dir_all(pipeline::temp_dir())
        .await
        .map_err(|e| {
            error!(
                technique_id = tid,
                temp_dir = ?pipeline::temp_dir(),
                error = %e,
                "failed to create video temp dir"
            );
            Status::InternalServerError
        })?;
    let mut dest = pipeline::temp_dir();
    dest.push(format!("{}.mp4", Uuid::new_v4()));

    form.file.persist_to(&dest).await.map_err(|e| {
        error!(
            technique_id = tid,
            dest = ?dest,
            error = %e,
            "failed to persist uploaded video to disk"
        );
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

    processor
        .start(HostJob {
            video_id,
            technique_id: tid,
            original_temp_path: dest,
        })
        .await;

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
        .ok_or_else(|| {
            error!(
                video_id = id,
                technique_id = tid,
                "linked video row vanished immediately after insert"
            );
            Status::InternalServerError
        })?;
    Ok(Json(video))
}

#[derive(Serialize)]
pub struct VideoListItem {
    #[serde(flatten)]
    pub video: Video,
    /// "show" or "hide" when an explicit per-student override exists for
    /// `for_student`. Absent (omitted from JSON) when no override is set,
    /// or when the request didn't specify a `for_student` viewer.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub override_for_student: Option<String>,
}

/// Fills each video's `comment_count` with the number of threads on it the
/// viewer can see. Shared by the library/technique and per-syllabus video
/// list routes so the summary row shows the count on every surface.
pub(crate) async fn annotate_comment_counts(
    pool: &Pool<Sqlite>,
    videos: &mut [Video],
    is_coach: bool,
    viewer_id: i64,
) -> Result<(), crate::error::AppError> {
    if videos.is_empty() {
        return Ok(());
    }
    let video_ids: Vec<i64> = videos.iter().map(|v| v.id).collect();
    let counts = db::count_video_comments_visible(
        pool,
        &video_ids,
        db::Viewer {
            user_id: viewer_id,
            is_coach,
        },
    )
    .await?;
    for v in videos.iter_mut() {
        v.comment_count = counts.get(&v.id).copied().unwrap_or(0);
    }
    Ok(())
}

#[instrument(skip(pool))]
#[get("/techniques/<tid>/videos?<for_student>")]
pub async fn api_list_technique_videos(
    tid: i64,
    for_student: Option<i64>,
    user: User,
    pool: &State<Pool<Sqlite>>,
) -> Result<Json<ListVideosResponse>, Status> {
    let is_coach = user.has_permission(crate::auth::Permission::ViewAllStudents);
    let mut videos = if !is_coach {
        // Library context: students see the globally-visible list only.
        // Per-student video_student_visibility overrides are NOT applied
        // here; they are a legacy concept (now replaced in PR 3+ by the
        // per-(student, syllabus) override table for syllabus context).
        // The `for_student` query param is intentionally ignored for
        // student callers regardless of value.
        db::list_videos_for_technique_global_visible(pool.inner(), tid)
            .await
            .map_err(Status::from)?
    } else {
        db::list_videos_for_technique(pool.inner(), tid)
            .await
            .map_err(Status::from)?
    };
    annotate_comment_counts(pool.inner(), &mut videos, is_coach, user.id)
        .await
        .map_err(Status::from)?;

    let items: Vec<VideoListItem> = if is_coach && for_student.is_some() {
        let student_id = for_student.unwrap();
        let video_ids: Vec<i64> = videos.iter().map(|v| v.id).collect();
        let overrides = db::list_video_student_overrides(pool.inner(), &video_ids, student_id)
            .await
            .map_err(Status::from)?;
        videos
            .into_iter()
            .map(|v| {
                let override_for_student = overrides.get(&v.id).map(|b| {
                    if *b {
                        "show".to_string()
                    } else {
                        "hide".to_string()
                    }
                });
                VideoListItem {
                    video: v,
                    override_for_student,
                }
            })
            .collect()
    } else {
        videos
            .into_iter()
            .map(|video| VideoListItem {
                video,
                override_for_student: None,
            })
            .collect()
    };

    Ok(Json(ListVideosResponse { videos: items }))
}

#[derive(Deserialize)]
pub struct SetGlobalHiddenRequest {
    pub hidden: bool,
}

#[instrument(skip(pool, body))]
#[put("/videos/<vid>/global-hidden", data = "<body>")]
pub async fn api_set_video_global_hidden(
    vid: i64,
    body: Json<SetGlobalHiddenRequest>,
    user: User,
    pool: &State<Pool<Sqlite>>,
) -> Result<Status, Status> {
    user.require_permission(crate::auth::Permission::ManageVideoVisibility)?;
    db::set_video_hidden_globally(pool.inner(), vid, body.hidden, user.id)
        .await
        .map_err(Status::from)?;
    Ok(Status::NoContent)
}

#[derive(Deserialize)]
pub struct SetStudentVisibilityRequest {
    /// `Some(true)` = always show, `Some(false)` = always hide, `None` =
    /// clear the override (follow the global default).
    pub visible: Option<bool>,
}

#[instrument(skip(pool, body))]
#[put("/videos/<vid>/visibility/<student_id>", data = "<body>")]
pub async fn api_set_video_student_visibility(
    vid: i64,
    student_id: i64,
    body: Json<SetStudentVisibilityRequest>,
    user: User,
    pool: &State<Pool<Sqlite>>,
) -> Result<Status, Status> {
    user.require_permission(crate::auth::Permission::ManageVideoVisibility)?;
    db::set_video_student_visibility(pool.inner(), vid, student_id, body.visible, user.id)
        .await
        .map_err(Status::from)?;
    Ok(Status::NoContent)
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
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed)
        }
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

#[instrument(skip(form, pool, processor, storage))]
#[post("/videos/<vid>/replace", data = "<form>")]
pub async fn api_replace_video(
    vid: i64,
    user: User,
    form: Result<Form<ReplaceForm<'_>>, FormErrors<'_>>,
    pool: &State<Pool<Sqlite>>,
    processor: &State<DynVideoProcessor>,
    storage: &State<DynVideoStorage>,
) -> Result<Json<UploadResponse>, Status> {
    user.require_permission(Permission::UploadVideos)?;

    let mut form = form.map_err(|errs| {
        error!(
            video_id = vid,
            errors = %errs,
            "video replace form failed to parse"
        );
        Status::BadRequest
    })?;

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
    let technique_id = video.technique_id.ok_or_else(|| {
        error!(
            video_id = vid,
            "video being replaced has no technique_id; refusing to process"
        );
        Status::InternalServerError
    })?;
    let existing_storage_key = video.storage_key.clone();

    tokio::fs::create_dir_all(pipeline::temp_dir())
        .await
        .map_err(|e| {
            error!(
                video_id = vid,
                temp_dir = ?pipeline::temp_dir(),
                error = %e,
                "failed to create video temp dir for replace"
            );
            Status::InternalServerError
        })?;
    let mut dest = pipeline::temp_dir();
    dest.push(format!("{}.mp4", Uuid::new_v4()));
    form.file.persist_to(&dest).await.map_err(|e| {
        error!(
            video_id = vid,
            dest = ?dest,
            error = %e,
            "failed to persist replacement video to disk"
        );
        Status::InternalServerError
    })?;

    db::reset_video_to_processing(pool.inner(), vid)
        .await
        .map_err(Status::from)?;

    if form.reset_stats.unwrap_or(false) {
        db::clear_video_watch_state(pool.inner(), vid)
            .await
            .map_err(Status::from)?;
    }

    processor
        .start(HostJob {
            video_id: vid,
            technique_id,
            original_temp_path: dest,
        })
        .await;

    if let Some(key) = existing_storage_key {
        let storage = storage.inner().clone();
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

#[instrument(skip(pool))]
#[delete("/videos/<vid>")]
pub async fn api_delete_video(
    vid: i64,
    user: User,
    pool: &State<Pool<Sqlite>>,
) -> Result<Status, Status> {
    user.require_permission(Permission::DeleteVideos)?;
    // Soft delete only: keep the storage blob and watch history around so
    // an accidental delete can be recovered by clearing `deleted_at`. A
    // future hard-purge job will reclaim R2 space for rows that have been
    // soft-deleted for long enough.
    db::delete_video(pool.inner(), vid)
        .await
        .map_err(Status::from)?;
    Ok(Status::NoContent)
}

#[instrument(skip(pool, storage))]
#[get("/videos/<vid>/playback-url")]
pub async fn api_video_playback_url(
    vid: i64,
    user: User,
    pool: &State<Pool<Sqlite>>,
    storage: &State<DynVideoStorage>,
) -> Result<Json<SignedUrlResponse>, Status> {
    let db_video = db::get_db_video(pool.inner(), vid)
        .await
        .map_err(Status::from)?
        .ok_or(Status::NotFound)?;
    // Students can only fetch playback URLs for videos that are effectively
    // visible to them. Coaches bypass the check (library / preview flow).
    let is_coach = user.has_permission(crate::auth::Permission::ViewAllStudents);
    if !is_coach {
        let visible = db::video_visible_to_student(pool.inner(), vid, user.id)
            .await
            .map_err(Status::from)?;
        if !visible {
            return Err(Status::NotFound);
        }
    }
    let status = ProcessingStatus::from_db_str(
        db_video
            .processing_status
            .as_deref()
            .unwrap_or("processing"),
    );
    if status != ProcessingStatus::Ready {
        return Err(Status::Conflict);
    }
    let key = db_video.storage_key.ok_or(Status::Conflict)?;
    let ttl = signed_playback_ttl();
    let started = std::time::Instant::now();
    let url = storage.presign_get(&key, ttl).await.map_err(|e| {
        error!(
            video_id = vid,
            storage_key = %key,
            error = %e,
            "failed to mint signed playback url"
        );
        Status::InternalServerError
    })?;
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
    user: User,
    pool: &State<Pool<Sqlite>>,
    storage: &State<DynVideoStorage>,
) -> Result<Json<SignedUrlResponse>, Status> {
    let db_video = db::get_db_video(pool.inner(), vid)
        .await
        .map_err(Status::from)?
        .ok_or(Status::NotFound)?;
    let is_coach = user.has_permission(crate::auth::Permission::ViewAllStudents);
    if !is_coach {
        let visible = db::video_visible_to_student(pool.inner(), vid, user.id)
            .await
            .map_err(Status::from)?;
        if !visible {
            return Err(Status::NotFound);
        }
    }
    let status = ProcessingStatus::from_db_str(
        db_video
            .processing_status
            .as_deref()
            .unwrap_or("processing"),
    );
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
        .map_err(|e| {
            error!(
                video_id = vid,
                storage_key = %key,
                error = %e,
                "failed to mint signed download url"
            );
            Status::InternalServerError
        })?;
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
    #[serde(default)]
    pub context: Option<WatchContextBody>,
}

#[derive(Deserialize)]
pub struct WatchEventItem {
    pub event: String,
    pub seconds_watched: Option<i64>,
}

#[derive(Deserialize, Default)]
pub struct WatchContextBody {
    pub technique_id: Option<i64>,
    pub syllabus_id: Option<i64>,
    pub sst_id: Option<i64>,
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
    let context = req.context.unwrap_or_default();
    let watch_context = db::WatchContext {
        technique_id: context.technique_id,
        syllabus_id: context.syllabus_id,
        sst_id: context.sst_id,
    };
    db::ingest_watch_events(pool.inner(), vid, user.id, play_id, &inputs, &watch_context)
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

// A thin FromRequest guard that plucks the HMAC signature header from the
// request. Using a guard here lets us access request headers inside a Rocket
// handler alongside a `Data<'_>` body parameter.
pub struct SigHeader(pub Option<String>);

#[rocket::async_trait]
impl<'r> rocket::request::FromRequest<'r> for SigHeader {
    type Error = ();

    async fn from_request(
        req: &'r rocket::Request<'_>,
    ) -> rocket::request::Outcome<Self, Self::Error> {
        let val = req
            .headers()
            .get_one(video_job::SIGNATURE_HEADER)
            .map(|s| s.to_owned());
        rocket::request::Outcome::Success(SigHeader(val))
    }
}

/// Webhook: `POST /api/videos/<id>/processing-result`
///
/// Called by the remote transcode worker after it finishes transcoding.  Auth is
/// HMAC-only (no user session guard). The raw body bytes are verified against
/// the `X-Signature-256` header before any DB writes are attempted.
///
/// Response codes:
/// - 200 OK: result applied (or idempotently no-op'd if already ready).
/// - 400 Bad Request: body exceeds 64 KiB or JSON parse failed.
/// - 401 Unauthorized: missing or invalid HMAC signature.
/// - 404 Not Found: `video_id` not in the database.
/// - 503 Service Unavailable: no callback secret is configured.
#[instrument(skip(body, sig_header, secret, pool))]
#[post("/videos/<video_id>/processing-result", data = "<body>")]
pub async fn api_processing_result(
    video_id: i64,
    body: Data<'_>,
    sig_header: SigHeader,
    secret: &State<CallbackSecret>,
    pool: &State<Pool<Sqlite>>,
) -> Result<Status, Status> {
    const MAX_BODY: u64 = 64 * 1024; // 64 KiB

    // 503 if no secret configured.
    let secret_str = match secret.0.as_deref() {
        Some(s) => s,
        None => {
            warn!("processing-result webhook called but VIDEO_CALLBACK_SECRET is not set");
            return Err(Status::ServiceUnavailable);
        }
    };

    // Read the raw body with a size cap.
    let raw: Vec<u8> = match body.open(MAX_BODY.bytes()).into_bytes().await {
        Ok(bytes) if bytes.is_complete() => bytes.into_inner(),
        Ok(_) => {
            warn!(video_id, "processing-result body exceeded 64 KiB limit");
            return Err(Status::PayloadTooLarge);
        }
        Err(e) => {
            error!(video_id, error = %e, "failed to read processing-result body");
            return Err(Status::BadRequest);
        }
    };

    // 401 if signature header is missing.
    let sig_hex = match sig_header.0.as_deref() {
        Some(s) => s,
        None => {
            warn!(video_id, "processing-result request missing X-Signature-256 header");
            return Err(Status::Unauthorized);
        }
    };

    // Constant-time HMAC verification.
    if !video_job::verify(secret_str.as_bytes(), &raw, sig_hex) {
        warn!(video_id, "processing-result HMAC verification failed");
        return Err(Status::Unauthorized);
    }

    // Parse the JSON payload.
    let result: video_job::ProcessingResult = match serde_json::from_slice(&raw) {
        Ok(r) => r,
        Err(e) => {
            error!(video_id, error = %e, "processing-result body failed JSON parse");
            return Err(Status::BadRequest);
        }
    };

    // Verify the video exists before writing.
    match db::get_db_video(pool.inner(), video_id).await {
        Ok(Some(_)) => {}
        Ok(None) => {
            warn!(video_id, "processing-result callback for unknown video");
            return Err(Status::NotFound);
        }
        Err(e) => {
            error!(video_id, error = %e, "db lookup failed in processing-result webhook");
            return Err(Status::InternalServerError);
        }
    }

    // Apply idempotently.
    match apply_processing_result(pool.inner(), video_id, result).await {
        Ok(()) => {
            info!(video_id, "processing-result applied successfully");
            Ok(Status::Ok)
        }
        Err(e) => {
            error!(video_id, error = %e, "failed to apply processing-result");
            Err(Status::InternalServerError)
        }
    }
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
