use opentelemetry::{
    Key, KeyValue, Value,
    global::{self},
    propagation::{Extractor, TextMapCompositePropagator},
    trace::{Status as OtelStatus, TracerProvider as _},
};
use opentelemetry_otlp::MetricExporter;
use opentelemetry_sdk::{
    Resource,
    metrics::SdkMeterProvider,
    propagation::{BaggagePropagator, TraceContextPropagator},
    trace::{RandomIdGenerator, Sampler, SdkTracerProvider},
};
use opentelemetry_semantic_conventions::{
    SCHEMA_URL,
    attribute::{
        ERROR_TYPE, HTTP_ROUTE, SERVICE_NAME, SERVICE_VERSION, SESSION_ID, URL_PATH, URL_QUERY,
        USER_AGENT_ORIGINAL, USER_ID,
    },
    trace::{HTTP_REQUEST_METHOD, HTTP_RESPONSE_STATUS_CODE},
};
use rocket::{
    Data, Request, Response,
    fairing::{Fairing, Info, Kind},
    http::Status,
    request::{FromRequest, Outcome},
};
use std::any::TypeId;
use std::collections::HashMap;
use std::marker::PhantomData;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Instant;
use tracing::{Dispatch, Span, span};
use tracing_opentelemetry::OpenTelemetrySpanExt;
use tracing_subscriber::{
    Layer, Registry, layer::Context, layer::SubscriberExt, registry::LookupSpan,
};

#[derive(Clone)]
pub struct TracingSpan<T = Span>(pub T);

/// Cached handle to Rocket's per-request root span (the `#[instrument("request")]`
/// span in `rocket::server`). We keep it separately from the main wide-event
/// span because it is the registry ancestor of every db span in the request, so
/// it is where [`DbStatsLayer`] hangs the [`DbCallStats`] tally that
/// [`TelemetryFairing::on_response`] flushes onto the main span.
#[derive(Clone)]
struct RocketRequestSpan(Option<Span>);

#[rocket::async_trait]
impl<'r> FromRequest<'r> for TracingSpan {
    type Error = ();

    async fn from_request(request: &'r Request<'_>) -> Outcome<Self, ()> {
        match request.local_cache(|| TracingSpan::<Option<Span>>(None)) {
            TracingSpan(Some(span)) => Outcome::Success(TracingSpan(span.to_owned())),
            TracingSpan(_) => Outcome::Error((Status::InternalServerError, ())),
        }
    }
}

/// Stamp a wide-event attribute onto the request's "main" span (the per-request
/// root span cached by [`TelemetryFairing`]). This is the building block of the
/// wide-event pattern: accumulate as much context as possible onto one span per
/// unit of work, then query it in Honeycomb.
///
/// We go through the OTel attribute API (`set_attribute`) rather than tracing's
/// `record`, because these keys are not declared as fields on Rocket's auto
/// request span and `record` silently drops undeclared fields. No-op if the
/// main span has not been cached yet (e.g. before the fairing's `on_request`).
pub fn set_main_attr(
    request: &Request<'_>,
    key: impl Into<Key>,
    value: impl Into<Value>,
) {
    let TracingSpan(span) = request.local_cache(|| TracingSpan::<Option<Span>>(None));
    if let Some(span) = span {
        span.set_attribute(key, value);
    }
}

/// Request guard handing back the request's main wide-event span so handlers
/// can layer domain attributes onto it via [`MainSpan::set`] without threading
/// `&Request` around. Always succeeds; `set` is a no-op if the span is absent.
pub struct MainSpan(Option<Span>);

#[rocket::async_trait]
impl<'r> FromRequest<'r> for MainSpan {
    type Error = std::convert::Infallible;

    async fn from_request(request: &'r Request<'_>) -> Outcome<Self, Self::Error> {
        let TracingSpan(span) = request.local_cache(|| TracingSpan::<Option<Span>>(None));
        Outcome::Success(MainSpan(span.clone()))
    }
}

impl MainSpan {
    /// Stamp a wide-event attribute onto the main span.
    pub fn set(&self, key: impl Into<Key>, value: impl Into<Value>) {
        if let Some(span) = &self.0 {
            span.set_attribute(key, value);
        }
    }
}

struct OwnedHeaderExtractor {
    headers: HashMap<String, String>,
}

