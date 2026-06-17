# Telemetry cut-back + trace repair — design

Date: 2026-06-18
Branch: `feat/telemetry-uplift-again`
Related prior work: end-to-end telemetry uplift (`docs honeycomb-telemetry.md` in
infra; the wide-events overhaul shipped 2026-06-16).

## Problem

Honeycomb ingest is ~20k log/metric events per 30 min across four datasets,
most of it low-value, plus broken traces:

| Dataset | ~events / 30 min | Diagnosis |
| --- | --- | --- |
| `unknown_log_source` | 6.9k | journald host logs with no `service.name` and no dataset header → Honeycomb dumps them in `unknown_log_source`. Unfiltered traefik/docker/sshd/runtime-secrets/otelcol unit logs. |
| `platform-host-metrics` | 7.3k | Host collector (`observability.nix`) scrapes 8 scrapers every 30s. The `processes` scraper emits one timeseries set per process = the bulk. |
| `syllabus-tracker-metrics` | 5.7k | In-stack collector still runs `host_metrics` + `docker_stats` (duplicating the host collector's VM metrics) plus backend OTLP metrics. |
| `unknown_metrics` | 600 | nginx metrics (`service.name=nginx-syllabus-tracker`, `nginx-do-host`) exported with no `x-honeycomb-dataset` header. Honeycomb does **not** route metrics by `service.name` (only traces), so they land in `unknown_metrics`. |

Trace problems:

- **Frontend form span is an orphan.** `recordFormSubmission`
  (`frontend/src/lib/telemetry.ts`) starts a span but never makes it the active
  context, so the upload `fetch` auto-instrumentation span opens under the root
  context instead of under the form span. The form span sits in its own trace
  and never propagates to the backend.
- **Video processor (GCP) emits zero spans.** No `syllabus-tracker-video-worker`
  dataset exists in the `sillybus` env. The deployed key
  (`_platform_honeycomb_backend_ingest`, the `sillybus-backend` ingest key) has
  `create_datasets = true` (`infra/tofu/credentials_honeycomb.tf:80`), so a
  successful export would auto-create the dataset. Absence of the dataset means
  **no span ever reached Honeycomb** — an export-path failure, not a permission
  problem.
- **transcode-server has no span of its own**, so even once the worker exports
  there is a visual gap between the backend enqueue span and the worker span.

## Goals

- Cut metric event volume significantly (moderate approach: dedupe + drop the
  largest cardinality source, keep useful signal).
- Eliminate `unknown_log_source` and `unknown_metrics`.
- Adapt metrics so they pack efficiently into Honeycomb native metrics
  (Metrics 2.0, already enabled on the env).
- Make the browser video-form submission the **root span** of one trace that
  reaches the GCP video worker.
- Get the GCP video worker exporting spans into the trace.

## Non-goals

- Refinery / tail-sampling tuning beyond what already exists.
- Migrating the legacy `syllabus-tracker` Honeycomb env.
- Re-architecting the wide-event backend span model (it works).
- Per-process host metrics (explicitly dropped).

## Decisions (from brainstorming)

- **Host logs:** drop the journald logs pipeline entirely.
- **Metrics cut:** moderate — dedupe duplicate `host_metrics`, raise interval,
  keep `docker_stats`, **drop the `processes` scraper** (largest contributor).
- **Trace root:** browser form-submit span is the root.
- **Delivery:** one phased effort; one PR per repo (sillybus + infra), not
  stacked chains.

## Key Honeycomb facts driving the design

- Metric event count ≈ (capture interval) × (number of distinct timeseries).
  A timeseries is one unique combination of resource attributes + datapoint
  attributes. The `processes` scraper multiplies by process count; that is the
  single biggest lever.
- Under Metrics 2.0, datapoints sharing the same OTLP request, second-truncated
  timestamp, resource attribute set, and datapoint attributes collapse into one
  wide event. The existing `batch` processor already helps; the win is reducing
  cardinality, not re-routing.
- Honeycomb routes **traces** to a dataset by `service.name`, but **metrics
  require an explicit `x-honeycomb-dataset` header**. Any metrics exporter
  without that header lands in `unknown_metrics`.

## Workstream 1 — Metrics volume (infra + sillybus)

### 1a. Host collector — `infra/nixos/modules/observability.nix`

- Remove the `processes` scraper from `host_metrics.scrapers`.
- Raise `host_metrics.collection_interval` 30s → 60s.
- Keep cpu, memory, load, disk, filesystem, network, paging.
- Metrics already carry the explicit `x-honeycomb-dataset: platform-host-metrics`
  header — unchanged.

### 1b. In-stack collector — `config/otel-collector-config.prod.yaml`

- Remove the `host_metrics` receiver from the `metrics` pipeline (the host
  collector owns VM metrics now — this is the never-landed "B.6" dedupe). The
  receiver block can be deleted entirely if unused elsewhere.
- Keep `docker_stats` (per-container; the host collector does not cover this)
  and the backend OTLP metrics → `syllabus-tracker-metrics`.

Expected effect: `platform-host-metrics` drops sharply (no per-process
timeseries, half the interval); `syllabus-tracker-metrics` drops (no duplicated
host metrics).

## Workstream 2 — Drop host logs (infra)

`infra/nixos/modules/observability.nix`:

- Remove the `journald` receiver and the entire `logs` pipeline.
- `unknown_log_source` ingest goes to 0. Unit logs remain available on the box
  via `journalctl`.

## Workstream 3 — Fix `unknown_metrics` (sillybus)

`config/otel-collector-config.prod.yaml`:

- Add an explicit `x-honeycomb-dataset: nginx-metrics` header to the
  `otlp_http/metrics-nginx` exporter. Both nginx scrapes (app + host) then land
  in a single `nginx-metrics` dataset, distinguished by their `service.name`
  column.
- Correct the misleading comment that claims metrics auto-route by
  `service.name`.
- Audit: confirm every metrics exporter has an explicit dataset header
  (`platform-host-metrics`, `syllabus-tracker-metrics`, `nginx-metrics`).

## Workstream 4 — Trace propagation: form-submit = root (sillybus)

`frontend/src/lib/telemetry.ts`:

- Rework `recordFormSubmission` so the form span becomes the **active context**
  across the asynchronous submit + upload. Use
  `context.with(trace.setSpan(context.active(), span), () => ...)` (or a wrapper
  that returns both the span and a runner) so the upload `fetch`
  auto-instrumentation span opens as a child and `traceparent` carries the form
  span id to the backend.
- End the span when the submit settles (success or error), stamping outcome
  attributes.
- The backend already extracts the incoming `traceparent` and calls
  `set_parent` (`crates/syllabus-tracker/src/telemetry.rs:197`), so the backend
  request span becomes a child automatically. Verify nginx/traefik forward the
  `traceparent` header end to end (prior plan says yes; confirm on staging).

Resulting trace: browser form-submit (root) → backend request → enqueue span →
worker `transcode_job` span.

## Workstream 5 — GCP video worker traces (sillybus)

Cause is an export-path failure (no spans ever reached Honeycomb; the key can
create datasets). Fixes, robust regardless of which suspect the `gcloud` logs
confirm:

- **`.github/workflows/deploy-video-worker.yaml`:** set
  `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT=https://api.honeycomb.io/v1/traces`
  explicitly. The SDK uses a signal-specific endpoint verbatim, removing the
  base-endpoint path-append ambiguity that is the prime suspect for a silent
  404. Keep the existing base endpoint var for metrics/other signals if needed.
- **`crates/video-worker/src/main.rs`:** verify `main` calls `force_flush()`
  then `shutdown()` on the provider returned by `telemetry::init()` before exit
  (short-lived process; the batch exporter drops spans otherwise). Fix if
  missing.
- **Header parsing:** confirm the opentelemetry-otlp 0.29 HTTP exporter
  (`http-proto` + `reqwest-client`, `default-features=false`) honours
  `OTEL_EXPORTER_OTLP_HEADERS` (the `x-honeycomb-team` auth header). If it does
  not, set the header explicitly in `telemetry::init()`.
- **`crates/video-worker/src/bin/transcode-server.rs`:** initialise OTel in the
  server, open a relay span from `job.traceparent`, and forward that span's
  context (not the raw inbound `traceparent`) as the child's `TRACEPARENT` env.
  Closes the gap between the backend enqueue span and the worker span. Flush on
  shutdown.
- **No infra/key change** — the existing backend ingest key is correct.

## Verification

- Staging deploy of both repos.
- `gcloud logging read 'resource.type="cloud_run_revision"
  resource.labels.service_name="transcode-server"' --project=matthewtapps-sillybus`
  shows OTLP export succeeding (no 404/401), `transcode_job` span flushed.
- In Honeycomb (`sillybus` env): `syllabus-tracker-video-worker` dataset exists
  with spans; a browser video-form submission produces a single trace whose
  root is the form span and whose leaf is the worker span.
- Dataset event counts: `unknown_log_source` = 0, `unknown_metrics` = 0,
  `platform-host-metrics` and `syllabus-tracker-metrics` materially lower.
- `nginx-metrics` dataset receives the nginx connection metrics.

## Rollout

- **infra PR:** `observability.nix` — drop `processes` scraper, 60s interval,
  remove journald logs pipeline.
- **sillybus PR:** in-stack collector dedupe + nginx dataset header + comment
  fix; frontend `recordFormSubmission` rework; `transcode-server` relay span +
  OTel init; `video-worker` flush verify; `deploy-video-worker.yaml` traces
  endpoint var.
- Deploy infra first (metrics/logs cut is independent and low-risk), then
  sillybus, then verify the end-to-end trace.

## Open items

- `gcloud` log paste to pin the exact worker export failure (404 vs 401 vs
  flush). Fixes above cover all three; the log just confirms which.
