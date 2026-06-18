//! transcode-server — HTTP server that runs `video-worker` per request.
//!
//! Used in two modes controlled by `TRANSCODE_SERVER_ASYNC`:
//!
//! **Sync mode (default):**
//! `POST /jobs` parses `ProcessJob`, runs `video-worker` and awaits the child,
//! then responds 200 (exit 0) or 500 with captured stderr (nonzero exit).
//! Used by the Cloud Run service; the caller awaits the response and a non-2xx
//! is treated as a failure by the upstream processor.
//!
//! **Async mode (`TRANSCODE_SERVER_ASYNC=1` — used by the local dev mock):**
//! `POST /jobs` returns 202 immediately and spawns the child detached. This
//! replicates the original mock-transcoder behaviour so the app upload path
//! returns fast in development without a real Cloud Run / Cloudflare account.
//!
//! Port is controlled by `PORT` (default 8080). Dev compose sets `PORT=8765`
//! to preserve the existing dev URL (`http://mock-transcoder:8765/jobs`).
//!
//! **Auth:**
//! If `ENQUEUE_TOKEN` is set and non-empty, every `POST /jobs` must carry
//! `Authorization: Bearer <ENQUEUE_TOKEN>` (constant-time comparison via
//! the `subtle` crate). If the token is absent or wrong the request is
//! rejected with 401. If `ENQUEUE_TOKEN` is unset or empty, auth is skipped
//! with a one-time startup warning (dev/test convenience).
//!
//! NEVER use async mode or skip the token in production.

use std::process::Stdio;

use axum::{
    Router,
    body::Bytes,
    extract::State,
    http::{HeaderMap, StatusCode},
    response::IntoResponse,
    routing::post,
};
use subtle::ConstantTimeEq;
use tracing::{Instrument, error, info, warn};
use tracing_opentelemetry::OpenTelemetrySpanExt;
use video_job::ProcessJob;

#[path = "../telemetry.rs"]
mod telemetry;

// ---------------------------------------------------------------------------
// Server state
// ---------------------------------------------------------------------------

#[derive(Clone)]
struct ServerState {
    /// If true, spawn the child detached (async dev mode).
    /// If false (default), await the child and return real status.
    async_mode: bool,
    /// If non-empty, every POST /jobs must present `Authorization: Bearer <token>`.
    /// Empty means auth is disabled (dev convenience; logged at startup).
    enqueue_token: String,
}

// ---------------------------------------------------------------------------
// Bearer token helper
// ---------------------------------------------------------------------------

/// Returns `true` iff `header` is exactly `"Bearer <token>"`, using a
/// constant-time byte comparison to avoid timing side-channels.
///
/// `header` is the raw value of the `Authorization` header (or `None`).
/// `token` must be non-empty (callers should skip the check when empty).
pub fn check_bearer(header: Option<&str>, token: &str) -> bool {
    let expected = format!("Bearer {}", token);
    match header {
        None => false,
        Some(h) => {
            // Constant-time compare; lengths are compared first (fast path).
            // If lengths differ it still returns false in constant time for
            // the length check itself (no secret data exposed).
            h.as_bytes().ct_eq(expected.as_bytes()).into()
        }
    }
}

// ---------------------------------------------------------------------------
// HTTP handler — jobs are POSTed to /jobs (see the router in `main`).
// ---------------------------------------------------------------------------