impl Extractor for OwnedHeaderExtractor {
    fn get(&self, key: &str) -> Option<&str> {
        self.headers.get(key).map(|s| s.as_str())
    }

    fn keys(&self) -> Vec<&str> {
        self.headers.keys().map(|k| k.as_str()).collect()
    }
}

#[derive(Debug)]
pub struct TelemetryFairing;

#[rocket::async_trait]
impl Fairing for TelemetryFairing {
    fn info(&self) -> Info {
        Info {
            name: "OpenTelemetry",
            kind: Kind::Request | Kind::Response,
        }
    }

    async fn on_request(&self, request: &mut Request<'_>, _: &mut Data<'_>) {
        let mut headers = HashMap::new();
        let trace_headers = ["traceparent", "tracestate", "baggage"];

        for &header_name in &trace_headers {
            if let Some(value) = request.headers().get_one(header_name) {
                headers.insert(header_name.to_string(), value.to_string());
            }
        }

        let session_id = request
            .cookies()
            .get("otel_session_id")
            .map(|cookie| cookie.value().to_string())
            .unwrap_or_else(|| "unknown_session".to_string());

        let user_id = request
            .cookies()
            .get("user_id")
            .map(|cookie| cookie.value().to_string());

        let extractor = OwnedHeaderExtractor { headers };

        let parent_context =
            global::get_text_map_propagator(|propagator| propagator.extract(&extractor));

        // Low-cardinality span name: "METHOD /route/template" (path params
        // templated by `http.route`, query string dropped). Rocket's own
        // per-request span is named the static literal "request", so grouping
        // `main=true` by `name` in Honeycomb was useless; this gives one row per
        // logical operation. Unmatched requests (404s) collapse to
        // "METHOD <unmatched>" so stray paths don't explode cardinality.
        let span_name = match request.route() {
            Some(route) => format!("{} {}", request.method().as_str(), route.uri),
            None => format!("{} <unmatched>", request.method().as_str()),
        };

        // The request's single wide-event "main" span. We mint our own rather
        // than reuse Rocket's "request" span because (a) we need a dynamic name
        // and (b) tracing span names are static. It is created as a registry
        // root (`parent: None`); the magic `otel.name` field is what
        // tracing-opentelemetry maps onto the exported OTel span name.
        let span = tracing::info_span!(parent: None, "http.request", otel.name = %span_name);

        // Wire the trace graph: incoming distributed-trace context -> our main
        // span -> Rocket's request span (the registry ancestor of all
        // handler/db spans). Order matters: set our parent first so
        // `span.context()` carries the final trace id when we reparent Rocket's
        // span under it.
        let rocket_span = tracing::Span::current();
        span.set_parent(parent_context);
        rocket_span.set_parent(span.context());

        // Baseline request attributes. Stamped via the OTel attribute API so
        // they actually land on the span (see `set_main_attr`).
        span.set_attribute("main", true);
        span.set_attribute(HTTP_REQUEST_METHOD, request.method().as_str().to_string());
        span.set_attribute(URL_PATH, request.uri().path().to_string());
        if let Some(route) = request.route() {
            // http.route is the matched, low-cardinality template (good for
            // grouping); the concrete path lives on url.path above.
            span.set_attribute(HTTP_ROUTE, route.uri.to_string());
            if let Some(name) = &route.name {
                span.set_attribute("route.handler", name.to_string());
            }
        }
        span.set_attribute(
            USER_AGENT_ORIGINAL,
            request
                .headers()
                .get_one("User-Agent")
                .unwrap_or("")
                .to_string(),
        );
        span.set_attribute(SESSION_ID, session_id);
        if let Some(user_id) = user_id {
            span.set_attribute(USER_ID, user_id);
        }
        if let Some(sha) = option_env!("GIT_SHA") {
            span.set_attribute("app.build.git_sha", sha.to_string());
        }

        // Cheap, broadly-useful per-request context (the wide-event "soft
        // context"): client IP (set by nginx X-Real-IP), referer, query
        // string and request body size. All best-effort.
        if let Some(ip) = request.client_ip() {
            span.set_attribute("client.address", ip.to_string());
        }
        if let Some(referer) = request.headers().get_one("Referer") {
            span.set_attribute("http.request.header.referer", referer.to_string());
        }
        if let Some(query) = request.uri().query() {
            span.set_attribute(URL_QUERY, query.to_string());
        }
        if let Some(len) = request
            .headers()
            .get_one("Content-Length")
            .and_then(|v| v.parse::<i64>().ok())
        {
            span.set_attribute("http.request.body.size", len);
        }

        // HTTP semconv: which origin was addressed and over what scheme. We sit
        // behind nginx, so scheme comes from the proxy's X-Forwarded-Proto.
        if let Some(host) = request.headers().get_one("Host") {
            match host.rsplit_once(':') {
                Some((name, port)) => {
                    span.set_attribute("server.address", name.to_string());
                    if let Ok(port) = port.parse::<i64>() {
                        span.set_attribute("server.port", port);
                    }
                }
                None => span.set_attribute("server.address", host.to_string()),
            }
        }
        span.set_attribute(
            "url.scheme",
            request
                .headers()
                .get_one("X-Forwarded-Proto")
                .unwrap_or("http")
                .to_string(),
        );

        request.local_cache(|| TracingSpan::<Option<Span>>(Some(span.clone())));
        request.local_cache(|| RocketRequestSpan(Some(rocket_span)));
    }

