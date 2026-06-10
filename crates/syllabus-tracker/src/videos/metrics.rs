use once_cell::sync::Lazy;
use opentelemetry::{
    KeyValue, global,
    metrics::{Counter, Gauge, Histogram, Meter},
};

pub struct VideoMetrics {
    pub uploads_total: Counter<u64>,
    pub transcodes_total: Counter<u64>,
    pub transcode_failures_total: Counter<u64>,
    pub watch_events_total: Counter<u64>,
    pub watch_plays_total: Counter<u64>,

    pub upload_bytes: Histogram<u64>,
    pub upload_duration_ms: Histogram<u64>,
    pub ffprobe_duration_ms: Histogram<u64>,
    pub transcode_duration_ms: Histogram<u64>,
    pub s3_put_duration_ms: Histogram<u64>,
    pub video_duration_seconds: Histogram<u64>,
    pub signed_url_mint_duration_ms: Histogram<u64>,

    pub storage_bytes_total: Gauge<u64>,
    pub storage_objects_total: Gauge<u64>,
    pub processing_jobs_active: Gauge<i64>,
}

impl VideoMetrics {
    fn build(meter: &Meter) -> Self {
        Self {
            uploads_total: meter
                .u64_counter("video_uploads_total")
                .with_description("Native video uploads attempted, by outcome")
                .build(),
            transcodes_total: meter
                .u64_counter("video_transcodes_total")
                .with_description("Transcode attempts, by outcome")
                .build(),
            transcode_failures_total: meter
                .u64_counter("video_transcode_failures_total")
                .with_description("Transcode failures, labelled by pipeline stage")
                .build(),
            watch_events_total: meter
                .u64_counter("video_watch_events_total")
                .with_description("Watch events ingested, by event type")
                .build(),
            watch_plays_total: meter
                .u64_counter("video_watch_plays_total")
                .with_description("Distinct video plays (new play_id seen)")
                .build(),

            upload_bytes: meter
                .u64_histogram("video_upload_bytes")
                .with_description("Bytes of native video uploads accepted")
                .with_unit("By")
                .build(),
            upload_duration_ms: meter
                .u64_histogram("video_upload_duration_ms")
                .with_description("End-to-end time from client upload start to ready")
                .with_unit("ms")
                .build(),
            ffprobe_duration_ms: meter
                .u64_histogram("video_ffprobe_duration_ms")
                .with_description("Time spent in ffprobe per upload")
                .with_unit("ms")
                .build(),
            transcode_duration_ms: meter
                .u64_histogram("video_transcode_duration_ms")
                .with_description(
                    "Time spent in ffmpeg per upload (skipped when already H.264 mp4)",
                )
                .with_unit("ms")
                .build(),
            s3_put_duration_ms: meter
                .u64_histogram("video_s3_put_duration_ms")
                .with_description("Time spent uploading the final mp4 to object storage")
                .with_unit("ms")
                .build(),
            video_duration_seconds: meter
                .u64_histogram("video_duration_seconds")
                .with_description("Duration of accepted videos")
                .with_unit("s")
                .build(),
            signed_url_mint_duration_ms: meter
                .u64_histogram("video_signed_url_mint_duration_ms")
                .with_description("Time spent minting playback or download signed URLs")
                .with_unit("ms")
                .build(),

            storage_bytes_total: meter
                .u64_gauge("video_storage_bytes_total")
                .with_description("Total bytes occupied by ready videos in object storage")
                .with_unit("By")
                .build(),
            storage_objects_total: meter
                .u64_gauge("video_storage_objects_total")
                .with_description("Total ready video objects in object storage")
                .build(),
            processing_jobs_active: meter
                .i64_gauge("video_processing_jobs_active")
                .with_description("Concurrent video processing jobs in flight")
                .build(),
        }
    }
}

static METRICS: Lazy<VideoMetrics> = Lazy::new(|| {
    let meter = global::meter("syllabus-tracker.videos");
    VideoMetrics::build(&meter)
});

pub fn video_metrics() -> &'static VideoMetrics {
    &METRICS
}

pub fn kv(key: &'static str, value: impl Into<opentelemetry::Value>) -> KeyValue {
    KeyValue::new(key, value.into())
}
