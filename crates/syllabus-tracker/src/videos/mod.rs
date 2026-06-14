pub mod embeds;
pub mod metrics;
pub mod pipeline;
pub mod processor;
pub mod routes;

pub use video_media::media;
pub use video_media::storage;

pub use media::{DynMediaProbe, DynMediaTranscode, FfmpegMediaTranscode, FfprobeMediaProbe};
pub use pipeline::{PipelineContext, ProcessingJobs, apply_processing_result};
pub use processor::{CloudflareProcessor, DynVideoProcessor, HostFfmpegProcessor, HostJob, VideoProcessor};
pub use routes::{
    CallbackSecret, SigHeader,
    api_admin_storage, api_dashboard_video_overview, api_delete_video,
    api_list_technique_videos, api_my_watch_state, api_processing_result,
    api_reorder_videos, api_replace_video, api_set_video_global_hidden,
    api_set_video_student_visibility, api_student_watch_activity, api_update_video,
    api_video_download_url, api_video_link, api_video_playback_url, api_video_privacy_ack,
    api_video_privacy_ack_status, api_video_stats, api_video_status, api_video_upload,
    api_video_watch_events,
};
pub use storage::{DynVideoStorage, S3Config, S3VideoStorage};

pub struct VideoStack {
    pub storage: DynVideoStorage,
    pub probe: DynMediaProbe,
    pub transcode: DynMediaTranscode,
}
