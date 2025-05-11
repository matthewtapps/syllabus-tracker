use rocket::State;
use rocket::fs::NamedFile;
use rocket::http::{Cookie, CookieJar, SameSite, Status};
use rocket::serde::{Deserialize, Serialize, json::Json};
use sqlx::{Pool, Sqlite};

use crate::auth::User;
use crate::db::{authenticate_user, get_user_by_username};

#[derive(Deserialize)]
pub struct LoginRequest {
    username: String,
    password: String,
}

#[derive(Serialize)]
pub struct LoginResponse {
    success: bool,
    user: Option<UserData>,
    error: Option<String>,
    redirect_url: Option<String>,
}

#[derive(Serialize)]
pub struct UserData {
    id: i64,
    username: String,
    display_name: String,
    role: String,
}

impl From<User> for UserData {
    fn from(user: User) -> Self {
        Self {
            id: user.id,
            username: user.username.clone(),
            display_name: user.display_name.clone(),
            role: user.role.to_string(),
        }
    }
}

#[post("/login", data = "<login>")]
pub async fn api_login(
    login: Json<LoginRequest>,
    cookies: &CookieJar<'_>,
    db: &State<Pool<Sqlite>>,
) -> Json<LoginResponse> {
    match authenticate_user(db, &login.username, &login.password).await {
        Ok(true) => match get_user_by_username(db, &login.username).await {
            Ok(user) => {
                let current_timestamp = rocket::time::OffsetDateTime::now_utc()
                    .unix_timestamp()
                    .to_string();

                cookies.add_private(
                    Cookie::build(("logged_in", login.username.clone()))
                        .same_site(SameSite::Lax)
                        .max_age(rocket::time::Duration::hours(1)),
                );

                cookies.add_private(
                    Cookie::build(("session_timestamp", current_timestamp))
                        .same_site(SameSite::Lax)
                        .max_age(rocket::time::Duration::hours(1)),
                );

                cookies.add_private(
                    Cookie::build(("user_role", user.role.to_string()))
                        .same_site(SameSite::Lax)
                        .max_age(rocket::time::Duration::hours(1)),
                );

                let redirect_url = match user.role.as_str() {
                    "student" => format!("/student/{}", user.id),
                    _ => "/".to_string(),
                };

                Json(LoginResponse {
                    success: true,
                    user: Some(UserData::from(user)),
                    error: None,
                    redirect_url: Some(redirect_url),
                })
            }
            Err(_) => Json(LoginResponse {
                success: false,
                user: None,
                error: Some("User not found".to_string()),
                redirect_url: None,
            }),
        },
        _ => Json(LoginResponse {
            success: false,
            user: None,
            error: Some("Invalid username or password".to_string()),
            redirect_url: None,
        }),
    }
}

#[get("/me")]
pub async fn api_me(user: User) -> Json<UserData> {
    Json(UserData::from(user))
}

#[get("/me", rank = 2)]
pub async fn api_me_unauthorized() -> Status {
    Status::Unauthorized
}

#[get("/")]
pub async fn serve_spa_index() -> Option<NamedFile> {
    NamedFile::open("./frontend/dist/index.html").await.ok()
}
