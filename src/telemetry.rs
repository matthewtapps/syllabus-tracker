use dotenv::dotenv;
use opentelemetry::{
    KeyValue,
    global::{self},
    propagation::TextMapCompositePropagator,
    trace::TracerProvider as _,
};
use opentelemetry_otlp::{Protocol, WithExportConfig, WithTonicConfig};
use opentelemetry_sdk::{
    Resource,
    propagation::{BaggagePropagator, TraceContextPropagator},
    trace::{RandomIdGenerator, Sampler, SdkTracerProvider},
};
use opentelemetry_semantic_conventions::{
    SCHEMA_URL,
    attribute::{HTTP_CLIENT_IP, HTTP_URL, SERVICE_NAME, SERVICE_VERSION},
    resource::DEPLOYMENT_ENVIRONMENT_NAME,
    trace::{HTTP_REQUEST_METHOD, HTTP_RESPONSE_STATUS_CODE, HTTP_ROUTE},
};
use rocket::{
    Data, Request, Response,
    fairing::{Fairing, Info, Kind},
};
use tonic::metadata::MetadataMap;
use tracing::{info, instrument};
use tracing_subscriber::{Registry, layer::SubscriberExt};

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

    #[instrument]
    async fn on_request(&self, request: &mut Request<'_>, _: &mut Data<'_>) {
        let method = request.method().to_string();
        let uri = request.uri().to_string();
        let route = request
            .route()
            .map(|r| r.uri.to_string())
            .unwrap_or_default();
        let client_ip = request
            .client_ip()
            .map(|ip| ip.to_string())
            .unwrap_or_default();

        info!(
            { HTTP_REQUEST_METHOD } = method,
            { HTTP_ROUTE } = route,
            { HTTP_URL } = uri,
            { HTTP_CLIENT_IP } = client_ip,
        );
    }

    async fn on_response<'r>(&self, _request: &'r Request<'_>, response: &mut Response<'r>) {
        let status_code = response.status().code as i64;

        info!({ HTTP_RESPONSE_STATUS_CODE } = status_code);
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

pub fn init_tracing() {
    match dotenv() {
        Ok(path) => tracing::debug!("Loaded environment from {:?}", path),
        Err(e) => tracing::debug!("Could not load .env file: {}", e),
    }

    let baggage_propagator = BaggagePropagator::new();
    let trace_context_propagator = TraceContextPropagator::new();
    let composite_propagator = TextMapCompositePropagator::new(vec![
        Box::new(baggage_propagator),
        Box::new(trace_context_propagator),
    ]);

    global::set_text_map_propagator(composite_propagator);

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
}