async fn handle_job(
    State(state): State<ServerState>,
    headers: HeaderMap,
    body: Bytes,
) -> impl IntoResponse {
    // Auth check: verify bearer token if one is configured.
    if !state.enqueue_token.is_empty() {
        let auth_header = headers
            .get("authorization")
            .and_then(|v| v.to_str().ok());
        if !check_bearer(auth_header, &state.enqueue_token) {
            return StatusCode::UNAUTHORIZED.into_response();
        }
    }

    // Parse the job from the raw body bytes so we can return 400 on bad JSON.
    let job: ProcessJob = match serde_json::from_slice(&body) {
        Ok(j) => j,
        Err(e) => {
            error!(error = %e, "transcode-server: failed to parse ProcessJob body");
            return (StatusCode::BAD_REQUEST, format!("bad request: {e}")).into_response();
        }
    };

    info!(
        video_id = job.video_id,
        source_key = %job.source_key,
        callback_url = %job.callback_url,
        async_mode = state.async_mode,
        "transcode-server: received job"
    );

    // Collect S3 + secret vars from own environment so the worker
    // reads/writes the same bucket and signs with the same secret.
    let pass_through_vars: Vec<(&'static str, Option<String>)> = vec![
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

    // Validate required vars are present before accepting the job.
    let missing: Vec<&str> = pass_through_vars
        .iter()
        .filter(|(name, val)| {
            // S3_PUBLIC_ENDPOINT and RUST_LOG are optional.
            !matches!(*name, "S3_PUBLIC_ENDPOINT" | "RUST_LOG") && val.is_none()
        })
        .map(|(name, _)| *name)
        .collect();

    if !missing.is_empty() {
        error!(?missing, "transcode-server: required env vars missing; refusing job");
        return StatusCode::INTERNAL_SERVER_ERROR.into_response();
    }

    let video_id_str = job.video_id.to_string();

    // One relay span per job, parented to the backend's enqueue span. Inside
    // its context we mint the traceparent the child worker continues from, so
    // the worker's transcode_job span nests under this one (no gap).
    let span = tracing::info_span!("transcode_relay", video.id = job.video_id);
    span.set_parent(telemetry::parent_context(job.traceparent.as_deref()));

    async move {
        let relay_tp = telemetry::current_traceparent();
        if state.async_mode {
            // Async dev mode: spawn detached, return 202 immediately. The relay
            // span ends as soon as we return 202, so its duration is meaningless
            // here (the child outlives it). Dev-only; sync mode is the real path.
            tokio::spawn(async move {
                run_worker_fire_and_forget(
                    &video_id_str, &job, &pass_through_vars, relay_tp.as_deref(),
                ).await;
            });
            StatusCode::ACCEPTED.into_response()
        } else {
            // Sync mode (CF container): await the child, return real status.
            match run_worker_sync(
                &video_id_str, &job, &pass_through_vars, relay_tp.as_deref(),
            ).await {
                Ok(()) => StatusCode::OK.into_response(),
                Err(stderr) => {
                    // Mark the relay span failed so "failed relays" are queryable
                    // even though the child's own span also records the failure.
                    tracing::Span::current().set_attribute("error", true);
                    error!(
                        video_id = job.video_id,
                        stderr = %stderr,
                        "transcode-server: video-worker exited with error"
                    );
                    (StatusCode::INTERNAL_SERVER_ERROR, stderr).into_response()
                }
            }
        }
    }
    .instrument(span)
    .await
}

// ---------------------------------------------------------------------------
// Child process helpers
// ---------------------------------------------------------------------------

/// Await `video-worker`. Returns Ok(()) on exit code 0, Err(stderr) otherwise.
async fn run_worker_sync(
    video_id_str: &str,
    job: &ProcessJob,
    pass_through: &[(&'static str, Option<String>)],
    traceparent: Option<&str>,
) -> Result<(), String> {
    let mut cmd = build_command(video_id_str, job, pass_through, traceparent);
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());

    let child = match cmd.spawn() {
        Ok(c) => c,
        Err(e) => return Err(format!("failed to spawn video-worker: {e}")),
    };

    match child.wait_with_output().await {
        Err(e) => Err(format!("error waiting for video-worker: {e}")),
        Ok(output) => {
            let stdout = String::from_utf8_lossy(&output.stdout);
            let stderr = String::from_utf8_lossy(&output.stderr);
            if output.status.success() {
                info!(
                    video_id = job.video_id,
                    stdout = %stdout,
                    stderr = %stderr,
                    "transcode-server: video-worker completed successfully"
                );
                Ok(())
            } else {
                error!(
                    video_id = job.video_id,
                    exit_code = ?output.status.code(),
                    stdout = %stdout,
                    stderr = %stderr,
                    "transcode-server: video-worker exited with error"
                );
                Err(stderr.into_owned())
            }
        }
    }
}

/// Async dev mode: fire-and-forget (logs outcomes; does not surface errors).
async fn run_worker_fire_and_forget(
    video_id_str: &str,
    job: &ProcessJob,
    pass_through: &[(&'static str, Option<String>)],
    traceparent: Option<&str>,
) {
    let mut cmd = build_command(video_id_str, job, pass_through, traceparent);
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());

    match cmd.spawn() {
        Err(e) => {
            error!(video_id = job.video_id, error = %e, "transcode-server: failed to spawn video-worker");
        }
        Ok(child) => {
            match child.wait_with_output().await {
                Err(e) => {
                    error!(video_id = job.video_id, error = %e, "transcode-server: error waiting for video-worker");
                }
                Ok(output) => {
                    let stdout = String::from_utf8_lossy(&output.stdout);
                    let stderr = String::from_utf8_lossy(&output.stderr);
                    if output.status.success() {
                        info!(
                            video_id = job.video_id,
                            stdout = %stdout,
                            stderr = %stderr,
                            "transcode-server: video-worker completed successfully"
                        );
                    } else {
                        error!(
                            video_id = job.video_id,
                            exit_code = ?output.status.code(),
                            stdout = %stdout,
                            stderr = %stderr,
                            "transcode-server: video-worker exited with error"
                        );
                    }
                }
            }
        }
    }
}

/// Build the `tokio::process::Command` for `video-worker` with per-job and
/// pass-through env vars merged in.
fn build_command(
    video_id_str: &str,
    job: &ProcessJob,
    pass_through: &[(&'static str, Option<String>)],
    traceparent: Option<&str>,
) -> tokio::process::Command {
    let mut cmd = tokio::process::Command::new("/usr/local/bin/video-worker");

    // Per-job vars
    cmd.env("VIDEO_ID",     video_id_str);
    cmd.env("SOURCE_KEY",   &job.source_key);
    cmd.env("CALLBACK_URL", &job.callback_url);

    // Forward the relay span's trace context so the child video-worker nests
    // under transcode-server's span (and the backend enqueue span above it).
    if let Some(tp) = traceparent {
        cmd.env("TRACEPARENT", tp);
    }

    // Pass-through vars from the server's own env
    for (name, val) in pass_through {
        if let Some(v) = val {
            cmd.env(name, v);
        }
    }

    cmd
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
    // OTLP export enabled when OTEL_EXPORTER_OTLP_ENDPOINT is set (Cloud Run);
    // fmt-only locally. Returns the provider so we can flush on shutdown.
    let provider = telemetry::init();

    let async_mode = std::env::var("TRANSCODE_SERVER_ASYNC")
        .map(|v| v == "1")
        .unwrap_or(false);

    let port: u16 = std::env::var("PORT")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(8080);

    let enqueue_token = std::env::var("ENQUEUE_TOKEN").unwrap_or_default();
    if enqueue_token.is_empty() {
        warn!("transcode-server: ENQUEUE_TOKEN is not set; bearer auth is DISABLED (dev only)");
    }

    let state = ServerState { async_mode, enqueue_token };

    let mode_label = if async_mode { "async (dev)" } else { "sync (Cloud Run)" };
    info!(port, mode = mode_label, "transcode-server starting");

    let app = Router::new()
        .route("/jobs", post(handle_job))
        .route("/health", axum::routing::get(health))
        .with_state(state);

    let listener = tokio::net::TcpListener::bind(("0.0.0.0", port))
        .await
        .unwrap_or_else(|e| panic!("transcode-server: failed to bind on port {port}: {e}"));

    info!(port, "transcode-server listening");

    // Graceful shutdown on SIGTERM (Cloud Run sends it before SIGKILL) / Ctrl-C
    // so `serve` returns and we reach the flush below — otherwise buffered relay
    // spans would be dropped on every redeploy/scale-to-zero.
    if let Err(e) = axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await
    {
        warn!(error = %e, "transcode-server: server exited");
    }

    if let Some(provider) = provider {
        let _ = provider.force_flush();
        let _ = provider.shutdown();
    }
}

/// Resolves when the process receives SIGTERM (Cloud Run) or Ctrl-C, letting
/// axum drain in-flight requests before we flush telemetry and exit.
async fn shutdown_signal() {
    let ctrl_c = async {
        let _ = tokio::signal::ctrl_c().await;
    };

    #[cfg(unix)]
    let terminate = async {
        match tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate()) {
            Ok(mut sig) => {
                sig.recv().await;
            }
            Err(_) => std::future::pending::<()>().await,
        }
    };

    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        _ = ctrl_c => {},
        _ = terminate => {},
    }

    info!("transcode-server: shutdown signal received, draining");
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::check_bearer;

    #[test]
    fn check_bearer_accepts_correct_token() {
        assert!(check_bearer(Some("Bearer secret123"), "secret123"));
    }

    #[test]
    fn check_bearer_rejects_wrong_token() {
        assert!(!check_bearer(Some("Bearer wrongtoken"), "secret123"));
    }

    #[test]
    fn check_bearer_rejects_missing_header() {
        assert!(!check_bearer(None, "secret123"));
    }

    #[test]
    fn check_bearer_rejects_empty_header() {
        assert!(!check_bearer(Some(""), "secret123"));
    }

    #[test]
    fn check_bearer_rejects_bare_token_without_bearer_prefix() {
        assert!(!check_bearer(Some("secret123"), "secret123"));
    }

    #[test]
    fn check_bearer_rejects_wrong_scheme() {
        assert!(!check_bearer(Some("Basic secret123"), "secret123"));
    }

    #[test]
    fn check_bearer_rejects_extra_whitespace() {
        // Must match exactly — no leniency.
        assert!(!check_bearer(Some("Bearer  secret123"), "secret123"));
        assert!(!check_bearer(Some("Bearer secret123 "), "secret123"));
    }

    #[tokio::test]
    async fn build_command_sets_traceparent_env_from_arg() {
        use video_job::ProcessJob;
        let job = ProcessJob {
            video_id: 7,
            source_key: "originals/7/x.mp4".into(),
            callback_url: "https://app.example/cb".into(),
            traceparent: None, // ignored now; the arg wins
        };
        let cmd = super::build_command(
            "7",
            &job,
            &[],
            Some("00-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-bbbbbbbbbbbbbbbb-01"),
        );
        let tp = cmd
            .as_std()
            .get_envs()
            .find(|(k, _)| *k == std::ffi::OsStr::new("TRACEPARENT"))
            .and_then(|(_, v)| v)
            .map(|v| v.to_string_lossy().into_owned());
        assert_eq!(
            tp.as_deref(),
            Some("00-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-bbbbbbbbbbbbbbbb-01")
        );
    }
}
