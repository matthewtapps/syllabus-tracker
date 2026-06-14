# Pluggable Video Processing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move video transcoding off the web droplet onto Cloudflare Containers, behind a `VideoProcessor` seam with a retained on-host path, switchable at runtime via `VIDEO_PROCESSOR`. Cap output at 720p. Encoded video in R2, metadata in SQLite.

**Architecture:** Cargo workspace with shared `video-media` (R2 + ffmpeg) and `video-job` (job/result contract + HMAC) crates consumed by both the app and a new `video-worker` container binary. App enqueues via a Cloudflare Worker → Queue → Container; the container transcodes and posts an HMAC-signed result webhook. Infra in `../infra` (OpenTofu). Local dev mocks the whole async path with a compose `mock-transcoder`.

**Tech Stack:** Rust (axum/rocket app, aws-sdk-s3 for R2, tokio), Cloudflare Workers/Queues/Containers, OpenTofu, Docker Compose + MinIO (dev), ffmpeg.

**Reference spec:** `docs/superpowers/specs/2026-06-14-cloudflare-video-processing.md`. Read it first.

**Branch:** new branch off `main` (separate epic from the vidstack work).

**Cross-cutting rules:**
- Backend tests: `nix develop .#ci --command cargo nextest run -p <crate>`. After any `sqlx::query!` change, `nix develop .#ci --command just sqlx-prepare` and commit `.sqlx/` in the same commit. Never bare `cargo sqlx prepare`.
- Frontend gate (if touched): `pnpm run build && pnpm run lint && pnpm vitest run --project node`.
- Commit after each task. Conventional Commits, imperative, scoped, NO `Co-Authored-By`.

---

## Phase 1 — Workspace refactor + seam + 720p (host-only, shippable)

### Task 1: Carve out the `video-media` crate

**Files:**
- Create: `crates/video-media/Cargo.toml`, `crates/video-media/src/lib.rs`
- Move: `crates/syllabus-tracker/src/videos/storage.rs` → `crates/video-media/src/storage.rs`
- Move: `crates/syllabus-tracker/src/videos/media.rs` → `crates/video-media/src/media.rs`
- Modify: root `Cargo.toml` (workspace members), `crates/syllabus-tracker/Cargo.toml` (dep), `crates/syllabus-tracker/src/videos/mod.rs` (re-export from the crate)

- [ ] **Step 1: Add the crate to the workspace**

Root `Cargo.toml` `[workspace] members` += `"crates/video-media"`. New `crates/video-media/Cargo.toml` with the deps `storage.rs`/`media.rs` use today (`aws-config`, `aws-sdk-s3`, `aws-credential-types`, `async-trait`, `thiserror`, `tokio`, `tracing`). Keep `default-features=false` + the same feature flags as the app uses for `aws-sdk-s3` (`rt-tokio`, `behavior-version-latest`, `rustls`).

- [ ] **Step 2: Move the two modules verbatim**

`git mv` storage.rs + media.rs into `crates/video-media/src/`. `lib.rs`:
```rust
pub mod media;
pub mod storage;
```
Keep the `#[cfg(any(test, feature = "test-support"))]` `test_support` modules; expose a `test-support` feature in `Cargo.toml` mirroring the app's.

- [ ] **Step 3: Re-point the app**

`crates/syllabus-tracker/Cargo.toml`: add `video-media = { path = "../video-media" }`. In `crates/syllabus-tracker/src/videos/mod.rs`, replace `mod storage; mod media;` with `pub use video_media::{media, storage};` (or re-export the specific items already used: `DynVideoStorage`, `S3Config`, `S3VideoStorage`, `DynMediaProbe`, `DynMediaTranscode`, `FfmpegMediaProbe`, `FfmpegMediaTranscode`, `MediaError`, `ProbeResult`, `StorageError`). Fix imports across `videos/pipeline.rs`, `videos/routes.rs`, `main.rs`.

- [ ] **Step 4: Build + test**

Run: `nix develop .#ci --command cargo build` then `cargo nextest run -p syllabus-tracker`
Expected: green (pure move; no behavior change). The existing `videos::storage`/`media` tests now run from `video-media` (or via re-export); ensure they still execute.

