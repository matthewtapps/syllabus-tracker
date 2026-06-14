# Pluggable Video Processing: Host ffmpeg + Cloudflare Containers

**Date:** 2026-06-14
**Status:** Draft for review
**Repos touched:** `syllabus-tracker` (this repo) and `../infra` (OpenTofu IaC).

## Problem

Transcoding runs inline on the web droplet (`s-1vcpu-1gb`), so a burst of
uploads pegs the single vCPU and starves the web server. A concurrency cap
(`VIDEO_TRANSCODE_CONCURRENCY=1`) stops the lock-up but the box is still a poor
place to transcode. We want to move transcoding **off the web host** onto
Cloudflare serverless compute (Containers + Queues), keep the existing
**on-host ffmpeg** path, and switch between them with a **runtime env var**.
Playback stays an R2 signed-URL `<video>` (single H.264 MP4); no HLS, no
semantic chapters (a separate future metadata feature).

## Goals

- A `VideoProcessor` seam with two impls, selected by `VIDEO_PROCESSOR=host|cloudflare`.
- Cloudflare path: original to R2 → our Worker enqueues → Queue → Container runs
  ffmpeg → output to R2 → authed webhook back to the app updates the row.
- All Cloudflare resources + credentials provisioned in `../infra`; the service
  consumes them as runtime env (existing runtime-secrets pattern).
- A docker-compose **mock transcoder** so the full async path runs locally
  against MinIO with no Cloudflare.
- Encoded video lives in **R2**; SQLite holds only row metadata.

## Architecture

```
Upload (coach)                         Cloudflare
   │  multipart                     ┌───────────────────────────────────────┐
   ▼                                │                                       │
syllabus-tracker (web droplet)      │  Worker (producer)  ── enqueue ──▶ Queue
   │ save original to local temp    │        ▲                             │
   │ VideoProcessor::start          │        │ POST /jobs {video_id,       │ consumer
   │   host:  inline ffmpeg ────────┼────────┘   source_key, callback}     ▼
   │   cloudflare:                  │                              Container (ffmpeg)
   │     PUT original ─────────────▶│ R2 (originals/…)  ◀── GET original ───┤
   │     POST /jobs ────────────────┘                                       │
   │                                   R2 (videos/…)   ◀── PUT output ──────┤
   │  status='processing'                                                   │
   ▼                                   POST /api/videos/{id}/processing-result (HMAC)
 SQLite  ◀───────────────────── apply_processing_result ◀────────────────────┘
   (status=ready, duration, w, h, bytes, storage_key)
```

The host path skips R2-for-originals and the Worker/Queue/Container/webhook
entirely: it transcodes the local temp file and calls the **same**
`apply_processing_result` internally. Both paths converge on one result-applier.

## Backend changes (syllabus-tracker)

### The seam

Replace the inline `process_uploaded_video` call with a `VideoProcessor` chosen
at startup:

```rust
#[async_trait]
pub trait VideoProcessor: Send + Sync {
    /// Begin making an uploaded original playable. Returns immediately; the
    /// video row stays `processing` until the result is applied (inline for
    /// host, via webhook for cloudflare).
    async fn start(&self, job: ProcessJob) -> Result<(), ProcessError>;
}

pub struct ProcessJob {
    pub video_id: i64,
    pub technique_id: i64,
    pub original_temp_path: PathBuf, // the saved upload
}
```

- `HostFfmpegProcessor` — wraps the current pipeline (probe → transcode under the
  `transcode_permits` semaphore → upload result to R2 → `apply_processing_result`).
  Unchanged behavior; this is the default.
- `CloudflareProcessor` — PUTs the original to `R2 originals/<video_id>/<uuid>`,
  then POSTs `{ video_id, source_key, callback_url }` to the Worker enqueue
  endpoint with a bearer token. Returns; completion arrives via webhook.

Selected in `main.rs` from `VIDEO_PROCESSOR` (default `host`).

### Shared result applier

Extract today's "mark ready + metadata" / "mark failed" DB writes into:

