use dotenv::dotenv;
use opentelemetry::{KeyValue, trace::TracerProvider as _};
use opentelemetry_otlp::{Protocol, WithExportConfig, WithTonicConfig};
use opentelemetry_sdk::{
    Resource,
    trace::{RandomIdGenerator, Sampler, SdkTracerProvider},
};
use opentelemetry_semantic_conventions::{
    SCHEMA_URL,
    attribute::{SERVICE_NAME, SERVICE_VERSION},
    resource::DEPLOYMENT_ENVIRONMENT_NAME,
};
use rocket::{
    Data, Request, Response,
    fairing::{Fairing, Info, Kind},
};
use std::time::Instant;
use tonic::metadata::MetadataMap;
use tracing::info_span;
use tracing_opentelemetry::OpenTelemetryLayer;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

use crate::TELEMETRY_GUARD;

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
        let method = request.method().to_string();
        let uri = request.uri().to_string();

        let start_time = Instant::now();

        let span = info_span!(
            "http_request",
            otel.name = format!("{} {}", method, uri),
            http.method = method,
            http.uri = uri,
            http.route = request.route().map(|r| r.uri.to_string()),
        );

        request.local_cache(|| (span, start_time));
    }

    async fn on_response<'r>(&self, request: &'r Request<'_>, response: &mut Response<'r>) {
        let (span, start_time) = request.local_cache(|| {
            let span = info_span!("http_request");
            (span, Instant::now())
        });

        let duration = start_time.elapsed();

        span.record("http.status_code", &response.status().code);
        span.record("http.duration_ms", duration.as_millis() as i64);

        let _entered = span.enter();
        tracing::info!(
            "Completed request in {}ms with status {}",
            duration.as_millis(),
            response.status().code
        );
    }
}

fn resource() -> Resource {
    Resource::builder()
        .with_schema_url(
            [
                KeyValue::new(SERVICE_NAME, env!("CARGO_PKG_NAME")),
                KeyValue::new(SERVICE_VERSION, env!("CARGO_PKG_VERSION")),
                KeyValue::new(DEPLOYMENT_ENVIRONMENT_NAME, "develop"),
            ],
            SCHEMA_URL,
        )
        .build()
}

// Construct TracerProvider for OpenTelemetryLayer
fn init_tracer_provider() -> SdkTracerProvider {
    let honeycomb_api_key =
        std::env::var("HONEYCOMB_API_KEY").expect("HONEYCOMB_API_KEY environment variable not set");

    let mut metadata = MetadataMap::new();
    metadata.insert("x-honeycomb-team", honeycomb_api_key.parse().unwrap());

    let exporter = opentelemetry_otlp::SpanExporter::builder()
        .with_tonic()
        .with_endpoint("https://api.honeycomb.io:443")
        .with_tls_config(tonic::transport::ClientTlsConfig::new().with_native_roots())
        .with_protocol(Protocol::Grpc)
        .with_metadata(metadata)
        .build()
        .unwrap();

    let tracer_provider = SdkTracerProvider::builder()
        .with_sampler(Sampler::AlwaysOn)
        .with_id_generator(RandomIdGenerator::default())
        .with_resource(resource())
        .with_batch_exporter(exporter)
        .build();

    tracer_provider
}

pub struct OtelGuard {
    tracer_provider: SdkTracerProvider,
}

pub fn init_honeycomb_telemetry() -> OtelGuard {
    match dotenv() {
        Ok(path) => tracing::debug!("Loaded environment from {:?}", path),
        Err(e) => tracing::debug!("Could not load .env file: {}", e),
    }
    let tracer_provider = init_tracer_provider();

    let tracer = tracer_provider.tracer("syllabus-tracker");

    let env_filter = tracing_subscriber::EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info"));

    tracing_subscriber::registry()
        .with(env_filter)
        .with(tracing_subscriber::fmt::layer())
        .with(OpenTelemetryLayer::new(tracer))
        .init();

    OtelGuard { tracer_provider }
}

impl Drop for OtelGuard {
    fn drop(&mut self) {
        if let Err(err) = self.tracer_provider.shutdown() {
            eprintln!("Failed to shut down tracer provider: {:?}", err);
        }
    }
}

pub fn shutdown_telemetry() {
    println!("Shutting down telemetry...");

    let guard = TELEMETRY_GUARD.lock().unwrap().take();
    drop(guard); // This will trigger the Drop impl and shutdown
}
