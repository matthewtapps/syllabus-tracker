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