```rust
pub async fn apply_processing_result(pool, video_id, result: ProcessingResult)
// ProcessingResult::Ready { storage_key, duration_seconds, width, height, bytes }
// ProcessingResult::Failed { error }
```

Called by `HostFfmpegProcessor` on completion and by the webhook handler.

### New webhook endpoint

`POST /api/videos/<id>/processing-result` (only meaningful when
`VIDEO_PROCESSOR=cloudflare`):

- Auth: HMAC-SHA256 over the raw body with `VIDEO_CALLBACK_SECRET`, in an
  `X-Signature` header (constant-time compare). Reject otherwise.
- Body: `{ status: "ready"|"failed", storage_key, duration_seconds, width,
  height, bytes, error? }`.
- Idempotent: applying to an already-`ready` row is a no-op (handles Queue
  at-least-once redelivery).
- Validates the video exists and is `processing`.

### Startup reconcile (fixes today's zombie-rows gap)

On boot, `UPDATE videos SET processing_status='failed',
processing_error='interrupted' WHERE processing_status='processing'` for the
**host** path (an interrupted host transcode can never resume). For the
cloudflare path, leave them `processing` (the Queue job may still be in flight)
but expose them to a sweeper that fails rows stuck > N minutes.

### Config (env)

| Var | Meaning | Default |
| --- | --- | --- |
| `VIDEO_PROCESSOR` | `host` or `cloudflare` | `host` |
| `VIDEO_TRANSCODE_CONCURRENCY` | host-path semaphore | `1` |
| `VIDEO_ENQUEUE_URL` | Worker enqueue endpoint (cloudflare) | – |
| `VIDEO_ENQUEUE_TOKEN` | bearer for the Worker (cloudflare) | – |
| `VIDEO_CALLBACK_BASE_URL` | public app URL the container calls back | – |
| `VIDEO_CALLBACK_SECRET` | HMAC secret shared with the container | – |
| `R2_*` | already present; container reuses an R2 token | – |

## Cloudflare components

### Worker (producer + queue consumer)

One Worker script with two entry points:

- **HTTP `POST /jobs`**: auth bearer (`VIDEO_ENQUEUE_TOKEN`), validates body,
  `env.QUEUE.send({ video_id, source_key, callback_url })`. Returns 202.
- **Queue consumer**: on each message, start a **Container** instance to run the
  transcode, passing the job as env/args. On container success the container
  itself posts the webhook; on container failure (non-zero exit / timeout) the
  consumer posts a `failed` webhook so the row never hangs. Queue retries with a
  dead-letter queue after N attempts.

### Worker container: our own Rust crate

No off-the-shelf image fits. General ffmpeg images (`jrottenberg/ffmpeg`,
`linuxserver/ffmpeg`) are just the ffmpeg CLI, they don't pull/push R2 or post a
signed webhook, and Cloudflare has no managed transcode-in-container offering
(that's Stream, which we ruled out). The orchestration (R2 in, ffmpeg, R2 out,
HMAC callback) is ours, so we write a small Rust binary, packaged as the image
the Container runs. Writing it in Rust (not a bash+curl+aws-cli script) lets it
**reuse the app's existing code** instead of reimplementing R2 access, the ffmpeg
flags, and HMAC, keeping host and worker paths byte-identical.

### Crate structure (cargo workspace)

Refactor into a workspace so the app and the worker share code:

- **`crates/video-media`** (new, extracted from today's `videos/storage.rs` +
  `videos/media.rs`): the R2 S3 client (`S3VideoStorage`) and the ffmpeg
  probe/transcode (`FfmpegMediaTranscode`). One home for the transcode flags
  (incl. the 720p downscale below) so host and worker never diverge.
- **`crates/video-job`** (new): the job + result wire types
  (`ProcessJob`, `ProcessingResult`) and the HMAC sign/verify helpers. The single
  source of truth for the contract; depended on by the app (enqueue producer +
  webhook verify) and the worker (job parse + result sign).
- **`crates/video-worker`** (new): the container binary. Depends on
  `video-media` + `video-job`.
