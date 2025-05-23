use crate::error::AppError;
use rocket::response::status::Custom;
use rocket::serde::json::Json;
use rocket::{State, http::Status};
use serde::{Deserialize, Serialize};
use sqlx::{Pool, Sqlite};
use std::collections::HashMap;
use tracing::instrument;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ValidationResponse {
    pub status: &'static str,
    pub errors: HashMap<String, Vec<String>>,
}

impl ValidationResponse {
    pub fn new(errors: HashMap<String, Vec<String>>) -> Self {
        Self {
            status: "error",
            errors,
        }
    }

    pub fn with_error(field: &str, message: &str) -> Self {
        let mut errors = HashMap::new();
        errors.insert(field.to_string(), vec![message.to_string()]);
        Self::new(errors)
    }
}

pub trait ToValidationResponse {
    fn to_validation_response(self) -> Custom<Json<ValidationResponse>>;
}

impl ToValidationResponse for AppError {
    #[instrument]
    fn to_validation_response(self) -> Custom<Json<ValidationResponse>> {
        self.log_and_record("API Validation Error");
        let status = self.status_code();

        let (field, message) = match &self {
            AppError::Database(db_err) => ("database", format!("Database error: {}", db_err)),
            AppError::Authentication(msg) => {
                ("authentication", format!("Authentication error: {}", msg))
            }
            AppError::Authorization(msg) => {
                ("authorization", format!("Permission denied: {}", msg))
            }
            AppError::NotFound(msg) => ("resource", format!("Not found: {}", msg)),
            AppError::ExternalService(msg) => ("service", format!("Service error: {}", msg)),
            AppError::Internal(_) => ("server", "Internal server error".to_string()),
        };

        Custom(
            status,
            Json(ValidationResponse::with_error(field, &message)),
        )
    }
}

impl ToValidationResponse for Status {
    #[instrument]
    fn to_validation_response(self) -> Custom<Json<ValidationResponse>> {
        let (field, message) = match self {
            Status::Forbidden => (
                "permission",
                "You don't have permission to perform this action",
            ),
            Status::Unauthorized => ("authentication", "Authentication required"),
            Status::NotFound => ("resource", "Resource not found"),
            Status::Conflict => ("resource", "Resource already exists"),
            Status::BadRequest => ("request", "Bad request"),
            Status::UnprocessableEntity => ("validation", "Validation failed"),
            Status::InternalServerError => ("server", "Internal server error"),
            Status::ServiceUnavailable => ("service", "Service unavailable"),
            _ => ("error", "An error occurred"),
        };

        Custom(self, Json(ValidationResponse::with_error(field, message)))
    }
}

#[derive(Debug)]
pub struct ValidationErrorWrapper(pub validator::ValidationErrors);
pub struct AppErrorWrapper(pub AppError);

impl From<ValidationErrorWrapper> for Custom<Json<ValidationResponse>> {
    #[instrument]
    fn from(wrapper: ValidationErrorWrapper) -> Self {
        let errors = wrapper.0;
        let mut error_map = HashMap::new();

        for (field, field_errors) in errors.field_errors() {
            let error_messages: Vec<String> = field_errors
                .iter()
                .map(|error| {
                    error
                        .message
                        .clone()
                        .unwrap_or_else(|| "Invalid value".into())
                        .to_string()
                })
                .collect();

            error_map.insert(field.to_string(), error_messages);
        }

        Custom(
            Status::UnprocessableEntity,
            Json(ValidationResponse::new(error_map)),
        )
    }
}

impl From<AppErrorWrapper> for Custom<Json<ValidationResponse>> {
    fn from(wrapper: AppErrorWrapper) -> Self {
        wrapper.0.to_validation_response()
    }
}

pub struct ValidationContext<'a> {
    pub db: &'a State<Pool<Sqlite>>,
}
