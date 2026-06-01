use rocket::Request;
use rocket::http::Status;
use rocket::request::{FromRequest, Outcome};
use rocket::response::Redirect;
use rocket::response::status::Custom;
use rocket::serde::json::Json;
use serde_json::{Value, json};
use sqlx::SqlitePool;

use crate::db::{extend_session_expiry, get_session_by_token, get_user};

use super::{User, UserSession};

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

                    // Sliding refresh: if the session has used more than half
                    // its lifetime, push expiry back out so active users don't
                    // get logged out mid-session. Cookies use private
                    // (encrypted, server-issued) tokens so we re-emit them
                    // with the same token + a fresh max_age.
                    let now = chrono::Utc::now().naive_utc();
                    let lifetime = chrono::Duration::days(UserSession::LIFETIME_DAYS);
                    let remaining = session.expires_at.signed_duration_since(now);
                    if remaining < lifetime / 2 {
                        let new_expiry = now + lifetime;
                        if let Err(err) = extend_session_expiry(db, &token, new_expiry).await {
                            tracing::warn!(error = ?err, "Failed to slide session expiry");
                        } else {
                            use rocket::http::{Cookie, SameSite};
                            let max_age = rocket::time::Duration::days(UserSession::LIFETIME_DAYS);
                            cookies.add_private(
                                Cookie::build(("session_token", token.clone()))
                                    .same_site(SameSite::Lax)
                                    .http_only(true)
                                    .max_age(max_age),
                            );
                        }
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
pub fn unauthorized_api(_req: &Request) -> Result<Redirect, Custom<Json<Value>>> {
    let error_json = json!({
        "error": "Unauthorized",
        "message": "Authentication required"
    });

    Err(Custom(Status::Unauthorized, Json(error_json)))
}
