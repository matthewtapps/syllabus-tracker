pub mod embeds;
pub mod media;
pub mod metrics;
pub mod pipeline;
pub mod routes;
pub mod storage;

pub use media::{DynMediaProbe, DynMediaTranscode, FfmpegMediaTranscode, FfprobeMediaProbe};
pub use pipeline::{PipelineContext, ProcessingJobs};
pub use routes::*;
pub use storage::{DynVideoStorage, S3Config, S3VideoStorage};

pub struct VideoStack {
    pub storage: DynVideoStorage,
    pub probe: DynMediaProbe,
    pub transcode: DynMediaTranscode,
}
