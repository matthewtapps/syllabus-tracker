# Telemetry cut-back + trace repair Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cut Honeycomb event volume (metrics + drop garbage logs), route stray metrics to real datasets, make the browser video-form submission the root of a single trace that reaches the GCP video worker, and get the worker exporting spans.

**Architecture:** Five workstreams across two repos. The `infra` repo owns the host otel-collector (metrics scrapers + journald logs). The `sillybus` repo owns the in-stack collector config, the frontend OTel SDK, the video-worker/transcode-server tracing, and the Cloud Run deploy workflow. Metrics fixes are pure config; trace fixes are code.

**Tech Stack:** OpenTelemetry Collector (contrib), NixOS module, OpenTelemetry JS web SDK, opentelemetry-rust 0.29 (OTLP/HTTP), Rocket, axum, Honeycomb (Metrics 2.0 enabled).

**Cross-repo note:** `infra` changes (Phase 1) ship as an `infra` PR; all `sillybus` changes (Phases 2-5) ship as one `sillybus` PR. Deploy infra first.

**Spec:** `docs/superpowers/specs/2026-06-18-telemetry-cutback-trace-repair-design.md`

---

## File map

| File | Repo | Responsibility | Phase |
| --- | --- | --- | --- |
| `nixos/modules/observability.nix` | infra | host collector: drop `processes` scraper, 60s interval, remove journald logs pipeline | 1 |
| `config/otel-collector-config.prod.yaml` | sillybus | in-stack collector: remove duplicate `host_metrics`, add nginx dataset header, fix comment | 2 |
| `frontend/src/lib/telemetry.ts` | sillybus | activate form-submit span as context so the upload fetch + backend nest under it | 3 |
| `frontend/src/components/traced-form.tsx` | sillybus | call the reworked form-span helper | 3 |
| `.github/workflows/deploy-video-worker.yaml` | sillybus | explicit `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` | 4 |
| `crates/video-worker/src/bin/transcode-server.rs` | sillybus | init OTel, relay span, forward relay traceparent to child | 5 |

---

## Phase 1 — Host collector (infra repo)

Work in the `infra` repo checkout (`~/dev/infra`). No unit tests for NixOS config; verified by `nix` build + staging deploy.

### Task 1: Drop `processes` scraper, raise interval to 60s

**Files:**
- Modify: `nixos/modules/observability.nix` (the `host_metrics` receiver block, ~lines 28-38)

- [ ] **Step 1: Edit the scrapers + interval**

Change the `host_metrics` receiver from:

```yaml
      host_metrics:
        collection_interval: 30s
        scrapers:
          cpu: {}
          memory: {}
          load: {}
          disk: {}
          filesystem: {}
          network: {}
          paging: {}
          processes: {}
```

to:

```yaml
      host_metrics:
        collection_interval: 60s
        scrapers:
          cpu: {}
          memory: {}
          load: {}
          disk: {}
          filesystem: {}
          network: {}
          paging: {}
```

(The `processes` scraper line is removed; interval 30s → 60s.)

- [ ] **Step 2: Commit**

```bash
git add nixos/modules/observability.nix
git commit -m "perf(observability): drop processes scraper, 60s host-metrics interval"
```

### Task 2: Remove the journald logs pipeline

**Files:**
- Modify: `nixos/modules/observability.nix` (the `journald` receiver ~lines 39-46 and the `logs` pipeline ~lines 89-92)

- [ ] **Step 1: Delete the `journald` receiver block**

Remove this entire receiver:

```yaml
      journald:
        units:
          - traefik.service
          - docker.service
          - runtime-secrets-decrypt.service
          - runtime-secrets-derive-key.service
          - sshd.service
          - platform-otelcol.service
```

- [ ] **Step 2: Delete the `logs` pipeline**

Remove from `service.pipelines`:

```yaml
        logs:
          receivers:  [journald]
          processors: [resource, batch]
          exporters:  [otlp_http/honeycomb]
```

- [ ] **Step 3: Verify the collector config still references only existing receivers/exporters**

