use rocket::form::Form;
use rocket::http::{Cookie, CookieJar, SameSite};
use rocket::response::Redirect;
use rocket::time::{Duration, OffsetDateTime};
use rocket::{Build, Request, Rocket, Route, State};
use rocket_airlock::{Airlock, Hatch, Result as HatchResult};
use rocket_dyn_templates::{Template, context};
use sqlx::{Pool, Sqlite};
use tracing::{info, instrument};

use crate::db::{authenticate_user, create_user, get_user_by_username};
use crate::telemetry::TracingSpan;

use super::User;

#[derive(Debug)]
pub struct JiuJitsuHatch {}

impl JiuJitsuHatch {
    #[instrument]
    pub async fn authenticate_user(
        &self,
        db: &State<Pool<Sqlite>>,
        username: &str,
        password: &str,
    ) -> bool {
        authenticate_user(db, username, password).await.unwrap()
    }

    #[instrument]
    pub async fn is_session_expired(&self, _username: &str, cookies: &CookieJar<'_>) -> bool {
        if let Some(timestamp_cookie) = cookies.get_private("session_timestamp") {
            if let Ok(timestamp) = timestamp_cookie.value().parse::<i64>() {
                // Check if the timestamp is older than 1 hour
                let session_time = OffsetDateTime::from_unix_timestamp(timestamp).ok();
                let current_time = OffsetDateTime::now_utc();

                if let Some(session_time) = session_time {
                    let elapsed = current_time - session_time;
                    return elapsed > Duration::hours(1);
                }
            }
        }

        // If we can't parse the timestamp or it doesn't exist, consider session expired
        true
    }
}

#[rocket::async_trait]
impl Hatch for JiuJitsuHatch {
    type Comm = ();
    type Error = crate::Error;

    fn comm(&self) -> &Self::Comm {
        &()
    }

    fn name() -> &'static str {
        "JiuJitsu"
    }

    fn routes() -> Vec<Route> {
        routes![]
    }

    async fn from(rocket: Rocket<Build>) -> HatchResult<JiuJitsuHatch, Self::Error> {
        Ok((rocket, JiuJitsuHatch {}))
    }
}

#[get("/login?<username>&<error>")]
pub fn login(span: TracingSpan, username: Option<String>, error: Option<String>) -> Template {
    span.in_scope(|| {
        Template::render(
            "login",
            context! {
                title: "Login - Jiu Jitsu Syllabus Tracker",
                username: username.unwrap_or_default(),
                error: error,
                current_route: "login"
            },
        )
    })
}

#[post("/login", data = "<form>")]
pub async fn process_login(
    span: TracingSpan,
    airlock: Airlock<JiuJitsuHatch>,
    form: Form<LoginForm>,
    cookies: &CookieJar<'_>,
    db: &State<Pool<Sqlite>>,
) -> Result<Redirect, Redirect> {
    span.in_scope_async(|| async {
        let message = format!("Login attempt: {}", &form.username);
        info!(message = message, username = &form.username);

        match airlock
            .hatch
            .authenticate_user(db, &form.username, &form.password)
            .await
        {
            true => {
                let message = format!("Authentication successful for {}", &form.username);
                info!(message = message);

                let cookie = Cookie::build(("logged_in", form.username.clone()))
                    .same_site(SameSite::Lax)
                    .max_age(Duration::hours(1));
                cookies.add_private(cookie);

                let current_timestamp = OffsetDateTime::now_utc().unix_timestamp().to_string();
                cookies.add_private(
                    Cookie::build(("session_timestamp", current_timestamp))
                        .same_site(SameSite::Lax)
                        .max_age(Duration::hours(1)),
                );

                // Store user role in a separate cookie for role-based access
                if let Ok(user) = get_user_by_username(db, &form.username).await {
                    cookies.add_private(
                        Cookie::build(("user_role", user.role))
                            .same_site(SameSite::Lax)
                            .max_age(Duration::hours(1)),
                    );
                    cookies.add_private(
                        Cookie::build(("user_id", user.id.to_string()))
                            .same_site(SameSite::Lax)
                            .max_age(Duration::hours(1)),
                    );
                }

                Ok(Redirect::to("/"))
            }
            _ => Err(Redirect::to(format!(
                "/login?username={}&error=Invalid%20username%20or%20password",
                form.username
            ))),
        }
    })
    .await
}

#[get("/logout")]
pub fn logout(span: TracingSpan, cookies: &CookieJar<'_>) -> Redirect {
    span.in_scope(|| {
        cookies.remove_private(Cookie::build("logged_in"));
        cookies.remove_private(Cookie::build("user_role"));
        cookies.remove_private(Cookie::build("user_id"));
        cookies.remove_private(Cookie::build("session_timestamp"));
        cookies.remove_private(Cookie::build("otel_session_id"));
        Redirect::to("/login")
    })
}

#[derive(FromForm)]
pub struct LoginForm {
    username: String,
    password: String,
}

// Registration routes - only coaches can register new users
#[rocket::get("/register")]
pub fn register(span: TracingSpan, user: User) -> Result<Template, Redirect> {
    span.in_scope(|| {
        // Check if user is a coach
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
    })
}

#[derive(FromForm)]
pub struct RegisterForm {
    username: String,
    password: String,
    role: String,
}

#[post("/register", data = "<form>")]
pub async fn process_register(
    span: TracingSpan,
    user: User,
    form: Form<RegisterForm>,
    db: &State<Pool<Sqlite>>,
) -> Result<Redirect, Redirect> {
    span.in_scope_async(|| async {
        // Check if user is a coach
        if user.role != "coach" {
            return Err(Redirect::to("/"));
        }

        match create_user(db, &form.username, &form.password, &form.role).await {
            Ok(_) => Ok(Redirect::to("/")),
            Err(_) => Err(Redirect::to("/register?error=Registration%20failed")),
        }
    })
    .await
}

#[catch(401)]
pub fn unauthorized(_req: &Request) -> Redirect {
    Redirect::to(uri!("/login"))
}

#[catch(403)]
pub fn forbidden(_req: &Request) -> Redirect {
    Redirect::to(uri!("/login"))
}