- [ ] **Step 5: Commit**
```bash
git commit -m "refactor(videos): Extract video-media crate (R2 + ffmpeg)"
```

### Task 2: Add the 720p downscale to `video-media`

**Files:** Modify `crates/video-media/src/media.rs`, `crates/video-media/src/media.rs` tests.

- [ ] **Step 1: Write the failing test** (pure helper for the scale filter)

In `media.rs`, add a `fn scale_filter() -> &'static str` and a unit test asserting the exact string:
```rust
#[test]
fn scale_filter_caps_720_both_orientations() {
    assert_eq!(
        scale_filter(),
        "scale=w='if(gt(iw,ih),-2,min(720,iw))':h='if(gt(iw,ih),min(720,ih),-2)'"
    );
}
```

- [ ] **Step 2: Run it, expect fail** (function not defined).

- [ ] **Step 3: Implement** `scale_filter()` returning that constant, and inject `-vf <scale_filter()>` into the existing `transcode_to_h264_mp4` args (between `-crf 23` and `-c:a`). Keep `veryfast`/`crf 23`/`+faststart`.

- [ ] **Step 4: Run tests, expect pass.**

- [ ] **Step 5: Commit**
```bash
git commit -m "feat(video-media): Cap transcode output at 720p (never upscale)"
```
Note: this changes host-path output for new uploads (smaller files). Intended.

### Task 3: Add the `video-job` crate (contract + HMAC)

**Files:** Create `crates/video-job/{Cargo.toml,src/lib.rs}`; root `Cargo.toml` member; app dep.

- [ ] **Step 1: Write failing HMAC round-trip + tamper tests**

`crates/video-job/src/lib.rs` tests:
```rust
#[test] fn sign_verify_roundtrip() {
    let body = br#"{"status":"ready"}"#;
    let sig = sign(b"secret", body);
    assert!(verify(b"secret", body, &sig));
}
#[test] fn verify_rejects_tampered_body() {
    let sig = sign(b"secret", b"a");
    assert!(!verify(b"secret", b"b", &sig));
}
#[test] fn verify_rejects_wrong_secret() {
    let sig = sign(b"secret", b"a");
    assert!(!verify(b"other", b"a", &sig));
}
```

- [ ] **Step 2: Run, expect fail.**

- [ ] **Step 3: Implement.** Deps: `hmac`, `sha2`, `subtle` (constant-time), `serde`/`serde_json`. Types:
```rust
#[derive(Serialize, Deserialize)] pub struct ProcessJob {
    pub video_id: i64, pub source_key: String, pub callback_url: String,
}
#[derive(Serialize, Deserialize)] #[serde(tag = "status", rename_all = "snake_case")]
pub enum ProcessingResult {
    Ready { storage_key: String, duration_seconds: i64, width: i64, height: i64, bytes: i64 },
    Failed { error: String },
}
pub fn sign(secret: &[u8], body: &[u8]) -> String  // hex(HMAC-SHA256)
pub fn verify(secret: &[u8], body: &[u8], sig_hex: &str) -> bool // constant-time
```

- [ ] **Step 4: Run, expect pass.**

- [ ] **Step 5: Commit**
```bash
git commit -m "feat(video-job): Add job/result contract + HMAC sign/verify"
```

### Task 4: `VideoProcessor` seam + `HostFfmpegProcessor` + shared result applier

**Files:**
- Modify: `crates/syllabus-tracker/src/videos/pipeline.rs` (extract `apply_processing_result`), `videos/routes.rs` (use the processor), `videos/mod.rs`, `main.rs`.
- Create: `crates/syllabus-tracker/src/videos/processor.rs`.

- [ ] **Step 1: Extract `apply_processing_result`** in `pipeline.rs`:
```rust
pub async fn apply_processing_result(pool: &SqlitePool, video_id: i64, r: ProcessingResult)
  -> Result<(), AppError>
```
`Ready` → today's `finalize_video_ready`; `Failed` → `mark_video_failed`. Make idempotent: no-op if the row is already `ready`.

