use std::path::PathBuf;
use std::sync::Arc;

use async_trait::async_trait;

use crate::videos::pipeline::{PipelineContext, process_uploaded_video};

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/// Arguments for a single video processing job.
pub struct HostJob {
    pub video_id: i64,
    pub technique_id: i64,
    pub original_temp_path: PathBuf,
}

// ---------------------------------------------------------------------------
// Trait
// ---------------------------------------------------------------------------

/// Abstraction over how a video upload is handed off for processing.
///
/// `start` returns once the job is *accepted*; actual processing is
/// asynchronous. For the host implementation this means a `tokio::spawn`
/// is fired and the call returns immediately.
#[async_trait]
pub trait VideoProcessor: Send + Sync {
    async fn start(&self, job: HostJob);
}

// ---------------------------------------------------------------------------
// Host (ffmpeg on the web host) implementation
// ---------------------------------------------------------------------------

/// Processes videos inline on the web host using ffmpeg, exactly as the
/// upload route did before the `VideoProcessor` seam was introduced.
///
/// Semaphore-capped via `PipelineContext::transcode_permits` so a burst of
/// concurrent uploads does not saturate the CPU.
pub struct HostFfmpegProcessor {
    ctx: Arc<PipelineContext>,
}

impl HostFfmpegProcessor {
    pub fn new(ctx: Arc<PipelineContext>) -> Self {
        Self { ctx }
    }
}

#[async_trait]
impl VideoProcessor for HostFfmpegProcessor {
    async fn start(&self, job: HostJob) {
        let ctx = Arc::clone(&self.ctx);
        tokio::task::spawn(async move {
            process_uploaded_video(
                ctx,
                job.video_id,
                job.technique_id,
                job.original_temp_path,
            )
            .await;
        });
    }
}

// ---------------------------------------------------------------------------
// Type alias for Rocket state
// ---------------------------------------------------------------------------

/// The concrete type stored as Rocket `State`. Routes pull this out via
/// `&State<DynVideoProcessor>` and call `.start(job).await`.
pub type DynVideoProcessor = Arc<dyn VideoProcessor>;

// ---------------------------------------------------------------------------
// Cloudflare (R2 upload + Worker enqueue) implementation
// ---------------------------------------------------------------------------

/// Configuration for the Cloudflare processing path.
pub struct CloudflareConfig {
    /// Full URL of the Cloudflare Worker enqueue endpoint.
    pub enqueue_url: String,
    /// Bearer token for the enqueue endpoint.
    pub enqueue_token: String,
    /// Base URL of this app (used to build the processing-result callback URL).
    pub callback_base_url: String,
}

/// Pure helper: build the (url, authorization-header-value, json-body) tuple
/// that should be sent to the Worker enqueue endpoint.
///
/// Kept free of I/O so it can be unit-tested without network or async.
pub fn build_enqueue_request(
    cfg: &CloudflareConfig,
    video_id: i64,
    source_key: &str,
) -> (String, String, String) {
    let url = cfg.enqueue_url.clone();
    let auth = format!("Bearer {}", cfg.enqueue_token);
    let callback_url = format!(
        "{}/api/videos/{}/processing-result",
        cfg.callback_base_url.trim_end_matches('/'),
        video_id
    );
    let job = video_job::ProcessJob {
        video_id,
        source_key: source_key.to_string(),
        callback_url,
    };
    let body = serde_json::to_string(&job).expect("ProcessJob is always serializable");
    (url, auth, body)
}

/// Processes videos by uploading the original file to R2 and enqueueing a
/// transcoding job on a Cloudflare Worker. The actual transcode happens
/// in a remote container; the webhook (a later task) finalises the row.
pub struct CloudflareProcessor {
    pool: sqlx::SqlitePool,
    storage: crate::videos::storage::DynVideoStorage,
    http: reqwest::Client,
    cfg: CloudflareConfig,
}