The remaining pipelines are `metrics` (uses `host_metrics`) and `traces` (uses `otlp`). The `otlp` receiver and both exporters (`otlp_http/honeycomb`, `otlp_http/honeycomb-metrics`) are still referenced. The `journald` receiver is gone and no pipeline references it.

Run (from `~/dev/infra`), substituting the actual host attribute name:

```bash
nix eval --raw .#nixosConfigurations.<host>.config.services.platformObservability.enable
```

Expected: `true` (the module still evaluates; the inline YAML is a string so syntax is checked at runtime, not eval — see Step 4).

- [ ] **Step 4: Validate the rendered collector YAML**

Render the config string and parse it:

```bash
nix build .#nixosConfigurations.<host>.config.system.build.toplevel 2>&1 | tail -5
```

Expected: build succeeds. (The collector itself validates the config at service start; a malformed YAML would crash `platform-otelcol.service` on the box — caught at staging.)

- [ ] **Step 5: Commit**

```bash
git add nixos/modules/observability.nix
git commit -m "feat(observability): drop journald logs pipeline (kills unknown_log_source)"
```

---

## Phase 2 — In-stack collector (sillybus repo)

Work in `~/dev/sillybus`. Config-only; verified by YAML parse + staging.

### Task 3: Remove duplicate host_metrics; route nginx metrics; fix comment

**Files:**
- Modify: `config/otel-collector-config.prod.yaml`

- [ ] **Step 1: Remove the `host_metrics` receiver**

Delete this receiver block (~lines 11-17):

```yaml
  host_metrics:
    collection_interval: 60s
    scrapers:
      cpu:
      memory:
      load:
      disk:
```

- [ ] **Step 2: Drop `host_metrics` from the metrics pipeline**

Change the `metrics` pipeline receivers from:

```yaml
    metrics:
      receivers: [docker_stats, host_metrics, otlp]
      processors: [batch, resource]
      exporters: [otlp_http/metrics]
```

to:

```yaml
    metrics:
      receivers: [docker_stats, otlp]
      processors: [batch, resource]
      exporters: [otlp_http/metrics]
```

- [ ] **Step 3: Add the dataset header to the nginx metrics exporter + fix the comment**

Change the `otlp_http/metrics-nginx` exporter from:

```yaml
  otlp_http/metrics-nginx:
    endpoint: "https://api.honeycomb.io:443"
    headers:
      "x-honeycomb-team": "${HONEYCOMB_API_KEY}"
```

to:

```yaml
  # Metrics do NOT route by service.name (only traces do); without an explicit
  # dataset header these land in `unknown_metrics`. Route both nginx scrapes
  # (app + host) to one `nginx-metrics` dataset; the service.name column
  # distinguishes nginx-syllabus-tracker from nginx-do-host.
  otlp_http/metrics-nginx:
    endpoint: "https://api.honeycomb.io:443"
    headers:
      "x-honeycomb-team": "${HONEYCOMB_API_KEY}"
      "x-honeycomb-dataset": "nginx-metrics"
```

- [ ] **Step 4: Fix the now-wrong comments**

Update the comment above the `resource/nginx-app` processor (~lines 42-44) that claims metrics auto-route by service.name. Replace:

```yaml
  # The nginx receiver emits resourceless metrics; stamp service.name so
  # Honeycomb routes them to the right dataset (it auto-routes metrics
  # without an explicit dataset header by service.name).
```

with:

```yaml
  # The nginx receiver emits resourceless metrics; stamp service.name so the
  # nginx-metrics dataset has a column distinguishing app vs host nginx.
  # (Routing is via the exporter's x-honeycomb-dataset header, not service.name.)
```

Also update the exporters-block comment (~lines 109-114, 122-127) that says nginx metrics "use service.name routing (no header)" — that is now false; they use the `nginx-metrics` dataset header.

- [ ] **Step 5: Validate the YAML parses**

```bash
python3 -c "import yaml,sys; yaml.safe_load(open('config/otel-collector-config.prod.yaml')); print('OK')"
```

