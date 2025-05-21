use opentelemetry_semantic_conventions::{attribute::OTEL_STATUS_CODE, trace::ERROR_TYPE};
use rocket::http::Status;
use thiserror::Error;
use tracing::{Span, error, warn};

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

// Enhance AppError in src/error.rs
impl AppError {
    pub fn log_and_record(&self, ctx: &str) {
        let current_span = Span::current();
        let is_valid_span = !current_span.is_none();

        let message = self.to_string();
        let error_kind = match self {
            AppError::Database(err) => {
                error!(error = %message, context = %ctx, db_error = %err, "Database error");
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
            current_span.record("error", tracing::field::display(true));
            current_span.record(ERROR_TYPE, tracing::field::display(error_kind));
            current_span.record("error.message", tracing::field::display(&message));

            match self {
                AppError::Database(_) | AppError::Internal(_) | AppError::ExternalService(_) => {
                    current_span.record(OTEL_STATUS_CODE, tracing::field::display("ERROR"));
                }
                _ => {}
            }
        }
    }

    pub fn status_code(&self) -> Status {
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

    pub fn to_status_with_log(&self, context: &str) -> Status {
        self.log_and_record(context);
        self.status_code()
    }
}

impl<'r> rocket::response::Responder<'r, 'static> for AppError {
    fn respond_to(self, req: &'r rocket::Request<'_>) -> rocket::response::Result<'static> {
        self.to_status_with_log(&format!("Request to {} {}", req.method(), req.uri()))
            .respond_to(req)
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

impl From<sqlx::migrate::MigrateError> for AppError {
    fn from(error: sqlx::migrate::MigrateError) -> Self {
        AppError::Internal(format!("Migration error: {}", error))
    }
}

impl From<AppError> for Status {
    fn from(err: AppError) -> Self {
        err.to_status_with_log("Error conversion into Status")
    }
}
