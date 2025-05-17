use once_cell::sync::OnceCell;
use opentelemetry::{
    Context, KeyValue,
    global::{self},
    propagation::{Extractor, TextMapCompositePropagator},
    trace::TracerProvider as _,
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
    attribute::{HTTP_URL, HTTP_USER_AGENT, SERVICE_NAME, SERVICE_VERSION, SESSION_ID, USER_ID},
    trace::{HTTP_REQUEST_METHOD, HTTP_RESPONSE_STATUS_CODE},
};
use rocket::{
    Data, Request, Response,
    fairing::{Fairing, Info, Kind},
    http::Status,
    request::{FromRequest, Outcome},
};
use std::collections::HashMap;
use tracing::{Span, field};
use tracing_opentelemetry::OpenTelemetrySpanExt;
use tracing_subscriber::{Registry, layer::SubscriberExt};

static REQUEST_CONTEXT: OnceCell<Context> = OnceCell::new();

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
            .map(|cookie| cookie.value().to_string())
            .unwrap_or_else(|| "unknown_session".to_string());

        let extractor = OwnedHeaderExtractor { headers };

        let parent_context =
            global::get_text_map_propagator(|propagator| propagator.extract(&extractor));

        let _ = REQUEST_CONTEXT.set(parent_context.clone());

        let span = tracing::Span::current();

        let span_name = format!("{} {}", request.method(), request.uri().path());
        span.record("otel.name", field::display(span_name));
        span.record(HTTP_REQUEST_METHOD, field::display(request.method()));
        span.record(HTTP_URL, field::display(request.uri().path()));
        span.record(
            HTTP_USER_AGENT,
            field::display(request.headers().get_one("User-Agent").unwrap_or("")),
        );
        span.record(SESSION_ID, field::display(session_id));
        span.record(USER_ID, field::display(user_id));

        span.set_parent(parent_context);

        request.local_cache(|| TracingSpan::<Option<Span>>(Some(span.clone())));
    }

    async fn on_response<'r>(&self, request: &'r Request<'_>, response: &mut Response<'r>) {
        if let Some(span) = request
            .local_cache(|| TracingSpan::<Option<Span>>(None))
            .0
            .to_owned()
        {
            span.record(
                HTTP_RESPONSE_STATUS_CODE,
                field::display(response.status().code),
            );

            // Check for error status and add error attributes if needed
            if response.status().code >= 500 {
                span.record(
                    "error",
                    field::display(format!("HTTP Error: {}", response.status().code)),
                );
                span.record("error.kind", field::display("server_error"));
                span.record("otel.status_code", field::display("ERROR"));
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
            let span = request
                .local_cache(|| TracingSpan::<Option<Span>>(None))
                .0
                .to_owned();

            if let Some(span) = span {
                let entered_span = span.entered();

                entered_span.record(
                    "error",
                    tracing::field::display(format!("HTTP Error: {}", status.code)),
                );
                entered_span.record("error.kind", tracing::field::display("server_error"));
                entered_span.record("http.status_code", status.code);

                if let Some(err_msg) = request.local_cache(|| Option::<String>::None) {
                    entered_span.record("error.message", tracing::field::display(err_msg));
                }

                entered_span.record("otel.status_code", tracing::field::display("ERROR"));

                drop(entered_span)
            }
        }
    }
}

fn resource() -> Resource {
    Resource::builder()
        .with_schema_url(
            [
                KeyValue::new(SERVICE_NAME, env!("CARGO_PKG_NAME")),
                KeyValue::new(SERVICE_VERSION, env!("CARGO_PKG_VERSION")),
            ],
            SCHEMA_URL,
        )
        .build()
}

pub fn init_tracing() {
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
        .with_resource(resource())
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
        .with_resource(resource())
        .with_periodic_exporter(meter_exporter)
        .build();

    global::set_meter_provider(meter_provider);
}
