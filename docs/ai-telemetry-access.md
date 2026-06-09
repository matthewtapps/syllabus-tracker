# Querying Honeycomb telemetry from an AI agent

How an AI working in this repo (Claude Code, Cursor, etc.) can pull
real production traces from Honeycomb to debug issues, validate
deploys, and answer questions like "what was happening when X broke?"

## What you can answer with telemetry

Distributed traces from Honeycomb cover:

- **Browser to backend round-trips.** Every user fetch carries a
  `traceparent` header (auto-instrumented via `@opentelemetry/auto-
  instrumentations-web`). Each request becomes a trace spanning:
  browser fetch → Traefik on sugar-glider → intra-stack nginx → Rust
  Rocket handler → SQLite/R2 → response. Shared `trace.trace_id`
  glues the chain.
- **Host metrics.** `service.name = platform-host`, with
  `system.cpu.utilization`, `system.memory.usage`, `system.disk.*`,
  `system.network.*`. Updated every 30s. Tells you what the VM was
  doing during a slow request.
- **Systemd unit logs.** journald scraper streams traefik, docker,
  sshd, runtime-secrets unit logs to Honeycomb. Searchable by
  `_SYSTEMD_UNIT`.
- **Deploy markers** (when a Configuration Key with `markers:write`
  is wired up — see "Setup" below). Vertical lines on time-series
  charts annotated with the git SHA.

This is everything you'd ask an SRE for, queryable from a chat prompt.

## Setup (one-time)

There are two ways to give an AI access to this data.

### Option 1: Honeycomb's hosted MCP server (recommended)

Honeycomb runs an MCP server at `mcp.honeycomb.io`. Authenticated via
OAuth 2.1, no API keys to share. The AI gets read-only access to your
team's environments.

```jsonc
// ~/.claude.json or equivalent
{
  "mcpServers": {
    "honeycomb": {
      "url": "https://mcp.honeycomb.io",
      "type": "sse"
    }
  }
}
```

Currently Honeycomb Enterprise tier only. If you're not Enterprise,
use option 2.

### Option 2: API key + direct HTTP

Click-mint a **Configuration Key** in the Honeycomb UI:

