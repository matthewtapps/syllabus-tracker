//! Worker-side OpenTelemetry wiring.
//!
//! The worker is a short-lived per-job CLI: it extracts the `traceparent`
//! handed down from the backend (via the `TRACEPARENT` env var, forwarded by
//! transcode-server), opens one wide "transcode_job" span as a child of it,
//! and exports directly to Honeycomb over OTLP/HTTP. Because the process exits
//! as soon as the job is done, `main` MUST flush the provider returned here —
//! the batch exporter would otherwise drop the spans on exit.

use std::collections::HashMap;

use opentelemetry::{
    KeyValue,
    global,
    propagation::{Extractor, Injector},
    trace::TracerProvider as _,
};
use opentelemetry_sdk::{Resource, propagation::TraceContextPropagator, trace::SdkTracerProvider};
use opentelemetry_semantic_conventions::attribute::{SERVICE_NAME, SERVICE_VERSION};
use tracing_opentelemetry::OpenTelemetrySpanExt;
use tracing_subscriber::{EnvFilter, layer::SubscriberExt, util::SubscriberInitExt};

/// Install the tracing subscriber. Always adds a fmt layer; adds an OTLP export
/// layer only when `OTEL_EXPORTER_OTLP_ENDPOINT` is set (prod / Cloud Run), so
/// dev and tests stay fmt-only and don't try to reach an absent collector.
///
/// Returns the provider when OTLP export is enabled, so the caller can
/// `force_flush` + `shutdown` before the process exits.
pub fn init() -> Option<SdkTracerProvider> {
    global::set_text_map_propagator(TraceContextPropagator::new());

    let env_filter =
        EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info"));
    let fmt_layer = tracing_subscriber::fmt::layer();

    if std::env::var("OTEL_EXPORTER_OTLP_ENDPOINT").is_err() {
        tracing_subscriber::registry()
            .with(env_filter)
            .with(fmt_layer)
            .init();
        return None;
    }

    // Endpoint + headers (e.g. `x-honeycomb-team`) come from the standard
    // OTEL_EXPORTER_OTLP_* env vars, wired by the Cloud Run service config.
    let exporter = opentelemetry_otlp::SpanExporter::builder()
        .with_http()
        .build()
        .expect("build OTLP span exporter");

    let provider = SdkTracerProvider::builder()
        .with_batch_exporter(exporter)
        .with_resource(
            Resource::builder()
                .with_attributes([
                    KeyValue::new(SERVICE_NAME, "syllabus-tracker-video-worker"),
                    KeyValue::new(SERVICE_VERSION, env!("CARGO_PKG_VERSION")),
                ])
                .build(),
        )
        .build();

    let tracer = provider.tracer("video-worker");
    let otel_layer = tracing_opentelemetry::layer().with_tracer(tracer);

    tracing_subscriber::registry()
        .with(env_filter)
        .with(fmt_layer)
        .with(otel_layer)
        .init();

    Some(provider)
}

struct MapExtractor<'a>(&'a HashMap<String, String>);

impl Extractor for MapExtractor<'_> {
    fn get(&self, key: &str) -> Option<&str> {
        self.0.get(key).map(|s| s.as_str())
    }
    fn keys(&self) -> Vec<&str> {
        self.0.keys().map(|s| s.as_str()).collect()
    }
}

/// Build the parent OTel context from a `traceparent` string (the value the
/// backend put on the job). Empty/None yields a fresh root context.
pub fn parent_context(traceparent: Option<&str>) -> opentelemetry::Context {
    let mut carrier = HashMap::new();
    if let Some(tp) = traceparent {
        carrier.insert("traceparent".to_string(), tp.to_string());
    }
    global::get_text_map_propagator(|p| p.extract(&MapExtractor(&carrier)))
}

struct MapInjector<'a>(&'a mut HashMap<String, String>);

impl Injector for MapInjector<'_> {
    fn set(&mut self, key: &str, value: String) {
        self.0.insert(key.to_string(), value);
    }
}

/// Serialise the current span's context into a `traceparent` string, for the
/// result callback so the backend webhook continues the same trace.
pub fn current_traceparent() -> Option<String> {
    let cx = tracing::Span::current().context();
    let mut carrier = HashMap::new();
    global::get_text_map_propagator(|p| p.inject_context(&cx, &mut MapInjector(&mut carrier)));
    carrier.remove("traceparent")
}
