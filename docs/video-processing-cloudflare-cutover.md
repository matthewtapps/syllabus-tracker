# Cloudflare video-processing: staging cutover runbook

Status as of this branch (`roadmap/threads-08-video-processing`, PR #62):

**Done + verified**
- Code: `video-media`/`video-job`/`video-worker` crates, `VideoProcessor` seam (host + cloudflare), HMAC webhook, sweeper, 720p cap. (Phases 1-3, merged-ready.)
- Local validation: the `video-cloud` docker-compose profile (`mock-transcoder`) exercises the whole enqueue -> worker -> signed-webhook -> `ready` path against MinIO. `docker compose --profile video-cloud up`, app set to `VIDEO_PROCESSOR=cloudflare`.
- Platform infra APPLIED (live, in `../infra`, commit `e2171f6`, **not yet pushed/PR'd**): Cloudflare Queue `sillybus-video-jobs` + DLQ `sillybus-video-jobs-dlq`, and two `random_password` secrets exported as tofu outputs `video_enqueue_token` / `video_callback_secret`.
- Service wiring committed: service tofu re-exports `_platform_video_*`; `staging.yml` ships `VIDEO_ENQUEUE_TOKEN`/`VIDEO_CALLBACK_SECRET` in the runtime-secrets bundle and the staging override sets `VIDEO_PROCESSOR` (default `host`), `VIDEO_ENQUEUE_URL`, `VIDEO_CALLBACK_BASE_URL`.
- Edge layer authored: `crates/video-worker/edge/` (wrangler.jsonc + `src/index.ts`: `POST /jobs` producer + queue consumer + `VideoContainer` DO class); the container runs `transcode-server` (sync). `.github/workflows/deploy-video-worker.yaml` (workflow_dispatch-only until wired).

**Prod is untouched and stays so.** Everything below targets staging only.

---

## Remaining live steps (gated — require Cloudflare account mutations)

### 1. (Recommended) Mint a scoped wrangler-deploy token in platform tofu
Avoid putting the broad account `CLOUDFLARE_API_TOKEN` in GitHub. Add a `cloudflare_account_token` in `../infra/tofu` scoped to Workers Scripts + Queues + Workers Containers + R2 (Edit), export it, re-export in service tofu, and have `deploy-video-worker.yaml` read it via `tofu output -raw` (reusing the `PLATFORM_STATE_R2_*` bootstrap creds) like the honeycomb/R2 secrets. Until then, a local `wrangler deploy` with the bootstrap token works for the first cutover.

### 2. Deploy the Worker + Container (first time)
The image is built by wrangler and pushed to Cloudflare's own registry (ghcr is not supported by CF Containers).

```bash
cd crates/video-worker/edge
npm ci
export CLOUDFLARE_ACCOUNT_ID=ea9e8573831e597fc41f865267b8fd35
# bootstrap token (Workers/Queues/Containers scopes added 2026-06-14):
export CLOUDFLARE_API_TOKEN=$(SOPS_AGE_KEY_FILE=/dev/shm/sops-age-key-$(id -u) \
  sops -d /home/matt/dev/infra/tofu/bootstrap.enc.env | sed -n 's/^CLOUDFLARE_API_TOKEN=//p')
npx wrangler deploy            # builds image, pushes to CF registry, deploys Worker+Container+queue bindings
```
Note the deployed Worker URL (e.g. `https://sillybus-video-worker.<subdomain>.workers.dev`).

Set the Worker's secrets (values from platform tofu + the R2 runtime token):
```bash
cd ../../../../infra
ENQ=$(nix develop --command just tf output -raw video_enqueue_token)
CB=$(nix develop --command just tf output -raw video_callback_secret)
R2_ID=$(nix develop --command just tf output -json cf_runtime_r2_tokens | jq -r .sillybus.access_key_id)
R2_SECRET=$(nix develop --command just tf output -json cf_runtime_r2_tokens | jq -r .sillybus.secret_access_key)
cd ../syllabus-tracker/crates/video-worker/edge
printf '%s' "$ENQ"       | npx wrangler secret put ENQUEUE_TOKEN
printf '%s' "$CB"        | npx wrangler secret put VIDEO_CALLBACK_SECRET
printf '%s' "$R2_ID"     | npx wrangler secret put S3_ACCESS_KEY
printf '%s' "$R2_SECRET" | npx wrangler secret put S3_SECRET_KEY
printf '%s' "https://ea9e8573831e597fc41f865267b8fd35.r2.cloudflarestorage.com" | npx wrangler secret put S3_ENDPOINT
printf '%s' "auto"                  | npx wrangler secret put S3_REGION
printf '%s' "sillybus-videos-prod"  | npx wrangler secret put S3_BUCKET
printf '%s' "true"                  | npx wrangler secret put S3_FORCE_PATH_STYLE
printf '%s' "https://ea9e8573831e597fc41f865267b8fd35.r2.cloudflarestorage.com" | npx wrangler secret put S3_PUBLIC_ENDPOINT
```
(`S3_FORCE_PATH_STYLE=true` mirrors `config/common.env`. `S3_PUBLIC_ENDPOINT` = the R2 S3 endpoint, matching how the app presigns when no separate public endpoint is set.)

### 3. Point staging at the Worker + cut over
```bash
gh variable set VIDEO_ENQUEUE_URL       -b "https://sillybus-video-worker.<subdomain>.workers.dev/jobs" -R matthewtapps/syllabus-tracker
gh variable set VIDEO_PROCESSOR_STAGING -b "cloudflare" -R matthewtapps/syllabus-tracker
gh workflow run staging.yml -f branch=roadmap/threads-08-video-processing -f refresh_db=false -f allow_destructive_migrations=false
```

### 4. Validate on staging
- Upload a video at https://staging.sillybus.app. Expect the row `processing -> ready` and playback to work (object served from R2).
- Watch the CF queue + DLQ (Cloudflare dash > Workers > Queues) and the app's stuck-row sweeper (no rows stuck `processing` past `VIDEO_PROCESSING_TIMEOUT_SECONDS`).
- Confirm the web droplet CPU stays low during the upload (the original goal — transcoding is off-host).

### 5. Roll back (if needed)
`gh variable set VIDEO_PROCESSOR_STAGING -b "host"` then re-run staging.yml. Host transcoding resumes instantly.

---

## Loose ends
- `../infra` commit `e2171f6` (queue + secrets) is applied live but **not pushed** — open a PR for it (direct main push is blocked by policy).
- `deploy-video-worker.yaml` is `workflow_dispatch`-only and references GH-secret placeholders; prefer reworking it to the tofu-output pattern (step 1) before re-enabling the push trigger.
- Prod cutover is intentionally NOT covered here; it is a separate, explicit future step.