1. Team Settings → Manage Keys → "Create Configuration Key"
2. Scope to the **sillybus** environment (NOT syllabus-tracker —
   that's legacy)
3. Permissions: `queries:write` (required for query API),
   `markers:write` (for deploy markers), `boards:read` if you want
   board interaction. Skip `manage` scopes — read-only is enough.
4. Stash the value somewhere your agent can read (env var, password
   manager, etc.). Don't commit.

Hit the v1 query API directly:

```sh
HC_KEY=...
curl -s -H "X-Honeycomb-Team: $HC_KEY" \
  -H "Content-Type: application/json" \
  -X POST https://api.honeycomb.io/1/queries/__all__ \
  -d '{
    "time_range": 3600,
    "granularity": 60,
    "calculations": [{"op": "COUNT"}],
    "breakdowns": ["service.name"]
  }'
```

This returns a query_id. Poll `/1/query_results/__all__/{id}` for results.

## The shape of our telemetry

### Environments

- **sillybus** (id `hcaen_01kth4k90j69a9vvgks864rh78`) — production on
  sugar-glider.

### Services (datasets) you'll see in sillybus

| service.name             | What it is                                   | Where it lives                        |
|--------------------------|----------------------------------------------|---------------------------------------|
| `sillybus-backend`       | Rust Rocket app's spans                      | docker container on sugar-glider      |
| `nginx-sillybus`         | intra-stack nginx spans (ngx_otel_module)    | docker container on sugar-glider      |
| `sillybus-browser`       | React SDK spans (documentLoad, fetch, etc.)  | end users' browsers                   |
| `traefik-sugar-glider`   | host Traefik spans (host header routing)     | NixOS systemd service                 |
| `platform-host`          | hostmetrics + journald                       | NixOS systemd service                 |

### Useful trace patterns

**"Find a specific request from the browser":**

The browser dev tools show `traceparent: 00-<trace_id>-<span_id>-01`
on every outbound fetch. Copy `<trace_id>`. In Honeycomb, query:

```json
{
  "filters": [
    {"column": "trace.trace_id", "op": "=", "value": "<trace_id>"}
  ],
  "calculations": [{"op": "COUNT"}],
  "breakdowns": ["service.name", "name"],
  "time_range": 3600
}
```

You'll see one row per span across all the services that touched the
request. Expand it to see the full waterfall.

**"What slowed down the last 10 minutes?":**

```json
{
  "filters": [
    {"column": "service.name", "op": "=", "value": "sillybus-backend"}
  ],
  "calculations": [
    {"op": "HEATMAP", "column": "duration_ms"},
    {"op": "P95", "column": "duration_ms"}
  ],
  "breakdowns": ["http.route"],
  "time_range": 600,
  "granularity": 30
}
```

**"Correlate slow request with host pressure":**

Get the slow request's `trace.trace_id` + timestamp. Pull host metrics
around that moment:

```json
{
  "filters": [
    {"column": "service.name", "op": "=", "value": "platform-host"}
  ],
  "calculations": [
    {"op": "AVG", "column": "system.cpu.utilization"},
    {"op": "AVG", "column": "system.memory.usage"}
  ],
  "time_range": 300,
  "granularity": 10
}
```

## How telemetry gets into Honeycomb

For context (so you can reason about what's missing if a query
returns empty):

```
[browser fetch]
  ├─ @opentelemetry/sdk-trace-web with OTLPTraceExporter (HTTP)
  └─ exports directly to https://api.honeycomb.io/v1/traces using
     VITE_HONEYCOMB_API_KEY (baked into Vite bundle at build time;
     this is the BROWSER ingest key, distinct from backend)
        │
        ▼  (traceparent header propagated by auto-instrumentation-web)
[Traefik on sugar-glider]
  ├─ services.traefik.tracing.otlp.grpc → 127.0.0.1:14317
  └─ host otel-collector receives, adds host.name,
     forwards via OTLP/HTTP to Honeycomb using
     HONEYCOMB_PLATFORM_INGEST (per-host platform ingest key)
        │
        ▼  (traceparent forwarded as a request header)
[intra-stack nginx (alpine-otel)]
  ├─ ngx_otel_module otel_trace + otel_trace_context propagate
  └─ exports via OTLP/gRPC to in-stack otel-collector:4317
     which exports to Honeycomb using HONEYCOMB_API_KEY
     (sillybus-backend ingest key)
        │
        ▼
[Rust Rocket app]
  ├─ tracing-opentelemetry + opentelemetry-otlp (grpc-tonic)
  ├─ Rocket fairing extracts incoming traceparent via
  │    OwnedHeaderExtractor (crates/syllabus-tracker/src/telemetry.rs)
  └─ exports to in-stack otel-collector:4317 → Honeycomb

[NixOS host (parallel)]
  ├─ hostmetrics scraper → metrics
  └─ journald scraper for traefik/docker/sshd/runtime-secrets units
     → host otel-collector → Honeycomb
```

If a layer is missing in a trace:

- **No browser spans:** check the network tab in dev tools. The
  browser should POST to `https://api.honeycomb.io/v1/traces`. If it
  doesn't, check `VITE_HONEYCOMB_API_KEY` was baked into the bundle
  (it's a Vite build-arg, sourced from platform tofu state — see
  `infra/docs/honeycomb-telemetry.md`).
- **No Traefik spans:** `journalctl -u traefik | grep -i otel` on the
  host. Misconfigured `tracing.otlp.grpc` endpoint typically logs a
  connection error.
- **No nginx spans but app spans present:** ngx_otel_module isn't
  forwarding `traceparent` to upstream. The nginx default.conf uses
  variable proxy_pass with `resolver 127.0.0.11`, which forwards
  headers correctly; if you broke that, the seam is in
  `nginx/default.conf`.
- **No backend spans:** Rust app's OTEL_EXPORTER_OTLP_ENDPOINT should
  point at `http://otel-collector:4317` (in-stack docker DNS). Check
  `config/prod.env`.
- **No host metrics:** `systemctl status platform-otelcol` on sugar-
  glider. Common failure mode: `/run/runtime-secrets/platform-host.env`
  not yet decrypted (the nixos-deploy workflow has to ship the
  HONEYCOMB_PLATFORM_INGEST file before the closure activates;
  `ConditionPathExists` keeps the service from starting until then).

## Examples of useful AI agent prompts

These are the kinds of questions telemetry makes answerable from a
chat. Feed the chat output to the AI as context, or wire MCP.

- "What's the p95 latency of `/api/courses/:id` in the last hour, and
  how does it compare to yesterday?"
- "Find any 5xx responses since the last deploy marker. For each one,
  show the full trace waterfall."
- "What was the VM's memory pressure during the slowest request to
  `/api/videos/upload` in the last 24h?"
- "Did the deploy from SHA `abc123` introduce any new error
  signatures in the backend?"
- "Compare span counts per service between sillybus and the legacy
  syllabus-tracker env for the last hour."

## What NOT to query

- **Don't query raw events looking for secrets.** All
  runtime-secrets values go through the in-stack collector or the
  host collector with `Authorization` header, NOT in span
  attributes. But if a misconfigured library logs a token, it'll
  end up in Honeycomb. If you spot one, rotate the key immediately
  via `tofu apply -replace=honeycombio_api_key.service_ingest["sillybus-backend"]`
  and redeploy.
- **Avoid queries that return >1M events.** Honeycomb's free tier
  caps query time; very wide queries (no filter, large time range,
  high-cardinality breakdown) can time out. Add filters first.

## Limits and caveats

- We're on Honeycomb's free tier (20M events/month). Each app
  request generates ~5-10 spans. At light traffic (~100 req/day),
  monthly budget is fine. If you start generating traces from CI or
  load tests, watch the ingest quota.
- The browser ingest key has `create_datasets = false` because it
  ships in the public bundle. If you add a NEW service.name from the
  browser side, you have to create the dataset in the UI first
  (otherwise the events are silently dropped).
- Trace tail-sampling: the in-stack collector samples health-check
  traces down to 2% (configured in `config/otel-collector-config.
  prod.yaml`'s `tail_sampling` block). Don't be surprised if you
  see fewer `/api/health` spans than there were actual requests.

## References

- [Honeycomb API docs](https://docs.honeycomb.io/api/)
- [Honeycomb MCP server](https://docs.honeycomb.io/integrations/mcp)
- [`infra/docs/honeycomb-telemetry.md`](../../infra/docs/honeycomb-telemetry.md)
  — design + setup of the telemetry pipeline at the platform tier.
- [OpenTelemetry semantic conventions](https://opentelemetry.io/docs/specs/semconv/)
  — what attributes mean (`service.name`, `http.route`, etc.).
