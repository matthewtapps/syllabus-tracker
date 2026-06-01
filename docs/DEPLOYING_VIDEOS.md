# Deploying the videos feature

The video upload/view feature is implemented but gated behind a runtime flag because the Cloudflare R2 bucket was not yet provisioned at the time of merge. This guide is the recipe for turning it on in production once the bucket exists.

## Current state

- `config/prod.env` sets `VIDEOS_ENABLED=false`. Production currently boots without constructing any S3 client, no video routes are mounted, the frontend's `/api/capabilities` returns `{ videos: false }`, and the UI hides all video surfaces.
- `config/dev.env` sets `VIDEOS_ENABLED=true` (against local MinIO). Local dev keeps working unchanged.
- `infra/terraform/` is ready to provision a Cloudflare R2 bucket but has not been applied.
- `.github/workflows/deploy.yaml` already surfaces the R2 credentials into `.secrets.env` (the `CLOUDFLARE_R2_ACCESS_KEY_ID` / `CLOUDFLARE_R2_SECRET_ACCESS_KEY` repository secrets must exist before the workflow runs the migration step).

Pushing to `main` right now is safe: the prod app will deploy with videos invisible. The cutover below is what turns them on.

## Cutover, end to end

### 1. Provision the R2 bucket (one-time)

You need a Cloudflare account. Generate an API token at https://dash.cloudflare.com/profile/api-tokens with the **Workers R2 Storage** policy (Read + Edit) scoped to the account.

```sh
export CLOUDFLARE_API_TOKEN=<your_token>

cd infra/terraform
terraform init
terraform plan
terraform apply
```

`terraform apply` creates `syllabus-tracker-videos-prod` in the `WEUR` location with a CORS rule for `https://syllabustracker.matthewtapps.com`. State is local for now; if you ever rotate machines move it to remote state first.

### 2. Generate the runtime S3 credentials

Now that the bucket exists, mint the S3-compatible credentials the app will use at runtime. These are *not* the same as the Cloudflare API token above.

1. Cloudflare dashboard > **R2 Object Storage** > **Manage R2 API Tokens** > **Create API Token**.
2. Permissions: **Object Read & Write**.
3. Specify bucket: **`syllabus-tracker-videos-prod`**.
4. Save the **Access Key ID** and **Secret Access Key** somewhere safe (you cannot retrieve the secret again later).

### 3. Store the S3 credentials in GitHub Actions

In the repo settings, **Settings > Secrets and variables > Actions**, add two repository secrets:

- `CLOUDFLARE_R2_ACCESS_KEY_ID`
- `CLOUDFLARE_R2_SECRET_ACCESS_KEY`

Keep them out of the Terraform variables file: those credentials are runtime config, not infra state.

### 4. Flip the feature flag

```diff
# config/prod.env
-VIDEOS_ENABLED=false
+VIDEOS_ENABLED=true
```

Leave the rest of the file alone. `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET` are already set for R2.

### 5. Push and watch the deploy

Commit step 4 and push to `main`. CI does the rest:

1. Build images
2. Push the new compose file and config
3. Write `.secrets.env`, including the S3 creds from the GitHub secrets
4. Dry-run migrate against a copy of the prod DB. This will also catch a misconfigured S3 setup early: with `VIDEOS_ENABLED=true` and missing S3 vars the app panics on boot with the explicit "S3 config missing" message.
5. Swap containers.

If the boot panics with the S3 config message, the previous container keeps running. Roll back by reverting the flag flip and re-deploying, then fix forward.

### 6. Smoke test

```sh
# Capabilities flipped:
curl -s https://syllabustracker.matthewtapps.com/api/capabilities
# Expect: {"videos":true}

# Health unchanged:
curl -s https://syllabustracker.matthewtapps.com/api/health
# Expect: OK
```

In the UI as a coach:

