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
            current_span.record("error.kind", tracing::field::display(error_kind));
            current_span.record("error.message", tracing::field::display(&message));
            current_span.record("otel.status_code", tracing::field::display("ERROR"));
        }
    }

    pub fn status_code(&self) -> Status {
        match self {
            AppError::Database(_) => Status::InternalServerError,
            AppError::Authentication(_) => Status::Unauthorized,
            AppError::Authorization(_) => Status::Forbidden,
            AppError::NotFound(_) => Status::NotFound,
            AppError::ExternalService(_) => Status::ServiceUnavailable,
            AppError::Internal(_) => Status::InternalServerError,
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

impl From<anyhow::Error> for AppError {
    fn from(error: anyhow::Error) -> Self {
        AppError::Internal(format!("Internal error: {}", error))
    }
}
