use std::path::PathBuf;
use std::sync::atomic::{AtomicI64, Ordering};
use std::sync::Arc;
use std::time::Duration;

use sqlx::SqlitePool;
use thiserror::Error;
use tokio::time::Instant;
use tracing::{error, info, instrument, warn};
use uuid::Uuid;

use crate::db;
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
    metrics
        .upload_duration_ms
        .record(elapsed_ms, &[]);

    match result {
        Ok(()) => {
            info!(elapsed_ms = elapsed_ms as i64, "video pipeline ok");
            metrics
                .uploads_total
                .add(1, &[kv("result", "ok")]);
        }
        Err(err) => {
            error!(
                elapsed_ms = elapsed_ms as i64,
                error = %err,
                "video pipeline failed",
            );
            let message = err.to_string();
            metrics
                .uploads_total
                .add(1, &[kv("result", "fail")]);
            if let Err(db_err) = db::mark_video_failed(&ctx.pool, video_id, &message).await {
                error!(error = %db_err, "failed to record video failure");
            }
        }
    }
    ctx.jobs.decrement();
}

async fn run_pipeline(
    ctx: &PipelineContext,
    video_id: i64,
    technique_id: i64,
    temp_input: &PathBuf,
    cleanup: &mut TempCleanup,
) -> Result<(), PipelineError> {
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
        metrics
            .transcodes_total
            .add(1, &[kv("result", "skipped")]);
        temp_input.clone()
    } else {
        let mut transcoded = temp_input.clone();
        transcoded.set_extension("out.mp4");
        cleanup.track(transcoded.clone());
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
                metrics
                    .transcodes_total
                    .add(1, &[kv("result", "ok")]);
            }
            Err(err) => {
                metrics
                    .transcodes_total
                    .add(1, &[kv("result", "fail")]);
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
    let storage_key = format!(
        "videos/{}/{}.mp4",
        technique_id,
        Uuid::new_v4()
    );

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

    db::finalize_video_ready(
        &ctx.pool,
        video_id,
        &storage_key,
        bytes,
        probe.duration_seconds.round() as i64,
        probe.width,
        probe.height,
        "video/mp4",
    )
    .await?;

    Ok(())
}

fn enforce_duration(probe: &ProbeResult, limit: i64) -> Result<(), PipelineError> {
    if probe.duration_seconds.round() as i64 > limit {
        return Err(PipelineError::DurationTooLong(probe.duration_seconds, limit));
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
        .unwrap_or(180)
}