Expected: `OK`

- [ ] **Step 6: Confirm every metrics exporter has explicit dataset routing**

```bash
grep -n 'x-honeycomb-dataset' config/otel-collector-config.prod.yaml
```

Expected: both `otlp_http/metrics` (`syllabus-tracker-metrics`) and `otlp_http/metrics-nginx` (`nginx-metrics`) appear.

- [ ] **Step 7: Commit**

```bash
git add config/otel-collector-config.prod.yaml
git commit -m "fix(otel): dedupe host_metrics, route nginx metrics to nginx-metrics dataset"
```

---

## Phase 3 — Frontend form-submit = trace root (sillybus repo)

The current `recordFormSubmission` starts a span but never makes it active, so the upload `fetch` span opens under the root context, not the form span. Rework so the form span is the active context across the async submit.

### Task 4: Rework `recordFormSubmission` to run the submit inside the span's context

**Files:**
- Modify: `frontend/src/lib/telemetry.ts:146-159`
- Modify: `frontend/src/components/traced-form.tsx:17-41`
- Test: `frontend/src/lib/telemetry.test.ts` (new)

- [ ] **Step 1: Write the failing test**

Create `frontend/src/lib/telemetry.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { context, trace } from "@opentelemetry/api";
import { runInFormSpan } from "./telemetry";

describe("runInFormSpan", () => {
  it("makes the form span the active span while the callback runs", async () => {
    let activeName: string | undefined;
    await runInFormSpan(
      { formId: "upload-video", action: "/api/videos", method: "post" },
      async () => {
        const span = trace.getSpan(context.active());
        // OTel SpanContext has no name, but the active span must exist and be
        // recording — proving the callback runs *inside* the span's context.
        activeName = span && span.isRecording() ? "recording" : undefined;
      },
    );
    expect(activeName).toBe("recording");
  });

  it("returns the callback's resolved value", async () => {
    const out = await runInFormSpan(
      { formId: "f", action: "/api/x", method: "post" },
      async () => 42,
    );
    expect(out).toBe(42);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run src/lib/telemetry.test.ts`
Expected: FAIL — `runInFormSpan` is not exported.