- **`crates/syllabus-tracker`** (existing app): depends on `video-media` +
  `video-job`; `HostFfmpegProcessor` and `CloudflareProcessor` both build on them.

Worker binary flow (`video-worker`):

1. Read job (`video_id`, `source_key`, `callback_url`) from env/args.
2. `GET` original from R2 (`source_key`) via `video-media`'s S3 client.
3. Probe (`video-media`) for duration/width/height; enforce the duration cap.
4. Transcode (`video-media`) → H.264 MP4, **capped to 720p** (filter below),
   `-threads` capped to the container's CPU.
5. `PUT` output to R2 at the playback `storage_key`.
6. `POST` `processing-result` (ready + metadata: duration, width, height after
   scaling, bytes, storage_key) to `callback_url`, HMAC-signed via `video-job`.
   On any failure, POST `failed { error }`.

Image: a minimal base with ffmpeg installed (Debian-slim + `ffmpeg`, or an
ffmpeg base) plus the statically-ish linked `video-worker` binary, built and
pushed by CI to a registry the Container service pulls from (registry choice is
an open question below).

### Downscale to 720p (shared, host + worker)

Cap resolution at 720p to save storage/bandwidth; never upscale; preserve aspect;
keep even dimensions. In `video-media`'s transcode, add to the existing flags:

```
-vf scale=w='if(gt(iw,ih),-2,min(720,iw))':h='if(gt(iw,ih),min(720,ih),-2)'
```

- Landscape (`iw>ih`): height ≤ 720, width auto-even. → 1280×720-class.
- Portrait (`iw≤ih`): width ≤ 720, height auto-even. → 720×1280-class.
- `min(720,…)` means already-small videos pass through untouched (no upscaling).

Full transcode command becomes:
`ffmpeg -i in -c:v libx264 -preset veryfast -crf 23 -vf "<scale above>" -c:a aac
-movflags +faststart out.mp4`. The probe step still records the **post-scale**
width/height for the row (read from the output, or computed from the filter).
This applies to both the host path and the worker, since both call `video-media`.

## Prerequisites: Cloudflare token scopes

The tofu Cloudflare provider authenticates with a single account API token,
`CLOUDFLARE_API_TOKEN` in `../infra/tofu/bootstrap.enc.env` (sops). Today it is
scoped to R2 + DNS + API-Tokens + Account only, which 403s on Workers/Queues/
Containers. The token (`tofu-platform-bootstrap` on the account API-tokens page)
was **edited in place** (2026-06-14) to add three Account-scoped groups; editing
keeps the token value unchanged, so **no sops/bootstrap edit and no re-mint** is
needed.

Added permission groups (Account-scoped, sillybus account):

- **Workers Scripts: Edit** — deploy the Worker (enqueue endpoint + queue consumer).
- **Queues: Edit** — create the Queue + dead-letter queue.
- **Workers Containers: Edit** — create/manage the ffmpeg Container app.

Not needed: **Workers Routes** (Zone-scoped). The enqueue Worker uses its default
`*.workers.dev` URL, so no zone route is required. Add it only if the Worker is
ever moved onto a `sillybus.app` hostname.

