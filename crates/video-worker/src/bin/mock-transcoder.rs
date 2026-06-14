//! mock-transcoder — local dev stand-in for Worker+Queue+Container.
//!
//! Accepts the same `POST /jobs` body that `CloudflareProcessor` sends, spawns
//! the real `video-worker` binary with per-job env vars set, and returns 202
//! immediately so the app can continue. This lets the cloudflare code path be
//! exercised end-to-end on the dev machine with MinIO, without a real
//! Cloudflare account.
//!
//! NEVER use this in production.

use std::process::Stdio;

use axum::{Router, extract::Json, http::StatusCode, routing::post};
use tracing::{error, info, warn};
use video_job::ProcessJob;

// ---------------------------------------------------------------------------
// HTTP handler
// ---------------------------------------------------------------------------

async fn handle_job(Json(job): Json<ProcessJob>) -> StatusCode {
    info!(
        video_id = job.video_id,
        source_key = %job.source_key,
        callback_url = %job.callback_url,
        "mock-transcoder: received job, spawning video-worker"
    );

    // Collect S3 + secret vars from own environment so the worker
    // reads/writes the same MinIO bucket and signs with the same secret.
    let pass_through_vars: Vec<(&str, Option<String>)> = vec![
        ("VIDEO_CALLBACK_SECRET", std::env::var("VIDEO_CALLBACK_SECRET").ok()),
        ("S3_ENDPOINT",          std::env::var("S3_ENDPOINT").ok()),
        ("S3_REGION",            std::env::var("S3_REGION").ok()),
        ("S3_BUCKET",            std::env::var("S3_BUCKET").ok()),
        ("S3_ACCESS_KEY",        std::env::var("S3_ACCESS_KEY").ok()),
        ("S3_SECRET_KEY",        std::env::var("S3_SECRET_KEY").ok()),
        ("S3_FORCE_PATH_STYLE",  std::env::var("S3_FORCE_PATH_STYLE").ok()),
        ("S3_PUBLIC_ENDPOINT",   std::env::var("S3_PUBLIC_ENDPOINT").ok()),
        ("RUST_LOG",             std::env::var("RUST_LOG").ok()),
    ];

    // Validate that the required vars are present before accepting the job.
    let missing: Vec<&str> = pass_through_vars
        .iter()
        .filter(|(name, val)| {
            // S3_PUBLIC_ENDPOINT and RUST_LOG are optional.
            !matches!(*name, "S3_PUBLIC_ENDPOINT" | "RUST_LOG") && val.is_none()
        })
        .map(|(name, _)| *name)
        .collect();

    if !missing.is_empty() {
        error!(?missing, "mock-transcoder: required env vars missing; refusing job");
        return StatusCode::INTERNAL_SERVER_ERROR;
    }

    // Spawn asynchronously — we've already validated; any runtime errors are
    // logged by the child process.
    let video_id_str = job.video_id.to_string();
    tokio::spawn(async move {
        let mut cmd = tokio::process::Command::new("/usr/local/bin/video-worker");

        // Per-job vars
        cmd.env("VIDEO_ID",      &video_id_str);
        cmd.env("SOURCE_KEY",    &job.source_key);
        cmd.env("CALLBACK_URL",  &job.callback_url);

        // Pass-through vars
        for (name, val) in &pass_through_vars {
            if let Some(v) = val {
                cmd.env(name, v);
            }
        }

        cmd.stdout(Stdio::piped());
        cmd.stderr(Stdio::piped());

        match cmd.spawn() {
            Err(e) => {
                error!(video_id = job.video_id, error = %e, "mock-transcoder: failed to spawn video-worker");
            }
            Ok(child) => {
                match child.wait_with_output().await {
                    Err(e) => {
                        error!(video_id = job.video_id, error = %e, "mock-transcoder: error waiting for video-worker");
                    }
                    Ok(output) => {
                        let stdout = String::from_utf8_lossy(&output.stdout);
                        let stderr = String::from_utf8_lossy(&output.stderr);
                        if output.status.success() {
                            info!(
                                video_id = job.video_id,
                                stdout = %stdout,
                                stderr = %stderr,
                                "mock-transcoder: video-worker completed successfully"
                            );
                        } else {
                            error!(
                                video_id = job.video_id,
                                exit_code = ?output.status.code(),
                                stdout = %stdout,
                                stderr = %stderr,
                                "mock-transcoder: video-worker exited with error"
                            );
                        }
                    }
                }
            }
        }
    });

    StatusCode::ACCEPTED
}

// ---------------------------------------------------------------------------
// Health check
// ---------------------------------------------------------------------------

async fn health() -> StatusCode {
    StatusCode::OK
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

    let port: u16 = std::env::var("MOCK_TRANSCODER_PORT")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(8765);

    let app = Router::new()
        .route("/jobs", post(handle_job))
        .route("/health", axum::routing::get(health));

    let listener = tokio::net::TcpListener::bind(("0.0.0.0", port))
        .await
        .unwrap_or_else(|e| panic!("mock-transcoder: failed to bind on port {port}: {e}"));

    info!(port, "mock-transcoder listening");

    if let Err(e) = axum::serve(listener, app).await {
        warn!(error = %e, "mock-transcoder: server exited");
    }
}