- [ ] **Step 2: Define the trait + host impl** in `processor.rs`:
```rust
#[async_trait] pub trait VideoProcessor: Send + Sync {
    async fn start(&self, job: HostJob) -> ();   // spawns; completion internal
}
pub struct HostJob { pub video_id: i64, pub technique_id: i64, pub original_temp_path: PathBuf }
pub struct HostFfmpegProcessor { ctx: Arc<PipelineContext> }
```
`start` = today's `tokio::spawn(process_uploaded_video(...))` (semaphore-capped transcode → `apply_processing_result`). Behaviorally identical to today.

- [ ] **Step 3: Wire selection in `main.rs`** from `VIDEO_PROCESSOR` (default `host`):
```rust
let processor: Arc<dyn VideoProcessor> = match std::env::var("VIDEO_PROCESSOR").as_deref() {
    Ok("cloudflare") => Arc::new(CloudflareProcessor::from_env(pool.clone())?), // Phase 2
    _ => Arc::new(HostFfmpegProcessor::new(pipeline_ctx.clone())),
};
```
Manage it as Rocket `State`. `routes.rs` upload handlers call `processor.start(...)` instead of spawning the pipeline directly.

- [ ] **Step 4: Tests** — `apply_processing_result` idempotency + ready/failed (DB test, `nix develop .#ci --command cargo nextest run -p syllabus-tracker apply_processing_result`). Regenerate `.sqlx` if queries changed.

- [ ] **Step 5: Commit**
```bash
git commit -m "feat(videos): VideoProcessor seam + host impl + shared result applier"
```

### Task 5: Startup reconcile for zombie `processing` rows

**Files:** `crates/syllabus-tracker/src/db/videos.rs` (query), `main.rs` (call on boot).

- [ ] **Step 1: Failing test** — seed a `processing` row, run `reconcile_interrupted_processing(pool)`, assert it's now `failed` with a message. (`db/videos.rs` test.)
- [ ] **Step 2: Run, expect fail.**
- [ ] **Step 3: Implement** `UPDATE videos SET processing_status='failed', processing_error='interrupted by restart', updated_at=CURRENT_TIMESTAMP WHERE processing_status='processing'`. Call once at startup **only when `VIDEO_PROCESSOR=host`** (cloudflare jobs may still be in flight — Phase 2 adds a time-based sweeper instead).
- [ ] **Step 4: Run tests + `just sqlx-prepare`; commit `.sqlx` together.**
- [ ] **Step 5: Commit**
```bash
git commit -m "fix(videos): Fail interrupted processing rows on host startup"
```

**Phase 1 ships here. `VIDEO_PROCESSOR` defaults host; only visible change = 720p cap + no more zombie rows.**

---

## Phase 2 — Cloudflare processor + webhook (still default host)

### Task 6: `CloudflareProcessor`

**Files:** `crates/syllabus-tracker/src/videos/processor.rs`; `Cargo.toml` (`reqwest`, `uuid` if absent); config.

- [ ] **Step 1:** `CloudflareProcessor::from_env(pool)` reads `VIDEO_ENQUEUE_URL`, `VIDEO_ENQUEUE_TOKEN`, `VIDEO_CALLBACK_BASE_URL`, plus an `S3Config`/storage handle for the originals PUT.
- [ ] **Step 2:** `start(job)`:
  1. PUT original (`original_temp_path`) to R2 at `originals/<video_id>/<uuid>` via `video-media` storage.
  2. POST `video_job::ProcessJob { video_id, source_key, callback_url: format!("{base}/api/videos/{id}/processing-result") }` to `VIDEO_ENQUEUE_URL` with `Authorization: Bearer <token>`.
  3. On enqueue failure → `apply_processing_result(Failed)` so the row doesn't hang.
- [ ] **Step 3: Test** the URL/payload construction as a pure helper (`build_enqueue_request(job, cfg) -> (url, headers, body)`), unit-tested without network.
- [ ] **Step 4: Commit**
```bash
git commit -m "feat(videos): CloudflareProcessor (R2 upload + Worker enqueue)"
```

### Task 7: `processing-result` webhook endpoint