    async fn on_response<'r>(&self, request: &'r Request<'_>, response: &mut Response<'r>) {
        if let Some(span) = request
            .local_cache(|| TracingSpan::<Option<Span>>(None))
            .0
            .to_owned()
        {
            let code = response.status().code;
            span.set_attribute(HTTP_RESPONSE_STATUS_CODE, code as i64);

            if let Some(len) = response
                .headers()
                .get_one("Content-Length")
                .and_then(|v| v.parse::<i64>().ok())
            {
                span.set_attribute("http.response.body.size", len);
            }

            // Flush per-request database accounting (collected by `DbStatsLayer`
            // on Rocket's request span) onto the main wide-event span, so a
            // single event answers "how many queries / how much db time".
            if let Some(rocket_span) = request
                .local_cache(|| RocketRequestSpan(None))
                .0
                .as_ref()
            {
                if let Some((count, nanos)) = read_db_stats(rocket_span) {
                    span.set_attribute("db.query.count", count as i64);
                    span.set_attribute("db.query.duration_ms", nanos as f64 / 1_000_000.0);
                }
            }

            if code >= 400 {
                let error_category = if code >= 500 {
                    "server_error"
                } else {
                    "client_error"
                };

                let error_type = match code {
                    401 => "unauthorized",
                    403 => "forbidden",
                    404 => "not_found",
                    409 => "conflict",
                    422 => "validation_error",
                    429 => "rate_limited",
                    500 => "internal_server_error",
                    503 => "service_unavailable",
                    _ => error_category,
                };

                span.set_attribute("error", true);
                span.set_attribute(ERROR_TYPE, error_type);

                if let Some(err_msg) = request.local_cache(|| Option::<String>::None) {
                    span.set_attribute("error.message", err_msg.clone());
                }

                // Only 5xx flips the OTel span status to ERROR; 4xx are
                // client faults and stay OK so error-rate alerts track real
                // server failures.
                if code >= 500 {
                    span.set_status(OtelStatus::error(error_type.to_string()));
                }
            }
        }
    }
}

pub struct ErrorTelemetryFairing;

#[rocket::async_trait]
impl Fairing for ErrorTelemetryFairing {
    fn info(&self) -> Info {
        Info {
            name: "Error Telemetry",
            kind: Kind::Response,
        }
    }

    async fn on_response<'r>(&self, request: &'r Request<'_>, response: &mut Response<'r>) {
        let status = response.status();

        if status.code >= 500 {
            if let Some(span) = request
                .local_cache(|| TracingSpan::<Option<Span>>(None))
                .0
                .to_owned()
            {
                span.set_attribute("error", true);
                span.set_attribute(ERROR_TYPE, "server_error");
                span.set_attribute(HTTP_RESPONSE_STATUS_CODE, status.code as i64);

                if let Some(err_msg) = request.local_cache(|| Option::<String>::None) {
                    span.set_attribute("error.message", err_msg.clone());
                }

                span.set_status(OtelStatus::error(format!("HTTP Error: {}", status.code)));
            }
        }
    }
}