impl CloudflareProcessor {
    /// Construct from environment variables, failing fast if any required var
    /// is missing.
    pub fn from_env(pool: sqlx::SqlitePool) -> Result<Self, crate::error::AppError> {
        let read = |key: &str| -> Result<String, crate::error::AppError> {
            dotenvy::var(key).map_err(|_| {
                crate::error::AppError::Internal(format!(
                    "CloudflareProcessor: missing required env var {}",
                    key
                ))
            })
        };

        let cfg = CloudflareConfig {
            enqueue_url: read("VIDEO_ENQUEUE_URL")?,
            enqueue_token: read("VIDEO_ENQUEUE_TOKEN")?,
            callback_base_url: read("VIDEO_CALLBACK_BASE_URL")?,
        };

        // Reuse the same S3/R2 env vars the host storage uses.
        let s3_cfg = video_media::storage::S3Config::from_env().map_err(|e| {
            crate::error::AppError::Internal(format!(
                "CloudflareProcessor: R2 storage config error: {}",
                e
            ))
        })?;
        let storage: crate::videos::storage::DynVideoStorage =
            std::sync::Arc::new(video_media::storage::S3VideoStorage::new(&s3_cfg));

        let http = reqwest::Client::new();

        Ok(Self {
            pool,
            storage,
            http,
            cfg,
        })
    }
}

#[async_trait]
impl VideoProcessor for CloudflareProcessor {
    async fn start(&self, job: HostJob) {
        use tracing::error;
        use video_job::ProcessingResult;

        // 1. Build the R2 key for the original upload.
        let source_key = format!(
            "originals/{}/{}.mp4",
            job.video_id,
            uuid::Uuid::new_v4()
        );

        // 2. PUT the original file to R2.
        if let Err(e) = self
            .storage
            .put_file(&source_key, "video/mp4", &job.original_temp_path)
            .await
        {
            error!(video_id = job.video_id, error = %e, "CloudflareProcessor: R2 upload failed");
            if let Err(db_err) = crate::videos::pipeline::apply_processing_result(
                &self.pool,
                job.video_id,
                ProcessingResult::Failed {
                    error: format!("R2 upload failed: {}", e),
                },
            )
            .await
            {
                error!(video_id = job.video_id, error = %db_err, "CloudflareProcessor: failed to mark video failed after upload error");
            }
            return;
        }

        // 3. Enqueue the processing job on the Cloudflare Worker.
        let (url, auth, body) = build_enqueue_request(&self.cfg, job.video_id, &source_key);

        let result = self
            .http
            .post(&url)
            .header("Authorization", &auth)
            .header("Content-Type", "application/json")
            .body(body)
            .send()
            .await;

        match result {
            Ok(resp) if resp.status().is_success() => {
                // Leave the row in `processing`; the webhook will finalise it.
            }
            Ok(resp) => {
                let status = resp.status();
                let text = resp.text().await.unwrap_or_default();
                error!(
                    video_id = job.video_id,
                    http_status = status.as_u16(),
                    body = %text,
                    "CloudflareProcessor: Worker enqueue returned non-2xx"
                );
                if let Err(db_err) = crate::videos::pipeline::apply_processing_result(
                    &self.pool,
                    job.video_id,
                    ProcessingResult::Failed {
                        error: format!("Worker enqueue failed with status {}: {}", status, text),
                    },
                )
                .await
                {
                    error!(video_id = job.video_id, error = %db_err, "CloudflareProcessor: failed to mark video failed after enqueue error");
                }
            }
            Err(e) => {
                error!(video_id = job.video_id, error = %e, "CloudflareProcessor: Worker enqueue transport error");
                if let Err(db_err) = crate::videos::pipeline::apply_processing_result(
                    &self.pool,
                    job.video_id,
                    ProcessingResult::Failed {
                        error: format!("Worker enqueue transport error: {}", e),
                    },
                )
                .await
                {
                    error!(video_id = job.video_id, error = %db_err, "CloudflareProcessor: failed to mark video failed after transport error");
                }
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn build_enqueue_request_shapes_url_headers_body() {
        let cfg = CloudflareConfig {
            enqueue_url: "https://worker.example/jobs".into(),
            enqueue_token: "tok123".into(),
            callback_base_url: "https://app.example".into(),
        };
        let (url, auth, body) = build_enqueue_request(
            &cfg,
            /*video_id*/ 42,
            /*source_key*/ "originals/42/abc.mp4",
        );
        assert_eq!(url, "https://worker.example/jobs");
        assert_eq!(auth, "Bearer tok123");
        // body is the JSON of ProcessJob
        let job: video_job::ProcessJob = serde_json::from_str(&body).unwrap();
        assert_eq!(job.video_id, 42);
        assert_eq!(job.source_key, "originals/42/abc.mp4");
        assert_eq!(
            job.callback_url,
            "https://app.example/api/videos/42/processing-result"
        );
    }
}