**Files:** `crates/syllabus-tracker/src/videos/routes.rs`; route registration; tests in `src/test/videos.rs`.

- [ ] **Step 1: Failing tests** (`src/test/videos.rs`, using the existing test harness + `InMemoryVideoStorage`):
  - valid HMAC + `ready` → row becomes `ready` with metadata.
  - bad signature → 401, row unchanged.
  - `failed` payload → row `failed`.
  - redelivery (apply twice) → idempotent, 200 both.
  - unknown id → 404.
- [ ] **Step 2: Run, expect fail.**
- [ ] **Step 3: Implement** `POST /api/videos/<id>/processing-result`: read raw body, `video_job::verify(secret, &body, header)` (constant-time), parse `ProcessingResult`, call `apply_processing_result`. Secret from `VIDEO_CALLBACK_SECRET`. Reject bodies over a small cap. **No auth-guard** (it's machine-to-machine, HMAC is the auth) — register outside the user auth fairing.
- [ ] **Step 4: Run tests, expect pass.** Add the time-based sweeper (fail cloudflare rows stuck `processing` > N min) as a periodic task; gate startup reconcile to host only.
- [ ] **Step 5: Commit**
```bash
git commit -m "feat(videos): HMAC processing-result webhook + stuck-row sweeper"
```

---

## Phase 3 — `video-worker` crate + container image

### Task 8: `video-worker` binary

**Files:** Create `crates/video-worker/{Cargo.toml,src/main.rs}`; root workspace member.

- [ ] **Step 1:** Deps: `video-media`, `video-job`, `tokio`, `reqwest`, `anyhow`, `tracing`. Reads `VIDEO_ID`, `SOURCE_KEY`, `CALLBACK_URL`, `VIDEO_CALLBACK_SECRET`, `R2_*`, `S3_BUCKET` from env.
- [ ] **Step 2:** `main`:
  1. Build `S3VideoStorage` from env (reuse `video-media`).
  2. GET `source_key` → temp file.
  3. `probe` → duration/width/height; enforce duration cap.
  4. `transcode_to_h264_mp4` (720p via `video-media`) → temp out.
  5. PUT to `videos/<technique_or_video>/<uuid>.mp4` (mirror the host key scheme; pass technique id in the job or derive a stable key).
  6. POST `ProcessingResult::Ready{..}` (post-scale w/h, bytes) to `CALLBACK_URL`, signed with `video_job::sign`. Any error → POST `Failed{error}`, exit non-zero.
- [ ] **Step 3: Test** the env-parse + key-build helpers (unit). End-to-end is covered by the dev mock (Task 12) + a container smoke test.
- [ ] **Step 4: Commit**
```bash
git commit -m "feat(video-worker): R2 in -> ffmpeg 720p -> R2 out -> signed webhook"
```

### Task 9: Container image + CI build

**Files:** Create `crates/video-worker/Dockerfile`; CI workflow `.github/workflows/build-video-worker.yaml`.

- [ ] **Step 1:** Multi-stage Dockerfile: build `video-worker` (rust:slim or the repo's nix build), runtime = `debian:bookworm-slim` + `ffmpeg`, copy the binary, `ENTRYPOINT ["video-worker"]`.
- [ ] **Step 2:** CI workflow builds + pushes to the chosen registry (resolve the open question; default: `ghcr.io/matthewtapps/video-worker`, tagged by SHA). Mirror the existing image-build workflow patterns.
- [ ] **Step 3: Local smoke test** — `docker build`, run against a local fixture + MinIO, assert it writes output + would POST a result (point `CALLBACK_URL` at a local echo).
- [ ] **Step 4: Commit**
```bash
git commit -m "build(video-worker): Container image + CI publish"
```

---

## Phase 4 — Infra (`../infra`)

### Task 10: Cloudflare Queue + Worker + Container + secrets + outputs

**Files (in `../infra/tofu`):** new `cloudflare_video_processing.tf`; additions to `outputs.tf`; worker script under `../infra/...`.

- [ ] **Step 1:** `cloudflare_queue` `sillybus-video-jobs` + dead-letter `sillybus-video-jobs-dlq`.
- [ ] **Step 2:** Worker (script + bindings): Queue producer + consumer, Container binding, R2 binding (reuse `service_runtime_r2`), secrets `VIDEO_ENQUEUE_TOKEN` + `VIDEO_CALLBACK_SECRET` (tofu `random_password`).
- [ ] **Step 3:** Container app config (image ref from Task 9, instance size sufficient for a 5-min 720p transcode, concurrency).
- [ ] **Step 4:** `outputs.tf`: `video_enqueue_url`, `video_enqueue_token` (sensitive), `video_callback_secret` (sensitive). Confirm token scopes already added (Queues/Workers Scripts/Workers Containers — done 2026-06-14).
- [ ] **Step 5:** `nix develop --command just tf plan` → review; `apply`. Validates the new token scopes for real.
- [ ] **Step 6: Commit** (in infra repo)
```bash
git commit -m "feat(video): Cloudflare Queue + Worker + Container for transcoding"
```

### Task 11: Service consumes infra outputs

**Files:** `.github/workflows/staging.yml` + `deploy.yaml` (inject `VIDEO_*` from tofu outputs into runtime-secrets, like Honeycomb); `config/common.env` (`VIDEO_PROCESSOR=host` default, documented `cloudflare` switch).

- [ ] **Step 1:** In the "Build runtime-secrets" step, `tofu output -raw video_enqueue_url/token/callback_secret` → add `VIDEO_ENQUEUE_URL/TOKEN`, `VIDEO_CALLBACK_SECRET`, `VIDEO_CALLBACK_BASE_URL` (the sibling/prod public URL) to the shipped env. Mask them.
- [ ] **Step 2: Commit**
```bash
git commit -m "ci(video): Wire Cloudflare processing secrets into deploys"
```

---

## Phase 5 — Local dev mock

### Task 12: `mock-transcoder` compose service

**Files:** `crates/video-worker` reused (or a tiny mock binary); `docker-compose.yml` (dev) `mock-transcoder` under a `video-cloud` profile; dev `.env` overrides.

- [ ] **Step 1:** Add a `mock-transcoder` service: an HTTP server exposing `POST /jobs` with the same contract as the Worker; on receipt it runs the real `video-worker` flow against **MinIO** and posts the signed result to the dev app. Simplest: a thin wrapper that shells the `video-worker` binary with the job env.
- [ ] **Step 2:** Dev env (opt-in profile): `VIDEO_PROCESSOR=cloudflare`, `VIDEO_ENQUEUE_URL=http://mock-transcoder:8080/jobs`, shared `VIDEO_CALLBACK_SECRET`, `VIDEO_CALLBACK_BASE_URL=http://app:<port>`. Default dev stays `host`.
- [ ] **Step 3: Manual e2e** — `docker compose --profile video-cloud up`, upload a video, assert row `processing → ready` and playback works from MinIO.
- [ ] **Step 4: Commit**
```bash
git commit -m "feat(dev): mock-transcoder compose service for the cloudflare path"
```

---

## Phase 6 — Cutover

### Task 13: Staging → cloudflare, then prod

- [ ] **Step 1:** Set `VIDEO_PROCESSOR=cloudflare` for staging; deploy; upload tests → verify enqueue → container → webhook → `ready` + playback. Watch the DLQ + sweeper.
- [ ] **Step 2:** Soak; confirm CPU on the web droplet stays low during uploads (the original goal).
- [ ] **Step 3:** Flip prod `VIDEO_PROCESSOR=cloudflare`. `host` is the instant rollback (env flip + redeploy).
- [ ] **Step 4:** Once stable, raise `VIDEO_TRANSCODE_CONCURRENCY` is moot (host unused); optionally shrink the droplet.

---

## Self-review checklist (run before executing)
- Every `sqlx::query!` change pairs with a committed `.sqlx` regen.
- `VIDEO_PROCESSOR` defaults `host` at every phase; cloudflare is opt-in until Task 13.
- The HMAC secret + enqueue token never get logged; CI masks them.
- `video-media` is the only place ffmpeg flags (incl. 720p) live; host + worker both use it.
- Originals in R2 get a lifecycle expiry (set in Task 10) so they don't accumulate.
