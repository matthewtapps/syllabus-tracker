use rocket::form::Form;
use rocket::http::{Cookie, CookieJar, SameSite, Status};
use rocket::request::{FromRequest, Outcome};
use rocket::response::Redirect;
use rocket::{Request, State};
use rocket_dyn_templates::{Template, context};
use sqlx::{Pool, Sqlite, SqlitePool};
use tracing::info;

use crate::db::{authenticate_user, create_user, get_user_by_username};

use super::User;

#[rocket::async_trait]
impl<'r> FromRequest<'r> for User {
    type Error = ();

    async fn from_request(request: &'r Request<'_>) -> Outcome<Self, Self::Error> {
        let auth_span = tracing::info_span!("user_auth_guard");

        let _guard = auth_span.enter();

        let cookies = request.cookies();

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
                .state::<SqlitePool>()
                .expect("Database pool not found in managed state");

            if let Some(timestamp_cookie) = cookies.get_private("session_timestamp") {
                if let Ok(timestamp) = timestamp_cookie.value().parse::<i64>() {
                    use rocket::time::{Duration, OffsetDateTime};

                    let session_time = OffsetDateTime::from_unix_timestamp(timestamp).ok();
                    let current_time = OffsetDateTime::now_utc();

                    if let Some(session_time) = session_time {
                        let elapsed = current_time - session_time;
                        if elapsed > Duration::hours(1) {
                            warn!(username, "Session expired");
                            return Outcome::Forward(Status::Unauthorized);
                        }
                    }
                }
            }

            match get_user_by_username(db, &username).await {
                Ok(user) => {
                    info!(username, role = user.role, "User authenticated");
                    Outcome::Success(user)
                }
                Err(err) => {
                    error!(username, error = ?err, "Database error fetching user");

                    Outcome::Success(User {
                        id,
                        username,
                        role,
                        display_name: String::new(),
                    })
                }
            }
        } else {
            warn!("No logged_in cookie found");
            Outcome::Forward(Status::Unauthorized)
        }
    }
}

#[get("/login?<username>&<error>")]
pub fn login(username: Option<String>, error: Option<String>) -> Template {
    Template::render(
        "login",
        context! {
            title: "Login - Jiu Jitsu Syllabus Tracker",
            username: username.unwrap_or_default(),
            error: error,
            current_route: "login"
        },
    )
}

#[post("/login", data = "<form>")]
pub async fn process_login(
    form: Form<LoginForm>,
    cookies: &CookieJar<'_>,
    db: &State<Pool<Sqlite>>,
) -> Result<Redirect, Status> {
    let message = format!("Login attempt: {}", &form.username);
    info!(message = message, username = &form.username);

    match authenticate_user(db, &form.username, &form.password).await {
        Ok(true) => {
            info!(username = %form.username, "Authentication successful");

            let cookie = Cookie::build(("logged_in", form.username.clone()))
                .same_site(SameSite::Lax)
                .max_age(rocket::time::Duration::hours(1));
            cookies.add_private(cookie);

            let current_timestamp = rocket::time::OffsetDateTime::now_utc()
                .unix_timestamp()
                .to_string();
            cookies.add_private(
                Cookie::build(("session_timestamp", current_timestamp))
                    .same_site(SameSite::Lax)
                    .max_age(rocket::time::Duration::hours(1)),
            );

            if let Ok(user) = get_user_by_username(db, &form.username).await {
                cookies.add_private(
                    Cookie::build(("user_role", user.role))
                        .same_site(SameSite::Lax)
                        .max_age(rocket::time::Duration::hours(1)),
                );
                cookies.add_private(
                    Cookie::build(("user_id", user.id.to_string()))
                        .same_site(SameSite::Lax)
                        .max_age(rocket::time::Duration::hours(1)),
                );
            }

            Ok(Redirect::to("/"))
        }
        _ => {
            warn!(username = %form.username, "Authentication failed");

            let encoded_username = urlencoding::encode(&form.username);

            let error_uri = format!(
                "/login?username={}&error=Invalid%20username%20or%20password",
                encoded_username
            );

            Ok(Redirect::to(error_uri))
        }
    }
}

#[get("/logout")]
pub fn logout(cookies: &CookieJar<'_>) -> Redirect {
    cookies.remove_private(Cookie::build("logged_in"));
    cookies.remove_private(Cookie::build("user_role"));
    cookies.remove_private(Cookie::build("user_id"));
    cookies.remove_private(Cookie::build("session_timestamp"));
    cookies.remove_private(Cookie::build("otel_session_id"));
    Redirect::to("/login")
}

#[derive(FromForm)]
pub struct LoginForm {
    username: String,
    password: String,
}

#[rocket::get("/register")]
pub fn register(user: User) -> Result<Template, Redirect> {
    if user.role != "coach" {
        return Err(Redirect::to("/"));
    }

    Ok(Template::render(
        "register",
        context! {
            title: "Register New User - Jiu Jitsu Syllabus Tracker",
            current_route: "register",
            current_user: user,
        },
    ))
}

#[derive(FromForm)]
pub struct RegisterForm {
    username: String,
    password: String,
    role: String,
}

#[post("/register", data = "<form>")]
pub async fn process_register(
    user: User,
    form: Form<RegisterForm>,
    db: &State<Pool<Sqlite>>,
) -> Result<Redirect, Redirect> {
    if user.role != "coach" {
        return Err(Redirect::to("/"));
    }

    match create_user(db, &form.username, &form.password, &form.role).await {
        Ok(_) => Ok(Redirect::to("/")),
        Err(_) => Err(Redirect::to("/register?error=Registration%20failed")),
    }
}

#[catch(401)]
pub fn unauthorized(_req: &Request) -> Redirect {
    warn!("Unauthorized access attempt");
    Redirect::to(uri!("/login"))
}

#[catch(403)]
pub fn forbidden(_req: &Request) -> Redirect {
    warn!("Forbidden access attempt");
    Redirect::to(uri!("/login"))
}
