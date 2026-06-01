use rocket::Request;
use rocket::http::Status;
use rocket::response::status::Custom;
use rocket::serde::json::{Json, Value, json};
use tracing::{error, warn};

/// Common fields we log for every error catcher fire.
fn log_request(req: &Request<'_>, status: Status, label: &str) {
    let method = req.method();
    let uri = req.uri().to_string();
    let remote = req.client_ip().map(|ip| ip.to_string());
    let real_ip = req
        .headers()
        .get_one("X-Real-IP")
        .or_else(|| req.headers().get_one("X-Forwarded-For"));
    let content_type = req.content_type().map(|ct| ct.to_string());
    let content_length = req.headers().get_one("Content-Length");
    let user_agent = req.headers().get_one("User-Agent");
    let referer = req.headers().get_one("Referer");

    if status.code >= 500 {
        error!(
            label,
            status = %status,
            method = %method,
            uri = %uri,
            content_type = content_type.as_deref().unwrap_or("-"),
            content_length = content_length.unwrap_or("-"),
            client_ip = remote.as_deref().unwrap_or("-"),
            forwarded_for = real_ip.unwrap_or("-"),
            user_agent = user_agent.unwrap_or("-"),
            referer = referer.unwrap_or("-"),
            "request failed (catcher)"
        );
    } else {
        warn!(
            label,
            status = %status,
            method = %method,
            uri = %uri,
            content_type = content_type.as_deref().unwrap_or("-"),
            content_length = content_length.unwrap_or("-"),
            client_ip = remote.as_deref().unwrap_or("-"),
            forwarded_for = real_ip.unwrap_or("-"),
            user_agent = user_agent.unwrap_or("-"),
            referer = referer.unwrap_or("-"),
            "request failed (catcher)"
        );
    }
}

fn error_body(status: Status, hint: &str) -> Custom<Json<Value>> {
    Custom(
        status,
        Json(json!({
            "error": status.reason().unwrap_or("Error"),
            "status": status.code,
            "hint": hint,
        })),
    )
}

#[catch(400)]
pub fn bad_request(req: &Request<'_>) -> Custom<Json<Value>> {
    log_request(
        req,
        Status::BadRequest,
        "bad_request: malformed body, missing required form field, or form-parse failure. \
         Wrap the route's Form<T> in Result<Form<T>, FormErrors<'_>> to log the field-level cause.",
    );
    error_body(Status::BadRequest, "The request body could not be parsed.")
}

#[catch(404)]
pub fn not_found(req: &Request<'_>) -> Custom<Json<Value>> {
    // Don't shout about every 404 (scanners hit unknown URLs constantly), but
    // log enough to correlate when something legitimate misroutes.
    log_request(req, Status::NotFound, "not_found");
    error_body(Status::NotFound, "Not found.")
}

#[catch(413)]
pub fn payload_too_large(req: &Request<'_>) -> Custom<Json<Value>> {
    log_request(req, Status::PayloadTooLarge, "payload_too_large");
    error_body(
        Status::PayloadTooLarge,
        "Request body exceeded the configured limit.",
    )
}

#[catch(422)]
pub fn unprocessable_entity(req: &Request<'_>) -> Custom<Json<Value>> {
    log_request(req, Status::UnprocessableEntity, "unprocessable_entity");
    error_body(
        Status::UnprocessableEntity,
        "Validation failed for the supplied payload.",
    )
}

#[catch(500)]
pub fn internal_error(req: &Request<'_>) -> Custom<Json<Value>> {
    log_request(req, Status::InternalServerError, "internal_error");
    error_body(
        Status::InternalServerError,
        "An internal error occurred. Check server logs.",
    )
}

#[catch(default)]
pub fn default_catcher(status: Status, req: &Request<'_>) -> Custom<Json<Value>> {
    log_request(req, status, "default_catcher");
    error_body(status, "Request failed.")
}