1. Open a technique detail page. The **Videos** section now renders, with **Add video**.
2. Upload a short mp4 (try a 10s test clip via `ffmpeg -f lavfi -i testsrc=duration=10:size=320x240:rate=30 -c:v libx264 /tmp/test.mp4`).
3. Wait for processing to flip to ready (a few seconds).
4. Click the row to expand and play. Confirm the video plays without "No video with supported format" errors (that indicates the presigned URL host is wrong).
5. Hit download. The browser saves an attachment.

In Honeycomb:

1. Spans now carry `feature.videos.enabled=true` as a resource attribute.
2. The `videos.upload` root span is present for each upload, with `videos.ffprobe`, `videos.transcode` (or skipped), `videos.s3_put`, `videos.db_finalize` children.
3. Gauges `video_storage_bytes_total`, `video_storage_objects_total`, `video_processing_jobs_active` start reporting from the sampler.

### 7. (Optional) Move Terraform state off your laptop

Once you trust the setup, point Terraform at a remote backend so the state survives laptop loss. R2 itself can host the state (a second bucket called `syllabus-tracker-tf-state`), or use Terraform Cloud's free tier. Initialise with `terraform init -migrate-state` after editing `versions.tf`.

## Removing the feature flag (one PR, when stable)

The flag is designed to be short-lived. Once production has been running cleanly for a couple of weeks, delete it:

1. Drop the `VIDEOS_ENABLED` line from `config/prod.env` and `config/dev.env`.
2. In `src/main.rs`: delete the `videos_enabled` read, construct `VideoStack` unconditionally, change `init_rocket` to take `VideoStack` instead of `Option<VideoStack>`, remove the `if let Some(stack) = video_stack` branch (its body becomes top-level), and re-merge the two `mount("/api", routes![...])` calls into one.
3. In `src/test/utils.rs`: drop the `Some(...)` wrap on the stack.
4. Frontend: remove `useCapabilities()` calls in the four gating sites and the four-line `videos` checks. Keep the `Capabilities` context, provider, and `/api/capabilities` endpoint, the next short-lived flag will reuse the same scaffolding.
5. Drop `feature.videos.enabled` from `src/telemetry.rs::resource()`.

Plan reference: `/home/matt/.claude/plans/jiggly-meandering-salamander.md` has the full design rationale if you need to revisit decisions.

## Troubleshooting

**App panics at startup with "VIDEOS_ENABLED=true but S3 config missing".**
The `CLOUDFLARE_R2_ACCESS_KEY_ID` / `CLOUDFLARE_R2_SECRET_ACCESS_KEY` repository secrets aren't set in GitHub Actions, so the deploy workflow wrote a `.secrets.env` without `S3_ACCESS_KEY` / `S3_SECRET_KEY`. SSH to the server and `cat /opt/syllabus-tracker/.secrets.env` to confirm.

**Upload returns 500, log says "presign error" or "put_object error".**
Either the bucket doesn't exist (Terraform not applied), the credentials are wrong, or the R2 token's bucket scope doesn't match `S3_BUCKET`. Test from your laptop:

```sh
export AWS_ACCESS_KEY_ID=<r2_access_key>
export AWS_SECRET_ACCESS_KEY=<r2_secret_key>
aws --endpoint-url https://ea9e8573831e597fc41f865267b8fd35.r2.cloudflarestorage.com \
    --region auto \
    s3 ls s3://syllabus-tracker-videos-prod/
```

**Browser shows "No video with supported format and MIME type found".**
The presigned URL embeds a host the browser can't reach. In production, `S3_ENDPOINT` and `S3_PUBLIC_ENDPOINT` should both be the R2 endpoint (no `S3_PUBLIC_ENDPOINT` override needed, the code falls back to `S3_ENDPOINT`). In dev with MinIO they differ on purpose; that split should not leak into prod.

**Watch stats look wrong.**
The `video_watch_aggregates` table is the read path. `SELECT * FROM video_watch_aggregates WHERE video_id = ?` on the server's sqlite tells you the current state. Each new `play_id` from the client increments `play_count`; same `play_id` is idempotent.

**Telemetry gauge values look stuck.**
The sampler runs every 5 minutes. Allow one cycle before declaring it broken.
