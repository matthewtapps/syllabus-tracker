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
use std::collections::HashMap;
use tracing::Span;
use tracing_opentelemetry::OpenTelemetrySpanExt;
use tracing_subscriber::{Registry, layer::SubscriberExt};

#[derive(Clone)]
pub struct TracingSpan<T = Span>(pub T);

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

        // Rocket's `trace` feature opens a per-request span; this is it. We
        // treat it as the request's single wide-event "main" span.
        let span = tracing::Span::current();

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

        span.set_parent(parent_context);

        request.local_cache(|| TracingSpan::<Option<Span>>(Some(span.clone())));
    }

    async fn on_response<'r>(&self, request: &'r Request<'_>, response: &mut Response<'r>) {
        if let Some(span) = request
            .local_cache(|| TracingSpan::<Option<Span>>(None))
            .0
            .to_owned()
        {
            let code = response.status().code;
            span.set_attribute(HTTP_RESPONSE_STATUS_CODE, code as i64);

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
        .with(otel_layer);

    tracing::subscriber::set_global_default(subscriber)
        .expect("Failed to set global default subscriber");

    let meter_exporter = MetricExporter::builder().with_tonic().build().unwrap();

    let meter_provider = SdkMeterProvider::builder()
        .with_resource(resource(videos_enabled))
        .with_periodic_exporter(meter_exporter)
        .build();

    global::set_meter_provider(meter_provider);
}
