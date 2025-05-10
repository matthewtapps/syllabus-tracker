use rocket::form::{Contextual, Form};
use rocket::http::{Cookie, CookieJar, SameSite, Status};
use rocket::request::{FromRequest, Outcome};
use rocket::response::Redirect;
use rocket::{Request, State};
use rocket_dyn_templates::{Template, context};
use sqlx::{Pool, Sqlite, SqlitePool};
use tracing::info;

use crate::db::{authenticate_user, create_user, get_user_by_username};
use crate::error::AppError;

use super::{Permission, User};

#[rocket::async_trait]
impl<'r> FromRequest<'r> for User {
    type Error = ();

    async fn from_request(request: &'r Request<'_>) -> Outcome<Self, Self::Error> {
        let auth_span = tracing::info_span!("user_auth_guard");
        let _guard = auth_span.enter();

        let cookies = request.cookies();

        let username = match cookies.get_private("logged_in") {
            Some(cookie) => cookie.value().to_string(),
            _ => {
                tracing::info!("No logged_in cookie found");
                return Outcome::Forward(Status::Unauthorized);
            }
        };

        let db = match request.rocket().state::<SqlitePool>() {
            Some(pool) => pool,
            _ => {
                tracing::error!("Database pool not found in managed state");
                return Outcome::Error((Status::InternalServerError, ()));
            }
        };

        if let Some(timestamp_cookie) = cookies.get_private("session_timestamp") {
            if let Ok(timestamp) = timestamp_cookie.value().parse::<i64>() {
                use rocket::time::{Duration, OffsetDateTime};
                if let Ok(session_time) = OffsetDateTime::from_unix_timestamp(timestamp) {
                    let current_time = OffsetDateTime::now_utc();
                    let elapsed = current_time - session_time;

                    if elapsed > Duration::hours(1) {
                        tracing::warn!(username = %username, "Session expired");
                        return Outcome::Forward(Status::Unauthorized);
                    }
                }
            }
        }

        match get_user_by_username(db, &username).await {
            Ok(user) => {
                tracing::info!(username = %username, role = %user.role.as_str(), "User authenticated");
                Outcome::Success(user)
            }
            Err(err) => {
                tracing::error!(username = %username, error = ?err, "Failed to fetch user");

                match err {
                    AppError::NotFound(_) => Outcome::Forward(Status::Unauthorized),
                    _ => Outcome::Error((Status::InternalServerError, ())),
                }
            }
        }
    }
}

#[derive(FromForm)]
pub struct LoginForm<'r> {
    #[field(validate = len(1..).or_else(msg!("Username is required")))]
    username: &'r str,
    #[field(validate = len(1..).or_else(msg!("Password is required")))]
    password: &'r str,
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
pub async fn process_login<'r>(
    form: Form<Contextual<'r, LoginForm<'r>>>,
    cookies: &CookieJar<'_>,
    db: &State<Pool<Sqlite>>,
) -> Result<Redirect, Status> {
    if form.value.is_none() {
        let error_message = form
            .context
            .errors()
            .next()
            .map(|err| err.to_string())
            .unwrap_or_else(|| "Validation failed".to_string());

        let username = form.context.field_value("username").unwrap_or_default();

        return Ok(Redirect::to(uri!(login(
            Some(username),
            Some(&error_message)
        ))));
    }

    let form_value = form.value.as_ref().unwrap();

    let message = format!("Login attempt: {}", form_value.username);
    info!(message = message, username = form_value.username);

    match authenticate_user(db, form_value.username, form_value.password).await {
        Ok(true) => {
            info!(username = %form_value.username, "Authentication successful");

            let cookie = Cookie::build(("logged_in", form_value.username.to_string()))
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

            if let Ok(user) = get_user_by_username(db, form_value.username).await {
                cookies.add_private(
                    Cookie::build(("user_role", user.role.to_string()))
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
            warn!(username = %form_value.username, "Authentication failed");

            Ok(Redirect::to(uri!(login(
                Some(form_value.username),
                Some("Invalid username or password")
            ))))
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

#[get("/register?<err>")]
pub fn register(user: User, err: Option<String>) -> Result<Template, Status> {
    user.require_permission(Permission::RegisterUsers)?;

    Ok(Template::render(
        "register",
        context! {
            title: "Register New User - Jiu Jitsu Syllabus Tracker",
            current_route: "register",
            current_user: user,
            error: err
        },
    ))
}

#[derive(FromForm)]
pub struct RegisterForm<'r> {
    #[field(validate = len(3..30).or_else(msg!("Username must be between 3 and 30 characters")))]
    #[field(validate = omits(' ').or_else(msg!("Username cannot contain spaces")))]
    username: &'r str,
    #[field(validate = len(5..).or_else(msg!("Password must be at least 5 characters")))]
    password: &'r str,
    #[field(validate = eq(self.password).or_else(msg!("Passwords did not match")))]
    confirm_password: &'r str,
    role: &'r str,
}

#[post("/register", data = "<form>")]
pub async fn process_register<'r>(
    user: User,
    form: Form<Contextual<'r, RegisterForm<'r>>>,
    db: &State<Pool<Sqlite>>,
) -> Result<Redirect, Status> {
    user.require_permission(Permission::RegisterUsers)?;

    if form.value.is_none() {
        let error_message = form
            .context
            .errors()
            .next()
            .map(|err| err.to_string())
            .unwrap_or_else(|| "Validation failed".to_string());

        return Ok(Redirect::to(uri!(register(Some(&error_message)))));
    }

    let form_value = form.value.as_ref().unwrap();

    match create_user(
        db,
        form_value.username,
        form_value.password,
        form_value.role,
    )
    .await
    {
        Ok(_) => Ok(Redirect::to("/")),
        Err(err) => {
            err.log_and_record("User registration");

            if let AppError::Validation(msg) = &err {
                Ok(Redirect::to(uri!(register(Some(msg)))))
            } else {
                // For all other errors, return the appropriate status code
                Err(err.status_code())
            }
        }
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
