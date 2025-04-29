use rocket::{
    Request,
    http::Status,
    request::{FromRequest, Outcome},
};
use rocket_airlock::Airlock;
use serde::Serialize;
use tracing::{Instrument, info_span};

use crate::{auth::JiuJitsuHatch, db::get_user_by_username};

#[derive(Debug, Serialize, Clone)]
pub struct User {
    pub id: i64,
    pub username: String,
    pub role: String,
    pub display_name: String,
}

#[derive(sqlx::FromRow, Clone)]
pub struct DbUser {
    pub id: Option<i64>,
    pub username: Option<String>,
    pub role: Option<String>,
    pub display_name: Option<String>,
}

impl From<DbUser> for User {
    fn from(user: DbUser) -> Self {
        Self {
            id: user.id.unwrap_or_default(),
            username: user.username.unwrap_or_default(),
            role: user.role.unwrap_or_default(),
            display_name: user.display_name.unwrap_or_default(),
        }
    }
}

#[rocket::async_trait]
impl<'r> FromRequest<'r> for User {
    type Error = ();

    async fn from_request(request: &'r Request<'_>) -> Outcome<Self, Self::Error> {
        let cookies = request.cookies();

        let auth_span = info_span!("user_auth_guard",);

        async move {
            if let Some(logged_in) = cookies.get_private("logged_in") {
                let username = logged_in.value().to_string();
                let role = cookies
                    .get_private("user_role")
                    .map(|c| c.value().to_string())
                    .unwrap_or_else(|| "student".to_string());
                let id = cookies
                    .get_private("user_id")
                    .and_then(|c| c.value().parse::<i64>().ok())
                    .unwrap_or_default();

                let db = request
                    .rocket()
                    .state::<sqlx::Pool<sqlx::Sqlite>>()
                    .expect("Database pool not found in managed state");

                match get_user_by_username(db, &username).await {
                    Ok(user) => {
                        // Check if session is expired
                        let hatch = request
                            .guard::<Airlock<JiuJitsuHatch>>()
                            .await
                            .expect("Hatch 'JiuJitsuHatch' was not installed into the airlock.")
                            .hatch;

                        if hatch.is_session_expired(&username).await {
                            return Outcome::Forward(Status::Unauthorized);
                        }

                        Outcome::Success(user)
                    }
                    Err(_) => {
                        // Fallback to basic user info
                        Outcome::Success(User {
                            id,
                            username,
                            role,
                            display_name: String::new(),
                        })
                    }
                }
            } else {
                Outcome::Forward(Status::Unauthorized)
            }
        }
        .instrument(auth_span)
        .await
    }
}