Validation is deferred to the first `tofu apply` of the new resources (a plan
can't exercise scopes with no resources yet). Safe because the app defaults to
`VIDEO_PROCESSOR=host`: a missing scope fails only the new CF resource apply, not
the running app.

## Infra (`../infra`) changes

Following the existing pattern (platform primitives + permission-group outputs;
service mints/consumes runtime tokens):

- **Cloudflare Queue** (`cloudflare_queue`) + dead-letter queue.
- **Cloudflare Worker** (script + queue consumer binding + Container binding +
  R2 binding + secrets: enqueue token, callback secret).
- **Cloudflare Container** app config (image ref, instance size, concurrency).
- **R2**: reuse `service_runtime_r2` token (already mints read+write); the
  container/Worker get an R2 binding or the same token. Add an `originals/`
  prefix convention (same bucket) or a dedicated originals bucket.
- **Secrets:** `VIDEO_ENQUEUE_TOKEN` and `VIDEO_CALLBACK_SECRET` generated in
  tofu (e.g. `random_password`), pushed to the Worker as secrets AND exported
  (sops-encrypted) for the service runtime env.
- **Outputs** consumed by the service: `video_enqueue_url`,
  `video_enqueue_token`, `video_callback_secret` (added to `outputs.tf`,
  delivered to the droplet via the existing runtime-secrets/sops flow).

The service repo's deploy wires these outputs into the app container's env
exactly like the existing `R2_*` / Honeycomb secrets.

## Local dev mock

A `mock-transcoder` service in `docker-compose` that stands in for
Worker+Queue+Container:

- HTTP `POST /jobs` (same contract as the Worker).
- On receipt: `GET` original from **MinIO** (the dev R2), run real `ffmpeg`,
  `PUT` output to MinIO, then `POST` the HMAC-signed `processing-result` to the
  app (`VIDEO_CALLBACK_BASE_URL` = the dev app).
- Dev env sets `VIDEO_PROCESSOR=cloudflare`, `VIDEO_ENQUEUE_URL=http://mock-transcoder/jobs`,
  shared `VIDEO_CALLBACK_SECRET`. This exercises the entire async path
  (enqueue → R2 round-trip → webhook → DB) without Cloudflare.

Default local dev stays `VIDEO_PROCESSOR=host` (no extra services); the mock is
opt-in via a compose profile.

## Testing

- Unit: processor selection from env; HMAC sign/verify (round-trip + tamper
  rejection); `apply_processing_result` (ready/failed/idempotent) — node-free
  Rust tests.
- Webhook handler: rejects bad signature, applies ready/failed, idempotent on
  redelivery, 404 unknown id.
- Dev e2e (manual / compose profile): upload with the mock, assert the row goes
  `processing → ready` and playback works against MinIO.
- Container image: a smoke test that transcodes a fixture and posts a result.

## Security / failure handling

- Webhook authenticated by HMAC; constant-time compare; reject large bodies.
- Validate `video_id` exists + is `processing`; ignore otherwise (no upsert).
- Queue at-least-once → idempotent apply; dead-letter + a stuck-row sweeper
  guarantee no permanent `processing` zombies.
- Container failure (crash/timeout) → consumer posts `failed`.
- Cost guard: keep the duration cap (5 min) enforced in the container too.

## Rollout

1. **Workspace refactor + seam.** Extract `video-media` + `video-job` crates;
   add the `VideoProcessor` seam + `HostFfmpegProcessor` (on `video-media`) +
   shared result applier + startup reconcile + the 720p downscale. Host-only,
   the only user-visible change is new uploads cap at 720p. Ship.
2. **Cloudflare processor + webhook** (this repo): `CloudflareProcessor` +
   HMAC `processing-result` endpoint + config. Still default host.
3. **Worker crate + image**: `video-worker` binary + container image + CI push.
4. **Infra** (`../infra`): Queue, Worker, Container, secrets, outputs.
5. **Dev mock**: `mock-transcoder` compose profile.
6. Flip **staging** to `VIDEO_PROCESSOR=cloudflare`, verify end-to-end; then
   **prod**. `host` remains the instant rollback.

## Non-goals

- HLS / adaptive bitrate.
- Semantic video segments/chapters (separate metadata feature; reuses the
  `video_ts_seconds` anchor model, not transcoding).
- Migrating playback off R2 signed URLs.

## Open questions / risks

- **Cloudflare Containers maturity / region**: confirm Containers GA limits
  (CPU/mem/timeout) fit a 5-min 1080p transcode; size the instance accordingly.
- **R2 access from the container**: binding vs token; one bucket with an
  `originals/` prefix vs a separate originals bucket (lifecycle-expire originals
  after success either way).
- **Egress/cost**: R2 has no egress fees; confirm Container + Queue pricing at
  expected volume vs an AWS Lambda alternative (same seam, different impl).
- **Container image registry**: where CI pushes the runner image and how the
  Container service authenticates to pull it.
