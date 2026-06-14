pub mod embeds;
pub mod metrics;
pub mod pipeline;
pub mod processor;
pub mod routes;

pub use video_media::media;
pub use video_media::storage;

pub use media::{DynMediaProbe, DynMediaTranscode, FfmpegMediaTranscode, FfprobeMediaProbe};
pub use pipeline::{PipelineContext, ProcessingJobs, apply_processing_result};
pub use processor::{DynVideoProcessor, HostFfmpegProcessor, HostJob, VideoProcessor};
pub use routes::*;
pub use storage::{DynVideoStorage, S3Config, S3VideoStorage};

pub struct VideoStack {
    pub storage: DynVideoStorage,
    pub probe: DynMediaProbe,
    pub transcode: DynMediaTranscode,
}
