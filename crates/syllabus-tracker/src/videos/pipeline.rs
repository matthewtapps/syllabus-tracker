use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::atomic::{AtomicI64, Ordering};
use std::time::Duration;

use sqlx::SqlitePool;
use thiserror::Error;
use tokio::time::Instant;
use tracing::{error, info, instrument, warn};
use uuid::Uuid;
use video_job::ProcessingResult;

use crate::db;
use crate::error::AppError;
use crate::videos::media::{DynMediaProbe, DynMediaTranscode, MediaError, ProbeResult};
use crate::videos::metrics::{kv, video_metrics};
use crate::videos::storage::{DynVideoStorage, StorageError};

#[derive(Default)]
pub struct ProcessingJobs(AtomicI64);

impl ProcessingJobs {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn snapshot(&self) -> i64 {
        self.0.load(Ordering::Relaxed)
    }

    fn increment(&self) {
        self.0.fetch_add(1, Ordering::Relaxed);
    }

    fn decrement(&self) {
        self.0.fetch_sub(1, Ordering::Relaxed);
    }
}

#[derive(Debug, Error)]
pub enum PipelineError {
    #[error("video duration {0:.1}s exceeds limit {1}s")]
    DurationTooLong(f64, i64),
    #[error("probe error: {0}")]
    Probe(#[from] MediaError),
    #[error("storage error: {0}")]
    Storage(#[from] StorageError),
    #[error("db error: {0}")]
    Db(#[from] crate::error::AppError),
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
}

pub struct PipelineContext {
    pub pool: SqlitePool,
    pub storage: DynVideoStorage,
    pub probe: DynMediaProbe,
    pub transcode: DynMediaTranscode,
    pub jobs: Arc<ProcessingJobs>,
    pub max_duration_seconds: i64,
    /// Bounds concurrent ffmpeg transcodes. Each upload spawns its own task, so
    /// without this a burst of uploads runs N CPU-bound transcodes at once and
    /// starves the co-located web server. Permits queue the rest.
    pub transcode_permits: Arc<tokio::sync::Semaphore>,
}

struct TempCleanup {
    paths: Vec<PathBuf>,
}

impl TempCleanup {
    fn new() -> Self {
        Self { paths: Vec::new() }
    }

    fn track(&mut self, path: PathBuf) {
        self.paths.push(path);
    }
}

impl Drop for TempCleanup {
    fn drop(&mut self) {
        for path in self.paths.drain(..) {
            if let Err(e) = std::fs::remove_file(&path) {
                if e.kind() != std::io::ErrorKind::NotFound {
                    warn!("failed to clean temp file {}: {}", path.display(), e);
                }
            }
        }
    }
}

#[instrument(skip(ctx, temp_input), fields(video_id = video_id, technique_id = technique_id))]
pub async fn process_uploaded_video(
    ctx: Arc<PipelineContext>,
    video_id: i64,
    technique_id: i64,
    temp_input: PathBuf,
) {
    ctx.jobs.increment();
    let started = Instant::now();
    let mut cleanup = TempCleanup::new();
    cleanup.track(temp_input.clone());

    let result = run_pipeline(&ctx, video_id, technique_id, &temp_input, &mut cleanup).await;
    let elapsed = started.elapsed();

    let elapsed_ms = elapsed.as_millis() as u64;
    let metrics = video_metrics();
    metrics.upload_duration_ms.record(elapsed_ms, &[]);

    match result {
        Ok(processing_result) => {
            info!(elapsed_ms = elapsed_ms as i64, "video pipeline ok");
            metrics.uploads_total.add(1, &[kv("result", "ok")]);
            if let Err(db_err) =
                apply_processing_result(&ctx.pool, video_id, processing_result).await
            {
                error!(error = %db_err, "failed to record video ready");
            }
        }
        Err(err) => {
            error!(
                elapsed_ms = elapsed_ms as i64,
                error = %err,
                "video pipeline failed",
            );
            let message = err.to_string();
            metrics.uploads_total.add(1, &[kv("result", "fail")]);
            if let Err(db_err) = apply_processing_result(
                &ctx.pool,
                video_id,
                ProcessingResult::Failed { error: message },
            )
            .await
            {
                error!(error = %db_err, "failed to record video failure");
            }
        }
    }
    ctx.jobs.decrement();
}

/// Apply a `ProcessingResult` to the database row for `video_id`.
///
/// Idempotent: if the row is already `ready`, this is a no-op (returns `Ok`).
/// That means applying `Ready` twice, or `Ready` then `Failed`, always leaves
/// the row in `ready` state.
pub async fn apply_processing_result(
    pool: &SqlitePool,
    video_id: i64,
    result: ProcessingResult,
) -> Result<(), AppError> {
    match result {
        ProcessingResult::Ready {
            storage_key,
            duration_seconds,
            width,
            height,
            bytes,
        } => {
            db::finalize_video_ready_if_not_ready(
                pool,
                video_id,
                &storage_key,
                bytes,
                duration_seconds,
                Some(width),
                Some(height),
            )
            .await
        }
        ProcessingResult::Failed { error } => {
            db::mark_video_failed_if_not_ready(pool, video_id, &error).await
        }
    }
}

async fn run_pipeline(
    ctx: &PipelineContext,
    _video_id: i64,
    technique_id: i64,
    temp_input: &Path,
    cleanup: &mut TempCleanup,
) -> Result<ProcessingResult, PipelineError> {
    let metrics = video_metrics();

    let probe_started = Instant::now();
    let probe = match ctx.probe.probe(temp_input).await {
        Ok(probe) => probe,
        Err(err) => {
            metrics
                .transcode_failures_total
                .add(1, &[kv("stage", "ffprobe")]);
            return Err(err.into());
        }
    };
    metrics
        .ffprobe_duration_ms
        .record(probe_started.elapsed().as_millis() as u64, &[]);
    metrics
        .video_duration_seconds
        .record(probe.duration_seconds.round() as u64, &[]);

    if let Err(err) = enforce_duration(&probe, ctx.max_duration_seconds) {
        metrics
            .transcode_failures_total
            .add(1, &[kv("stage", "duration")]);
        return Err(err);
    }

    let upload_path = if probe.is_h264_mp4() {
        metrics.transcodes_total.add(1, &[kv("result", "skipped")]);
        temp_input.to_path_buf()
    } else {
        let mut transcoded = temp_input.to_path_buf();
        transcoded.set_extension("out.mp4");
        cleanup.track(transcoded.clone());
        // Wait for a transcode slot so concurrent uploads don't peg the CPU.
        // acquire() only errors if the semaphore is closed (never, here).
        let _permit = ctx.transcode_permits.acquire().await;
        let transcode_started = Instant::now();
        match ctx
            .transcode
            .transcode_to_h264_mp4(temp_input, &transcoded)
            .await
        {
            Ok(()) => {
                metrics
                    .transcode_duration_ms
                    .record(transcode_started.elapsed().as_millis() as u64, &[]);
                metrics.transcodes_total.add(1, &[kv("result", "ok")]);
            }
            Err(err) => {
                metrics.transcodes_total.add(1, &[kv("result", "fail")]);
                metrics
                    .transcode_failures_total
                    .add(1, &[kv("stage", "ffmpeg")]);
                return Err(err.into());
            }
        }
        transcoded
    };

    let bytes = tokio::fs::metadata(&upload_path).await?.len() as i64;
    metrics.upload_bytes.record(bytes as u64, &[]);
    let storage_key = format!("videos/{}/{}.mp4", technique_id, Uuid::new_v4());

    let put_started = Instant::now();
    if let Err(err) = ctx
        .storage
        .put_file(&storage_key, "video/mp4", &upload_path)
        .await
    {
        metrics
            .transcode_failures_total
            .add(1, &[kv("stage", "s3_put")]);
        return Err(err.into());
    }
    metrics
        .s3_put_duration_ms
        .record(put_started.elapsed().as_millis() as u64, &[]);

    Ok(ProcessingResult::Ready {
        storage_key,
        bytes,
        duration_seconds: probe.duration_seconds.round() as i64,
        width: probe.width.unwrap_or(0),
        height: probe.height.unwrap_or(0),
    })
}

fn enforce_duration(probe: &ProbeResult, limit: i64) -> Result<(), PipelineError> {
    if probe.duration_seconds.round() as i64 > limit {
        return Err(PipelineError::DurationTooLong(
            probe.duration_seconds,
            limit,
        ));
    }
    Ok(())
}

pub fn temp_dir() -> PathBuf {
    PathBuf::from(
        dotenvy::var("VIDEO_UPLOAD_TEMP_DIR").unwrap_or_else(|_| "/tmp/syllabus/uploads".into()),
    )
}

pub fn signed_playback_ttl() -> Duration {
    Duration::from_secs(
        dotenvy::var("VIDEO_PLAYBACK_URL_TTL_SECONDS")
            .ok()
            .and_then(|s| s.parse().ok())
            .unwrap_or(3600),
    )
}

pub fn signed_download_ttl() -> Duration {
    Duration::from_secs(
        dotenvy::var("VIDEO_DOWNLOAD_URL_TTL_SECONDS")
            .ok()
            .and_then(|s| s.parse().ok())
            .unwrap_or(600),
    )
}

pub fn max_video_bytes() -> i64 {
    dotenvy::var("VIDEO_MAX_BYTES")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(209_715_200)
}

pub fn max_video_duration_seconds() -> i64 {
    dotenvy::var("VIDEO_MAX_DURATION_SECONDS")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(300)
}

/// Max concurrent ffmpeg transcodes. Default 1 so a burst of uploads on a
/// small, co-located host processes serially instead of saturating the CPU.
pub fn max_transcode_concurrency() -> usize {
    dotenvy::var("VIDEO_TRANSCODE_CONCURRENCY")
        .ok()
        .and_then(|s| s.parse().ok())
        .filter(|&n: &usize| n >= 1)
        .unwrap_or(1)
}

#[cfg(test)]
mod tests {
    use migration_engine::migrations::{migrate_database_declaratively, read_schema_file_to_string};
    use sqlx::{Pool, Sqlite, sqlite::SqlitePoolOptions};
    use video_job::ProcessingResult;

    use super::apply_processing_result;

    async fn setup_test_db() -> Pool<Sqlite> {
        crate::env::load_test_environment().expect("load test env");

        let pool = SqlitePoolOptions::new()
            .max_connections(5)
            .connect("sqlite::memory:")
            .await
            .expect("failed to create in-memory database");

        let schema_path = dotenvy::var("SCHEMA_PATH").expect("SCHEMA_PATH not set");
        let schema = read_schema_file_to_string(std::path::Path::new(&schema_path))
            .expect("failed to read schema file");

        migrate_database_declaratively(pool.clone(), &schema, false)
            .await
            .expect("failed to migrate test database");

        pool
    }

    /// Insert a minimal video row in `processing` state and return its id.
    async fn insert_processing_video(pool: &Pool<Sqlite>) -> i64 {
        // We need a user and technique first because of FK constraints.
        // Use query() (not query_scalar!) to avoid sqlx macro type inference
        // differences across feature flags.
        sqlx::query(
            "INSERT INTO users (username, password, role) VALUES ('tester', 'hash', 'coach')"
        )
        .execute(pool)
        .await
        .expect("failed to insert test user");

        let user_id: i64 = sqlx::query_scalar(
            "SELECT id FROM users WHERE username = 'tester'"
        )
        .fetch_one(pool)
        .await
        .expect("failed to fetch user id");

        sqlx::query(
            "INSERT INTO techniques (name, description, coach_id) VALUES ('T', 'D', ?)"
        )
        .bind(user_id)
        .execute(pool)
        .await
        .expect("failed to insert test technique");

        let technique_id: i64 = sqlx::query_scalar(
            "SELECT id FROM techniques WHERE name = 'T'"
        )
        .fetch_one(pool)
        .await
        .expect("failed to fetch technique id");

        sqlx::query(
            "INSERT INTO videos (technique_id, title, position, kind, processing_status, uploaded_by_id) \
             VALUES (?, 'clip', 0, 'native', 'processing', ?)"
        )
        .bind(technique_id)
        .bind(user_id)
        .execute(pool)
        .await
        .expect("failed to insert test video");

        sqlx::query_scalar("SELECT id FROM videos WHERE title = 'clip'")
            .fetch_one(pool)
            .await
            .expect("failed to fetch video id")
    }

    async fn get_status(pool: &Pool<Sqlite>, video_id: i64) -> (String, Option<String>, Option<String>) {
        use sqlx::Row;
        let row = sqlx::query(
            "SELECT processing_status, processing_error, storage_key FROM videos WHERE id = ?"
        )
        .bind(video_id)
        .fetch_one(pool)
        .await
        .expect("video row not found");
        (
            row.get::<String, _>("processing_status"),
            row.get::<Option<String>, _>("processing_error"),
            row.get::<Option<String>, _>("storage_key"),
        )
    }

    #[tokio::test]
    async fn apply_processing_result_ready_sets_metadata() {
        let pool = setup_test_db().await;
        let video_id = insert_processing_video(&pool).await;

        apply_processing_result(
            &pool,
            video_id,
            ProcessingResult::Ready {
                storage_key: "videos/1/abc.mp4".into(),
                duration_seconds: 42,
                width: 1280,
                height: 720,
                bytes: 1_000_000,
            },
        )
        .await
        .expect("apply_processing_result should succeed");

        let (status, error, key) = get_status(&pool, video_id).await;
        assert_eq!(status, "ready");
        assert!(error.is_none(), "processing_error should be NULL after Ready");
        assert_eq!(key.as_deref(), Some("videos/1/abc.mp4"));
    }

    #[tokio::test]
    async fn apply_processing_result_failed_sets_error() {
        let pool = setup_test_db().await;
        let video_id = insert_processing_video(&pool).await;

        apply_processing_result(
            &pool,
            video_id,
            ProcessingResult::Failed {
                error: "ffmpeg exploded".into(),
            },
        )
        .await
        .expect("apply_processing_result should succeed");

        let (status, error, _key) = get_status(&pool, video_id).await;
        assert_eq!(status, "failed");
        assert_eq!(error.as_deref(), Some("ffmpeg exploded"));
    }

    #[tokio::test]
    async fn apply_processing_result_idempotent_ready_then_ready() {
        let pool = setup_test_db().await;
        let video_id = insert_processing_video(&pool).await;

        let ready = ProcessingResult::Ready {
            storage_key: "videos/1/first.mp4".into(),
            duration_seconds: 10,
            width: 1920,
            height: 1080,
            bytes: 500_000,
        };

        apply_processing_result(&pool, video_id, ready.clone())
            .await
            .expect("first apply should succeed");
        // Apply a second Ready with a different key to prove the first wins.
        apply_processing_result(
            &pool,
            video_id,
            ProcessingResult::Ready {
                storage_key: "videos/1/second.mp4".into(),
                duration_seconds: 99,
                width: 640,
                height: 480,
                bytes: 1,
            },
        )
        .await
        .expect("second apply should succeed (no-op)");

        let (status, _, key) = get_status(&pool, video_id).await;
        assert_eq!(status, "ready");
        assert_eq!(
            key.as_deref(),
            Some("videos/1/first.mp4"),
            "second Ready must not overwrite an already-ready row"
        );
    }

    #[tokio::test]
    async fn apply_processing_result_idempotent_ready_then_failed() {
        let pool = setup_test_db().await;
        let video_id = insert_processing_video(&pool).await;

        apply_processing_result(
            &pool,
            video_id,
            ProcessingResult::Ready {
                storage_key: "videos/1/ok.mp4".into(),
                duration_seconds: 5,
                width: 1280,
                height: 720,
                bytes: 200_000,
            },
        )
        .await
        .expect("Ready apply should succeed");

        // A late failure report must not overwrite the ready row.
        apply_processing_result(
            &pool,
            video_id,
            ProcessingResult::Failed {
                error: "late failure".into(),
            },
        )
        .await
        .expect("Failed apply on already-ready row should return Ok");

        let (status, error, _) = get_status(&pool, video_id).await;
        assert_eq!(status, "ready", "status must stay ready");
        assert!(error.is_none(), "error must not be written over ready row");
    }
}