/// Per-request tally of database operations. One of these is hung on Rocket's
/// request span by [`DbStatsLayer`] and accumulated across all db-layer spans
/// (every `#[instrument]`ed `crate::db::*` fn) in the request.
#[derive(Default)]
struct DbCallStats {
    count: AtomicU64,
    nanos: AtomicU64,
}

/// Stashed on each db span to measure its wall-clock duration on close.
struct DbSpanTimer(Instant);

/// Spans whose `target` starts with this are counted as database operations.
const DB_TARGET_PREFIX: &str = "syllabus_tracker::db";
/// Rocket's per-request root span (`#[instrument("request")]` in
/// `rocket::server`); the registry ancestor of every db span in a request.
const ROCKET_REQUEST_SPAN_NAME: &str = "request";
const ROCKET_REQUEST_SPAN_TARGET: &str = "rocket::server";

/// Downcast bridge letting non-layer code (the response fairing) read a span's
/// [`DbCallStats`] by id, mirroring tracing-opentelemetry's private
/// `WithContext`. Stored on [`DbStatsLayer`] and reachable via
/// `Dispatch::downcast_ref`.
struct WithDbStats(
    #[allow(clippy::type_complexity)] fn(&Dispatch, &span::Id, &mut dyn FnMut(&DbCallStats)),
);

/// tracing layer that counts db-layer spans into a [`DbCallStats`] hung on the
/// request's root span. Counting happens here, at a single chokepoint, instead
/// of at the hundreds of `&Pool` call sites.
struct DbStatsLayer<S> {
    get_stats: WithDbStats,
    _subscriber: PhantomData<fn(S)>,
}

impl<S> DbStatsLayer<S>
where
    S: tracing::Subscriber + for<'a> LookupSpan<'a>,
{
    fn new() -> Self {
        Self {
            get_stats: WithDbStats(Self::get_stats_fn),
            _subscriber: PhantomData,
        }
    }

    fn get_stats_fn(dispatch: &Dispatch, id: &span::Id, f: &mut dyn FnMut(&DbCallStats)) {
        if let Some(subscriber) = dispatch.downcast_ref::<S>() {
            if let Some(span) = subscriber.span(id) {
                if let Some(stats) = span.extensions().get::<DbCallStats>() {
                    f(stats);
                }
            }
        }
    }
}

impl<S> Layer<S> for DbStatsLayer<S>
where
    S: tracing::Subscriber + for<'a> LookupSpan<'a>,
{
    fn on_new_span(&self, _attrs: &span::Attributes<'_>, id: &span::Id, ctx: Context<'_, S>) {
        let Some(span) = ctx.span(id) else { return };
        let meta = span.metadata();

        if meta.name() == ROCKET_REQUEST_SPAN_NAME
            && meta.target().starts_with(ROCKET_REQUEST_SPAN_TARGET)
        {
            span.extensions_mut().insert(DbCallStats::default());
            return;
        }

        if meta.target().starts_with(DB_TARGET_PREFIX) {
            span.extensions_mut().insert(DbSpanTimer(Instant::now()));
            for ancestor in span.scope() {
                if let Some(stats) = ancestor.extensions().get::<DbCallStats>() {
                    stats.count.fetch_add(1, Ordering::Relaxed);
                    break;
                }
            }
        }
    }

    fn on_close(&self, id: span::Id, ctx: Context<'_, S>) {
        let Some(span) = ctx.span(&id) else { return };
        let elapsed = span.extensions().get::<DbSpanTimer>().map(|t| t.0.elapsed());
        if let Some(elapsed) = elapsed {
            for ancestor in span.scope() {
                if let Some(stats) = ancestor.extensions().get::<DbCallStats>() {
                    stats
                        .nanos
                        .fetch_add(elapsed.as_nanos() as u64, Ordering::Relaxed);
                    break;
                }
            }
        }
    }

    unsafe fn downcast_raw(&self, id: TypeId) -> Option<*const ()> {
        match id {
            id if id == TypeId::of::<Self>() => Some(self as *const _ as *const ()),
            id if id == TypeId::of::<WithDbStats>() => {
                Some(&self.get_stats as *const _ as *const ())
            }
            _ => None,
        }
    }
}

