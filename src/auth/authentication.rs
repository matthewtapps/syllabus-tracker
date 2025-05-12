use chrono::Utc;
use rocket::form::{Contextual, Form};
use rocket::http::{Cookie, CookieJar, SameSite, Status};
use rocket::request::{FromRequest, Outcome};
use rocket::response::Redirect;
use rocket::{Request, State};
use rocket_dyn_templates::{Template, context};
use sqlx::{Pool, Sqlite, SqlitePool};
use tracing::info;

use crate::auth::UserSession;
use crate::db::{
    authenticate_user, create_user, create_user_session, get_session_by_token, get_user,
    get_user_by_username, invalidate_session,
};
use crate::error::AppError;

use super::{Permission, User};

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

            let user = get_user_by_username(db, form_value.username)
                .await
                .map_err(|e| e.status_code())?;

            let token = UserSession::generate_token();
            let expires_at = Utc::now() + chrono::Duration::hours(1);

            create_user_session(db, user.id, &token, expires_at.naive_utc())
                .await
                .map_err(|e| e.status_code())?;

            let cookie = Cookie::build(("session_token", token))
                .same_site(SameSite::Lax)
                .http_only(true)
                .max_age(rocket::time::Duration::hours(1));
            cookies.add_private(cookie);

            cookies.add_private(
                Cookie::build(("user_id", user.id.to_string()))
                    .same_site(SameSite::Lax)
                    .http_only(true)
                    .max_age(rocket::time::Duration::hours(1)),
            );

            let legacy_cookie = Cookie::build(("logged_in", form_value.username.to_string()))
                .same_site(SameSite::Lax)
                .max_age(rocket::time::Duration::hours(1));
            cookies.add_private(legacy_cookie);

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
pub async fn logout(
    cookies: &CookieJar<'_>,
    _user: Option<User>,
    db: &State<Pool<Sqlite>>,
) -> Redirect {
    if let Some(token_cookie) = cookies.get_private("session_token") {
        let token = token_cookie.value();

        let _ = invalidate_session(db, token).await;
    }

    cookies.remove_private(Cookie::build("session_token"));
    cookies.remove_private(Cookie::build("user_id"));
    cookies.remove_private(Cookie::build("logged_in"));
    cookies.remove_private(Cookie::build("user_role"));
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
#[allow(dead_code)]
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
