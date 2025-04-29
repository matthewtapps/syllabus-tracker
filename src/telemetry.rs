use dotenv::dotenv;
use once_cell::sync::OnceCell;
use opentelemetry::{
    Context, KeyValue,
    global::{self},
    propagation::{Extractor, TextMapCompositePropagator},
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
    http::Status,
    request::{FromRequest, Outcome},
};
use std::collections::HashMap;
use tonic::metadata::MetadataMap;
use tracing::{Instrument, Span, info_span};
use tracing_opentelemetry::OpenTelemetrySpanExt;
use tracing_subscriber::{Registry, layer::SubscriberExt};

static REQUEST_CONTEXT: OnceCell<Context> = OnceCell::new();

#[derive(Clone)]
pub struct TracingSpan<T = Span>(T);

impl TracingSpan {
    pub fn enter(&self) -> tracing::span::Entered<'_> {
        self.0.enter()
    }

    pub fn in_scope<F, R>(&self, f: F) -> R
    where
        F: FnOnce() -> R,
    {
        self.0.in_scope(f)
    }

    pub fn inner(&self) -> &Span {
        &self.0
    }

    pub async fn in_scope_async<F, Fut, R>(&self, f: F) -> R
    where
        F: FnOnce() -> Fut,
        Fut: std::future::Future<Output = R>,
    {
        Instrument::instrument(f(), self.0.clone()).await
    }
}

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
        println!("headers: {:?}", headers.clone(),);

        let extractor = OwnedHeaderExtractor { headers };

        let parent_context =
            global::get_text_map_propagator(|propagator| propagator.extract(&extractor));

        println!("context: {:?}", parent_context);

        let _ = REQUEST_CONTEXT.set(parent_context.clone());

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

        let span = info_span!(
            "on_request",
            { HTTP_REQUEST_METHOD } = method,
            { HTTP_ROUTE } = route,
            { HTTP_URL } = uri,
            { HTTP_CLIENT_IP } = client_ip,
        );

        span.set_parent(parent_context);

        request.local_cache(|| TracingSpan::<Option<Span>>(Some(span.clone())));

        let _guard = span.entered();
    }

    async fn on_response<'r>(&self, request: &'r Request<'_>, response: &mut Response<'r>) {
        if let Some(span) = request
            .local_cache(|| TracingSpan::<Option<Span>>(None))
            .0
            .to_owned()
        {
            let _entered_span = span.entered();
            _entered_span.record(HTTP_RESPONSE_STATUS_CODE, response.status().code);

            drop(_entered_span);
        }
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
