use std::path::Path;
use std::sync::Arc;

use async_trait::async_trait;
use serde::Deserialize;
use thiserror::Error;
use tokio::process::Command;
use tracing::instrument;

pub type DynMediaProbe = Arc<dyn MediaProbe + Send + Sync>;
pub type DynMediaTranscode = Arc<dyn MediaTranscode + Send + Sync>;

#[derive(Debug, Error)]
pub enum MediaError {
    #[error("ffprobe failed: {0}")]
    Probe(String),
    #[error("ffmpeg failed: {0}")]
    Transcode(String),
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
    #[error("parse error: {0}")]
    Parse(String),
}

#[derive(Debug, Clone)]
pub struct ProbeResult {
    pub duration_seconds: f64,
    pub video_codec: Option<String>,
    pub container: Option<String>,
    pub width: Option<i64>,
    pub height: Option<i64>,
}

impl ProbeResult {
    pub fn is_h264_mp4(&self) -> bool {
        let codec_ok = self.video_codec.as_deref() == Some("h264");
        let container_ok = self
            .container
            .as_deref()
            .map(|c| c.split(',').any(|f| f.trim() == "mp4"))
            .unwrap_or(false);
        codec_ok && container_ok
    }
}

#[async_trait]
pub trait MediaProbe {
    async fn probe(&self, source: &Path) -> Result<ProbeResult, MediaError>;
}

#[async_trait]
pub trait MediaTranscode {
    async fn transcode_to_h264_mp4(
        &self,
        source: &Path,
        destination: &Path,
    ) -> Result<(), MediaError>;
}

pub struct FfprobeMediaProbe {
    pub binary: String,
}

impl FfprobeMediaProbe {
    pub fn from_env() -> Self {
        Self {
            binary: dotenvy::var("FFPROBE_BIN").unwrap_or_else(|_| "ffprobe".to_string()),
        }
    }
}

#[derive(Debug, Deserialize)]
struct FfprobeOutput {
    format: Option<FfprobeFormat>,
    streams: Option<Vec<FfprobeStream>>,
}

#[derive(Debug, Deserialize)]
struct FfprobeFormat {
    duration: Option<String>,
    format_name: Option<String>,
}

#[derive(Debug, Deserialize)]
struct FfprobeStream {
    codec_type: Option<String>,
    codec_name: Option<String>,
    width: Option<i64>,
    height: Option<i64>,
}

#[async_trait]
impl MediaProbe for FfprobeMediaProbe {
    #[instrument(skip(self, source), fields(source = %source.display()))]
    async fn probe(&self, source: &Path) -> Result<ProbeResult, MediaError> {
        let output = Command::new(&self.binary)
            .args([
                "-v",
                "error",
                "-print_format",
                "json",
                "-show_format",
                "-show_streams",
            ])
            .arg(source)
            .output()
            .await?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr).to_string();
            return Err(MediaError::Probe(stderr));
        }

        let parsed: FfprobeOutput = serde_json::from_slice(&output.stdout)
            .map_err(|e| MediaError::Parse(e.to_string()))?;

        let format = parsed.format.ok_or_else(|| {
            MediaError::Parse("ffprobe response missing format section".to_string())
        })?;

        let duration: f64 = format
            .duration
            .as_deref()
            .and_then(|s| s.parse().ok())
            .ok_or_else(|| MediaError::Parse("missing or invalid duration".to_string()))?;

        let mut video_codec = None;
        let mut width = None;
        let mut height = None;
        for stream in parsed.streams.unwrap_or_default() {
            if stream.codec_type.as_deref() == Some("video") {
                video_codec = stream.codec_name;
                width = stream.width;
                height = stream.height;
                break;
            }
        }

        Ok(ProbeResult {
            duration_seconds: duration,
            video_codec,
            container: format.format_name,
            width,
            height,
        })
    }
}

pub struct FfmpegMediaTranscode {
    pub binary: String,
}

impl FfmpegMediaTranscode {
    pub fn from_env() -> Self {
        Self {
            binary: dotenvy::var("FFMPEG_BIN").unwrap_or_else(|_| "ffmpeg".to_string()),
        }
    }
}

#[async_trait]
impl MediaTranscode for FfmpegMediaTranscode {
    #[instrument(skip(self, source, destination), fields(
        source = %source.display(),
        destination = %destination.display(),
    ))]
    async fn transcode_to_h264_mp4(
        &self,
        source: &Path,
        destination: &Path,
    ) -> Result<(), MediaError> {
        let output = Command::new(&self.binary)
            .args([
                "-y",
                "-loglevel",
                "error",
                "-i",
            ])
            .arg(source)
            .args([
                "-c:v",
                "libx264",
                "-preset",
                "veryfast",
                "-crf",
                "23",
                "-c:a",
                "aac",
                "-movflags",
                "+faststart",
            ])
            .arg(destination)
            .output()
            .await?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr).to_string();
            return Err(MediaError::Transcode(stderr));
        }
        Ok(())
    }
}

#[cfg(test)]
pub mod test_support {
    use std::path::Path;

    use async_trait::async_trait;

    use super::{MediaError, MediaProbe, MediaTranscode, ProbeResult};

    pub struct FakeMediaProbe {
        pub result: ProbeResult,
    }

    impl FakeMediaProbe {
        pub fn ok_h264(duration_seconds: f64) -> Self {
            Self {
                result: ProbeResult {
                    duration_seconds,
                    video_codec: Some("h264".to_string()),
                    container: Some("mov,mp4,m4a,3gp,3g2,mj2".to_string()),
                    width: Some(320),
                    height: Some(240),
                },
            }
        }

        pub fn ok_hevc(duration_seconds: f64) -> Self {
            Self {
                result: ProbeResult {
                    duration_seconds,
                    video_codec: Some("hevc".to_string()),
                    container: Some("mov,mp4,m4a,3gp,3g2,mj2".to_string()),
                    width: Some(320),
                    height: Some(240),
                },
            }
        }
    }

    #[async_trait]
    impl MediaProbe for FakeMediaProbe {
        async fn probe(&self, _source: &Path) -> Result<ProbeResult, MediaError> {
            Ok(self.result.clone())
        }
    }

    pub struct FakeMediaTranscode;

    #[async_trait]
    impl MediaTranscode for FakeMediaTranscode {
        async fn transcode_to_h264_mp4(
            &self,
            source: &Path,
            destination: &Path,
        ) -> Result<(), MediaError> {
            tokio::fs::copy(source, destination).await?;
            Ok(())
        }
    }
}