(Note: per the repo's testing setup, `.test.tsx` files run in Chromium in CI only; this `.test.ts` exercises only `@opentelemetry/api` context logic and runs in node. If it cannot resolve the web SDK import chain locally, run it in CI via the PR — but the implementation below is what makes it pass.)

- [ ] **Step 3: Implement `runInFormSpan` and keep a thin `recordFormSubmission`**

In `frontend/src/lib/telemetry.ts`, replace `recordFormSubmission` (lines 146-159) with:

```ts
/**
 * Run a form's async submit handler *inside* a new span's active context, so
 * any fetch()/XHR the handler fires opens as a child span and propagates
 * `traceparent` to the backend. This makes the form submission the root of the
 * trace (browser → backend → video worker), not an orphan.
 */
export async function runInFormSpan<T>(
  meta: { formId: string; action: string; method: string },
  fn: () => Promise<T>,
): Promise<T> {
  const tracer = getTracer("recordFormSubmission");
  const span = tracer.startSpan(`form_submit_${meta.formId}`);
  span.setAttribute("form.id", meta.formId);
  span.setAttribute("form.action", meta.action);
  span.setAttribute("form.method", meta.method);
  span.setAttribute("session.id", getOrCreateSessionId());

  const ctx = trace.setSpan(context.active(), span);
  try {
    const result = await context.with(ctx, fn);
    span.addEvent("form_submit_success");
    span.setStatus({ code: SpanStatusCode.OK });
    return result;
  } catch (err) {
    span.addEvent("form_submit_error", {
      "error.message": err instanceof Error ? err.message : String(err),
    });
    span.setStatus({
      code: SpanStatusCode.ERROR,
      message: err instanceof Error ? err.message : String(err),
    });
    span.recordException(err as Error);
    throw err;
  } finally {
    span.end();
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run src/lib/telemetry.test.ts`
Expected: PASS (both tests).

- [ ] **Step 5: Switch `TracedForm` to `runInFormSpan`**

In `frontend/src/components/traced-form.tsx`, replace the import and `handleSubmit` body (lines 2, 17-41):

Import line:

```ts
import { runInFormSpan } from '@/lib/telemetry';
```

`handleSubmit`:

```ts
  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isSubmitting) return;
    setIsSubmitting(true);

    const form = event.currentTarget;
    try {
      await runInFormSpan(
        {
          formId: form.id || 'unnamed-form',
          action: form.action || window.location.href,
          method: form.method || 'get',
        },
        () => Promise.resolve(onSubmit(event)),
      );
    } finally {
      setIsSubmitting(false);
    }
  };
```

- [ ] **Step 6: Run the typecheck + lint**

Run: `pnpm tsc --noEmit && pnpm eslint src/lib/telemetry.ts src/components/traced-form.tsx`
Expected: no errors. (`recordFormSubmission` is removed; confirm no other importer — the earlier grep showed only `traced-form.tsx` used it.)

- [ ] **Step 7: Confirm no stale importers of the removed function**

```bash
grep -rn 'recordFormSubmission' frontend/src
```

Expected: no matches.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/lib/telemetry.ts frontend/src/lib/telemetry.test.ts frontend/src/components/traced-form.tsx
git commit -m "fix(telemetry): run form submit inside its span so it roots the trace"
```

---

## Phase 4 — GCP worker export endpoint (sillybus repo)

The worker already flushes (`crates/video-worker/src/main.rs:182-187`), so the missing dataset is an export-path failure. The prime suspect is the base-endpoint path-append ambiguity: `OTEL_EXPORTER_OTLP_ENDPOINT=https://api.honeycomb.io` may POST to the root instead of `/v1/traces`. Set the signal-specific endpoint (used verbatim) to remove the ambiguity.

### Task 5: Set explicit traces endpoint in the deploy workflow

**Files:**
- Modify: `.github/workflows/deploy-video-worker.yaml:155-168` (the `--set-env-vars` block)

- [ ] **Step 1: Add the traces endpoint env var**

In the `--set-env-vars=^@^...` block, after the `OTEL_EXPORTER_OTLP_ENDPOINT` line (line 165), add:

```yaml
          @OTEL_EXPORTER_OTLP_TRACES_ENDPOINT=https://api.honeycomb.io/v1/traces\
```

So the OTEL section reads:

```yaml
          @OTEL_EXPORTER_OTLP_ENDPOINT=https://api.honeycomb.io\
          @OTEL_EXPORTER_OTLP_TRACES_ENDPOINT=https://api.honeycomb.io/v1/traces\
          @OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf\
          @OTEL_EXPORTER_OTLP_HEADERS=x-honeycomb-team=${{ steps.secrets.outputs.honeycomb_key }}\
          @OTEL_RESOURCE_ATTRIBUTES=deployment.environment.name=production"
```

- [ ] **Step 2: Validate the workflow YAML parses**

```bash
python3 -c "import yaml; yaml.safe_load(open('.github/workflows/deploy-video-worker.yaml')); print('OK')"
```

Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/deploy-video-worker.yaml
git commit -m "fix(video-worker): set explicit OTLP traces endpoint for Cloud Run export"
```

- [ ] **Step 4: Post-deploy verification (manual, after staging/prod deploy)**

Run:

```bash
gcloud logging read 'resource.type="cloud_run_revision" resource.labels.service_name="transcode-server"' \
  --project=matthewtapps-sillybus --limit=120 --freshness=1d --format='value(textPayload)'
```

Expected: no OTLP `404`/`401` export errors. If a `401` appears, the header env is not being honoured — add the contingency in Task 6 Step 4. Then confirm in Honeycomb (`sillybus` env) that the `syllabus-tracker-video-worker` dataset now has `transcode_job` spans.

---

## Phase 5 — transcode-server relay span (sillybus repo)

`transcode-server` currently inits only a fmt logger and relays the inbound `traceparent` straight to the child, emitting no span of its own. Init OTel and emit one relay span per job so the backend→worker waterfall has no gap, forwarding the relay span's context (not the raw inbound traceparent) to the child.

### Task 6: Share the telemetry module, init OTel, emit relay span

**Files:**
- Modify: `crates/video-worker/src/bin/transcode-server.rs`
- Test: same file, `#[cfg(test)] mod tests`

- [ ] **Step 1: Write a failing test for traceparent threading in `build_command`**

The current `build_command` reads `job.traceparent`. The relay refactor threads an explicit `traceparent: Option<&str>` argument instead. Add this test to the existing `mod tests` (the test references the new signature, so it fails to compile first):

```rust
    #[tokio::test]
    async fn build_command_sets_traceparent_env_from_arg() {
        use video_job::ProcessJob;
        let job = ProcessJob {
            video_id: 7,
            source_key: "originals/7/x.mp4".into(),
            callback_url: "https://app.example/cb".into(),
            traceparent: None, // ignored now; arg wins
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
```

(If `ProcessJob` has more fields, fill them from `video_job`'s definition — check `crates/video-job/src/lib.rs` and match its struct exactly.)

- [ ] **Step 2: Run it to verify it fails**

Run: `cargo test -p video-worker --bin transcode-server build_command_sets_traceparent_env_from_arg`
Expected: FAIL — `build_command` takes 3 args, not 4 (compile error).

- [ ] **Step 3: Change `build_command` to take an explicit traceparent**

Replace `build_command` (signature + the traceparent block, ~lines 260-286):

```rust
fn build_command(
    video_id_str: &str,
    job: &ProcessJob,
    pass_through: &[(&'static str, Option<String>)],
    traceparent: Option<&str>,
) -> tokio::process::Command {
    let mut cmd = tokio::process::Command::new("/usr/local/bin/video-worker");

    cmd.env("VIDEO_ID",     video_id_str);
    cmd.env("SOURCE_KEY",   &job.source_key);
    cmd.env("CALLBACK_URL", &job.callback_url);

    // Forward the relay span's trace context so the child video-worker nests
    // under transcode-server's span (and the backend enqueue span above it).
    if let Some(tp) = traceparent {
        cmd.env("TRACEPARENT", tp);
    }

    for (name, val) in pass_through {
        if let Some(v) = val {
            cmd.env(name, v);
        }
    }

    cmd
}
```

- [ ] **Step 4: Thread `traceparent` through the worker runners**

Update both runner signatures and their `build_command` calls:

`run_worker_sync` (line 173) — add the parameter and pass it:

```rust
async fn run_worker_sync(
    video_id_str: &str,
    job: &ProcessJob,
    pass_through: &[(&'static str, Option<String>)],
    traceparent: Option<&str>,
) -> Result<(), String> {
    let mut cmd = build_command(video_id_str, job, pass_through, traceparent);
```

`run_worker_fire_and_forget` (line 215) — same:

```rust
async fn run_worker_fire_and_forget(
    video_id_str: &str,
    job: &ProcessJob,
    pass_through: &[(&'static str, Option<String>)],
    traceparent: Option<&str>,
) {
    let mut cmd = build_command(video_id_str, job, pass_through, traceparent);
```

- [ ] **Step 5: Share the telemetry module + emit the relay span in `handle_job`**

At the top of `transcode-server.rs`, after the `use` block, include the worker's telemetry module:

```rust
#[path = "../telemetry.rs"]
mod telemetry;

use tracing::Instrument;
use tracing_opentelemetry::OpenTelemetrySpanExt;
```

Replace the `state.async_mode` dispatch in `handle_job` (lines 146-165) with a relay-span-wrapped version. The span is parented to the inbound `job.traceparent`; inside its context we derive the relay traceparent to hand the child:

```rust
    let video_id_str = job.video_id.to_string();

    // One relay span per job, parented to the backend's enqueue span. Inside
    // its context we mint the traceparent the child worker continues from, so
    // the worker's transcode_job span nests under this one (no gap).
    let span = tracing::info_span!("transcode_relay", video.id = job.video_id);
    span.set_parent(telemetry::parent_context(job.traceparent.as_deref()));

    async move {
        let relay_tp = telemetry::current_traceparent();
        if state.async_mode {
            tokio::spawn(async move {
                run_worker_fire_and_forget(
                    &video_id_str, &job, &pass_through_vars, relay_tp.as_deref(),
                ).await;
            });
            StatusCode::ACCEPTED.into_response()
        } else {
            match run_worker_sync(
                &video_id_str, &job, &pass_through_vars, relay_tp.as_deref(),
            ).await {
                Ok(()) => StatusCode::OK.into_response(),
                Err(stderr) => {
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
```

(Note: the `tokio::spawn` in async mode detaches from the span; that path is dev-only, so the relay traceparent is captured before spawn and passed by value — acceptable.)

- [ ] **Step 6: Init OTel in `main` and flush on shutdown**

Replace the fmt-only init in `main` (lines 302-307) and add flush after `serve` returns (line 339-341):

```rust
    // OTLP export enabled when OTEL_EXPORTER_OTLP_ENDPOINT is set (Cloud Run);
    // fmt-only locally. Returns the provider so we can flush on shutdown.
    let provider = telemetry::init();
```

And after the `axum::serve(...)` block:

```rust
    if let Err(e) = axum::serve(listener, app).await {
        warn!(error = %e, "transcode-server: server exited");
    }

    if let Some(provider) = provider {
        let _ = provider.force_flush();
        let _ = provider.shutdown();
    }
```

- [ ] **Step 7: Run the build_command test + full crate tests**

Run: `cargo test -p video-worker`
Expected: PASS — including `build_command_sets_traceparent_env_from_arg` and the existing `check_bearer` / `JobConfig` tests.

- [ ] **Step 8: Clippy + build both bins**

Run: `cargo clippy -p video-worker --bins -- -D warnings`
Expected: clean. (Confirms `telemetry.rs` compiles as a module of both bins and the `#[path]` include resolves.)

- [ ] **Step 9: Commit**

```bash
git add crates/video-worker/src/bin/transcode-server.rs
git commit -m "feat(video-worker): emit transcode-server relay span, forward its context to child"
```

---

## Final verification (after both PRs deploy to staging)

- [ ] In a browser on staging, submit the video upload form. In Honeycomb (`sillybus` env), find the trace: root span is `form_submit_<id>` (service.name `syllabus-tracker-frontend`), then backend request, `remote_video_enqueue`, `transcode_relay`, `transcode_job` — one trace_id end to end.
- [ ] `unknown_log_source` ingest = 0; `unknown_metrics` = 0; `nginx-metrics` dataset populated.
- [ ] `platform-host-metrics` and `syllabus-tracker-metrics` event counts materially lower (no per-process timeseries, no duplicated host metrics).
- [ ] `gcloud logging read` for `transcode-server` shows no OTLP export errors.

---

## Self-review notes

- **Spec coverage:** WS1 metrics → Tasks 1+3; WS2 logs → Task 2; WS3 unknown_metrics → Task 3; WS4 form root → Task 4; WS5 GCP worker → Tasks 5+6. All covered.
- **Flush:** spec said "verify worker flushes" — confirmed already present in `main.rs:182-187`, so no worker-main task; flush IS added to transcode-server (Task 6 Step 6), which previously had none.
- **Header contingency:** if `gcloud` logs show 401, the `OTEL_EXPORTER_OTLP_HEADERS` env is not honoured by the 0.29 HTTP exporter — fix is to set the `x-honeycomb-team` header explicitly in `telemetry::init()`'s exporter builder. Tracked in Task 5 Step 4.
- **`ProcessJob` fields:** Task 6 Step 1 test must match the real struct in `crates/video-job/src/lib.rs`; verify before writing.
