use rocket::Request;
use rocket_dyn_templates::{Template, context};
use thiserror::Error;
use tracing::{Span, error, warn};

use crate::telemetry::TracingSpan;

#[derive(Error, Debug)]
pub enum AppError {
    #[error("Database error: {0}")]
    Database(#[from] sqlx::Error),

    #[error("Authentication error: {0}")]
    Authentication(String),

    #[error("Authorization error: {0}")]
    Authorization(String),

    #[error("Not found: {0}")]
    NotFound(String),

    #[error("Validation error: {0}")]
    Validation(String),

    #[error("Redirect error: {0}")]
    Redirect(String),

    #[error("External service error: {0}")]
    ExternalService(String),

    #[error("Internal error: {0}")]
    Internal(String),
}

impl AppError {
    pub fn log_and_record(&self, ctx: &str) {
        let current_span = Span::current();
        let is_valid_span = !current_span.is_none();

        let message = self.to_string();
        let error_kind = match self {
            AppError::Database(_) => {
                error!(error = %message, context = %ctx, "Database error");
                "database_error"
            }
            AppError::Authentication(msg) => {
                warn!(message = %msg, context = %ctx, "Authentication error");
                "authentication_error"
            }
            AppError::Authorization(msg) => {
                warn!(message = %msg, context = %ctx, "Authorization error");
                "authorization_error"
            }
            AppError::NotFound(msg) => {
                warn!(message = %msg, context = %ctx, "Not found error");
                "not_found_error"
            }
            AppError::Validation(msg) => {
                warn!(message = %msg, context = %ctx, "Validation error");
                "validation_error"
            }
            AppError::Redirect(msg) => {
                error!(message = %msg, context = %ctx, "Redirect error");
                "redirect_error"
            }
            AppError::ExternalService(msg) => {
                error!(message = %msg, context = %ctx, "External service error");
                "external_service_error"
            }
            AppError::Internal(msg) => {
                error!(message = %msg, context = %ctx, "Internal server error");
                "internal_error"
            }
        };

        if is_valid_span {
            current_span.record("error", &tracing::field::display(&message));
            current_span.record("error.kind", &tracing::field::display(error_kind));
            current_span.record("error.message", &tracing::field::display(&message));
            current_span.record("otel.status_code", &tracing::field::display("ERROR"));
        }
    }

    pub fn status_code(&self) -> rocket::http::Status {
        match self {
            AppError::Database(_) => rocket::http::Status::InternalServerError,
            AppError::Authentication(_) => rocket::http::Status::Unauthorized,
            AppError::Authorization(_) => rocket::http::Status::Forbidden,
            AppError::NotFound(_) => rocket::http::Status::NotFound,
            AppError::Validation(_) => rocket::http::Status::BadRequest,
            AppError::Redirect(_) => rocket::http::Status::InternalServerError,
            AppError::ExternalService(_) => rocket::http::Status::ServiceUnavailable,
            AppError::Internal(_) => rocket::http::Status::InternalServerError,
        }
    }
}

impl<'r> rocket::response::Responder<'r, 'static> for AppError {
    fn respond_to(self, req: &'r rocket::Request<'_>) -> rocket::response::Result<'static> {
        self.log_and_record(&format!("Request to {} {}", req.method(), req.uri()));

        self.status_code().respond_to(req)
    }
}

impl From<bcrypt::BcryptError> for AppError {
    fn from(error: bcrypt::BcryptError) -> Self {
        AppError::Internal(format!("Cryptography error: {}", error))
    }
}

impl From<rocket::Error> for AppError {
    fn from(error: rocket::Error) -> Self {
        AppError::Redirect(format!("Rocket error: {}", error))
    }
}

#[catch(500)]
pub fn internal_server_error(req: &Request) -> Template {
    if let Some(span) = req
        .local_cache(|| TracingSpan::<Option<Span>>(None))
        .0
        .as_ref()
    {
        let _guard = span.enter();

        // If we haven't already logged an error via AppError
        if span.field("error.message").is_none() {
            span.record("error", &tracing::field::display("Internal Server Error"));
            span.record("error.kind", &tracing::field::display("server_error"));
            span.record("otel.status_code", &tracing::field::display("ERROR"));

            // Log the error within the span context
            error!("Unhandled internal server error occurred");
        }
    } else {
        // No span available, just log the error
        error!("Internal server error occurred (no span context available)");
    }

    // Return a friendly error page
    Template::render(
        "error",
        context! {
            title: "Server Error - Jiu Jitsu Syllabus Tracker",
            error_code: 500,
            error_message: "An unexpected error occurred. Please try again later."
        },
    )
}