/// Read the accumulated `(query count, total nanos)` off a span carrying
/// [`DbCallStats`] (Rocket's request span). Returns `None` if the
/// [`DbStatsLayer`] is not installed or no stats were attached.
fn read_db_stats(span: &Span) -> Option<(u64, u64)> {
    let mut out = None;
    span.with_subscriber(|(id, dispatch)| {
        if let Some(bridge) = dispatch.downcast_ref::<WithDbStats>() {
            (bridge.0)(dispatch, id, &mut |stats| {
                out = Some((
                    stats.count.load(Ordering::Relaxed),
                    stats.nanos.load(Ordering::Relaxed),
                ));
            });
        }
    });
    out
}

fn resource(videos_enabled: bool) -> Resource {
    Resource::builder()
        .with_schema_url(
            [
                KeyValue::new(SERVICE_NAME, env!("CARGO_PKG_NAME")),
                KeyValue::new(SERVICE_VERSION, env!("CARGO_PKG_VERSION")),
                KeyValue::new("feature.videos.enabled", videos_enabled),
            ],
            SCHEMA_URL,
        )
        .build()
}

pub fn init_tracing(videos_enabled: bool) {
    let baggage_propagator = BaggagePropagator::new();
    let trace_context_propagator = TraceContextPropagator::new();
    let composite_propagator = TextMapCompositePropagator::new(vec![
        Box::new(baggage_propagator),
        Box::new(trace_context_propagator),
    ]);

    global::set_text_map_propagator(composite_propagator);

    let span_exporter = opentelemetry_otlp::SpanExporter::builder()
        .with_tonic()
        .build()
        .unwrap();

    let tracer_provider = SdkTracerProvider::builder()
        .with_sampler(Sampler::AlwaysOn)
        .with_id_generator(RandomIdGenerator::default())
        .with_resource(resource(videos_enabled))
        .with_batch_exporter(span_exporter)
        .build();

    let tracer = tracer_provider.tracer("syllabus-tracker");

    let otel_layer = tracing_opentelemetry::layer().with_tracer(tracer);

    let env_filter = tracing_subscriber::EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info"));

    let subscriber = Registry::default()
        .with(env_filter)
        .with(tracing_subscriber::fmt::layer())
        .with(otel_layer)
        .with(DbStatsLayer::new());

    tracing::subscriber::set_global_default(subscriber)
        .expect("Failed to set global default subscriber");

    let meter_exporter = MetricExporter::builder().with_tonic().build().unwrap();

    let meter_provider = SdkMeterProvider::builder()
        .with_resource(resource(videos_enabled))
        .with_periodic_exporter(meter_exporter)
        .build();

    global::set_meter_provider(meter_provider);
}

#[cfg(test)]
mod tests {
    use super::*;
    use tracing_subscriber::layer::SubscriberExt;

    /// The layer should count every db-target span against the request's root
    /// span and surface the tally through the `WithDbStats` downcast bridge.
    #[test]
    fn db_stats_layer_counts_db_spans() {
        let subscriber = Registry::default().with(DbStatsLayer::new());

        tracing::subscriber::with_default(subscriber, || {
            let request = tracing::info_span!(target: "rocket::server", "request");
            let _entered = request.enter();

            // Two top-level db calls plus one nested call (db fn -> db fn).
            {
                let outer =
                    tracing::info_span!(target: "syllabus_tracker::db::users", "load_user");
                let _o = outer.enter();
                let inner =
                    tracing::info_span!(target: "syllabus_tracker::db::sessions", "touch");
                let _i = inner.enter();
            }
            {
                let s = tracing::info_span!(target: "syllabus_tracker::db::videos", "list");
                let _s = s.enter();
            }

            // A non-db span must not be counted.
            {
                let s = tracing::info_span!(target: "syllabus_tracker::auth", "authenticate");
                let _s = s.enter();
            }

            let (count, _nanos) = read_db_stats(&request).expect("stats attached");
            assert_eq!(count, 3, "three db spans, auth span excluded");
        });
    }

    /// No stats and no panic when the request never touches the db.
    #[test]
    fn db_stats_layer_zero_when_no_db_spans() {
        let subscriber = Registry::default().with(DbStatsLayer::new());

        tracing::subscriber::with_default(subscriber, || {
            let request = tracing::info_span!(target: "rocket::server", "request");
            let _entered = request.enter();
            let (count, _) = read_db_stats(&request).expect("stats attached");
            assert_eq!(count, 0);
        });
    }
}
