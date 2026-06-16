use anyhow::{Context, anyhow};
use tracing::{error, info};
use video_job::{ProcessingResult, SIGNATURE_HEADER};
use video_media::{
    media::{FfmpegMediaTranscode, FfprobeMediaProbe, MediaProbe, MediaTranscode},
    storage::{S3Config, S3VideoStorage, VideoStorage},
};

// ---------------------------------------------------------------------------
// Pure helpers (tested below)
// ---------------------------------------------------------------------------

/// Configuration parsed from environment variables.
struct JobConfig {
    video_id: i64,
    source_key: String,
    callback_url: String,
    callback_secret: String,
}

impl JobConfig {
    /// Build from an arbitrary key-lookup function. Lets tests inject values
    /// without touching the real environment.
    fn from_getter(get: impl Fn(&str) -> Option<String>) -> anyhow::Result<Self> {
        let require = |key: &str| -> anyhow::Result<String> {
            get(key).ok_or_else(|| anyhow!("missing required env var: {}", key))
        };

        let video_id_str = require("VIDEO_ID")?;
        let video_id: i64 = video_id_str
            .parse()
            .with_context(|| format!("VIDEO_ID must be an integer, got {:?}", video_id_str))?;

        Ok(Self {
            video_id,
            source_key: require("SOURCE_KEY")?,
            callback_url: require("CALLBACK_URL")?,
            callback_secret: require("VIDEO_CALLBACK_SECRET")?,
        })
    }

    fn from_env() -> anyhow::Result<Self> {
        Self::from_getter(|k| std::env::var(k).ok())
    }
}

/// Generate a unique R2 storage key for the transcoded output.
fn output_key(video_id: i64) -> String {
    format!("videos/{}/{}.mp4", video_id, uuid::Uuid::new_v4())
}

// ---------------------------------------------------------------------------
// Webhook POST helper
// ---------------------------------------------------------------------------

async fn post_result(
    client: &reqwest::Client,
    url: &str,
    secret: &str,
    result: &ProcessingResult,
) -> anyhow::Result<()> {
    let body = serde_json::to_string(result).context("serializing ProcessingResult")?;
    let sig = video_job::sign(secret.as_bytes(), body.as_bytes());

    let resp = client
        .post(url)
        .header(SIGNATURE_HEADER, sig)
        .header("Content-Type", "application/json")
        .body(body)
        .send()
        .await
        .with_context(|| format!("POST to callback URL {:?} failed", url))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        return Err(anyhow!(
            "callback POST returned non-2xx status {}: {}",
            status,
            text
        ));
    }

    Ok(())
}

// ---------------------------------------------------------------------------
// Core processing logic
// ---------------------------------------------------------------------------

async fn process(
    cfg: &JobConfig,
    storage: &S3VideoStorage,
    probe: &FfprobeMediaProbe,
    transcode: &FfmpegMediaTranscode,
) -> anyhow::Result<ProcessingResult> {
    // Temp files in /tmp (always writable inside the container)
    let input_path = std::path::PathBuf::from(format!("/tmp/input_{}.mp4", cfg.video_id));
    let output_path = std::path::PathBuf::from(format!("/tmp/output_{}.mp4", cfg.video_id));

    // 1. Download source from R2
    info!(key = %cfg.source_key, "downloading source");
    storage
        .get_to_path(&cfg.source_key, &input_path)
        .await
        .with_context(|| format!("download source key {:?}", cfg.source_key))?;

    // 2. Probe input for duration (duration is unchanged by transcode)
    info!("probing input");
    let input_probe = probe.probe(&input_path).await.context("probe input")?;
    let duration_seconds = input_probe.duration_seconds as i64;

    // 3. Transcode to 720p H.264 MP4
    info!("transcoding");
    transcode
        .transcode_to_h264_mp4(&input_path, &output_path)
        .await
        .context("transcode")?;

    // 4. Probe output for final dimensions
    info!("probing output");
    let output_probe = probe.probe(&output_path).await.context("probe output")?;
    let width = output_probe
        .width
        .ok_or_else(|| anyhow!("output probe missing width"))?;
    let height = output_probe
        .height
        .ok_or_else(|| anyhow!("output probe missing height"))?;

    // 5. File size of output
    let bytes = std::fs::metadata(&output_path)
        .context("stat output file")?
        .len() as i64;

    // 6. Upload output to R2 with a fresh unique key
    let key = output_key(cfg.video_id);
    info!(key = %key, "uploading output");
    storage
        .put_file(&key, "video/mp4", &output_path)
        .await
        .context("upload output")?;

    // Clean up temp files (best-effort)
    let _ = tokio::fs::remove_file(&input_path).await;
    let _ = tokio::fs::remove_file(&output_path).await;

    Ok(ProcessingResult::Ready {
        storage_key: key,
        duration_seconds,
        width,
        height,
        bytes,
    })
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
        )
        .init();

    if let Err(e) = run().await {
        error!(error = %e, "video-worker failed");
        std::process::exit(1);
    }
}

async fn run() -> anyhow::Result<()> {
    let cfg = JobConfig::from_env().context("parsing job config from env")?;
    let s3_config = S3Config::from_env().context("parsing S3 config from env")?;
    let storage = S3VideoStorage::new(&s3_config);
    let probe = FfprobeMediaProbe::from_env();
    let transcode = FfmpegMediaTranscode::from_env();
    let http = reqwest::Client::new();

    info!(video_id = cfg.video_id, "starting video-worker");

    let result = match process(&cfg, &storage, &probe, &transcode).await {
        Ok(ready) => {
            info!("processing succeeded");
            ready
        }
        Err(err) => {
            error!(error = %err, "processing failed, reporting Failed to callback");
            let failed = ProcessingResult::Failed {
                error: format!("{:#}", err),
            };
            // Best-effort POST; if this also fails, log and exit nonzero.
            if let Err(post_err) = post_result(&http, &cfg.callback_url, &cfg.callback_secret, &failed).await {
                error!(error = %post_err, "failed to POST Failed result to callback");
            }
            std::process::exit(1);
        }
    };

    // POST the Ready result
    post_result(&http, &cfg.callback_url, &cfg.callback_secret, &result)
        .await
        .context("POST Ready result to callback")?;

    info!("video-worker complete");
    Ok(())
}

// ---------------------------------------------------------------------------
// Tests (pure helpers only — no I/O)
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::{JobConfig, output_key};

    #[test]
    fn job_config_from_env_reads_all_fields() {
        let get = |k: &str| match k {
            "VIDEO_ID" => Some("42".to_string()),
            "SOURCE_KEY" => Some("originals/42/abc.mp4".to_string()),
            "CALLBACK_URL" => Some("https://app.example/api/videos/42/processing-result".to_string()),
            "VIDEO_CALLBACK_SECRET" => Some("s3cr3t".to_string()),
            _ => None,
        };
        let cfg = JobConfig::from_getter(get).unwrap();
        assert_eq!(cfg.video_id, 42);
        assert_eq!(cfg.source_key, "originals/42/abc.mp4");
        assert_eq!(
            cfg.callback_url,
            "https://app.example/api/videos/42/processing-result"
        );
        assert_eq!(cfg.callback_secret, "s3cr3t");
    }

    #[test]
    fn job_config_missing_field_errors() {
        let get = |_: &str| None;
        assert!(JobConfig::from_getter(get).is_err());
    }

    #[test]
    fn output_key_is_unique_and_scoped() {
        let a = output_key(42);
        let b = output_key(42);
        assert!(a.starts_with("videos/42/") && a.ends_with(".mp4"));
        assert_ne!(a, b); // uuid
    }
}
