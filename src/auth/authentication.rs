use rocket::Request;
use rocket::http::Status;
use rocket::request::{FromRequest, Outcome};
use rocket::response::Redirect;
use rocket::response::status::Custom;
use rocket::serde::json::Json;
use serde_json::{Value, json};
use sqlx::SqlitePool;

use crate::db::{get_session_by_token, get_user};

use super::User;

#[rocket::async_trait]
impl<'r> FromRequest<'r> for User {
    type Error = ();

    async fn from_request(request: &'r Request<'_>) -> Outcome<Self, Self::Error> {
        let auth_span = tracing::info_span!("user_auth_guard");
        let _guard = auth_span.enter();

        let cookies = request.cookies();

        let token = cookies
            .get_private("session_token")
            .map(|c| c.value().to_string());

        if let Some(token) = token {
            let db = match request.rocket().state::<SqlitePool>() {
                Some(pool) => pool,
                _ => {
                    tracing::error!("Database pool not found in managed state");
                    return Outcome::Error((Status::InternalServerError, ()));
                }
            };

            // Try to get session from token
            match get_session_by_token(db, &token).await {
                Ok(session) => {
                    if !session.is_valid() {
                        tracing::warn!(token = %token, "Session token expired");
                        return Outcome::Forward(Status::Unauthorized);
                    }

                    // Fetch the associated user
                    match get_user(db, session.user_id).await {
                        Ok(user) => {
                            tracing::info!(username = %user.username, role = %user.role.as_str(), "User authenticated via session token");
                            return Outcome::Success(user);
                        }
                        Err(err) => {
                            tracing::error!(user_id = %session.user_id, error = ?err, "Failed to fetch user for valid session");
                            return Outcome::Error((Status::InternalServerError, ()));
                        }
                    }
                }
                Err(err) => {
                    tracing::warn!(token = %token, error = ?err, "Invalid session token");
                    return Outcome::Forward(Status::Unauthorized);
                }
            }
        }

        return Outcome::Error((Status::Unauthorized, ()));
    }
}

#[catch(401)]
pub fn unauthorized(_req: &Request) -> Redirect {
    warn!("Unauthorized access attempt");
    Redirect::to(uri!("/login"))
}

#[catch(401)]
pub fn unauthorized_api(_req: &Request) -> Result<Redirect, Custom<Json<Value>>> {
    let error_json = json!({
        "error": "Unauthorized",
        "message": "Authentication required"
    });

    Err(Custom(Status::Unauthorized, Json(error_json)))
}

#[catch(403)]
pub fn forbidden(_req: &Request) -> Redirect {
    warn!("Forbidden access attempt");
    Redirect::to(uri!("/login"))
}
