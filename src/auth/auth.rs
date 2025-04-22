use rocket::form::Form;
use rocket::http::{Cookie, CookieJar, SameSite};
use rocket::response::Redirect;
use rocket::{Build, Request, Rocket, Route};
use rocket_airlock::{Airlock, Hatch, Result as HatchResult};
use rocket_dyn_templates::{Template, context};

use crate::db;

use super::User;

pub struct JiuJitsuHatch {}

impl JiuJitsuHatch {
    pub async fn authenticate_user(&self, username: &str, password: &str) -> bool {
        match db::authenticate_user(username, password).await {
            Ok(success) => success,
            Err(e) => {
                error!("Authentication error: {:?}", e);
                false
            }
        }
    }

    pub async fn is_session_expired(&self, _username: &str) -> bool {
        // For now, we'll assume sessions don't expire
        false
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
    airlock: Airlock<JiuJitsuHatch>,
    form: Form<LoginForm>,
    cookies: &CookieJar<'_>,
) -> Result<Redirect, Redirect> {
    info!("Login attempt: {}", &form.username);

    match airlock
        .hatch
        .authenticate_user(&form.username, &form.password)
        .await
    {
        true => {
            info!("Authentication successful for {}", &form.username);
            cookies.add_private(
                Cookie::build(("logged_in", form.username.clone())).same_site(SameSite::Lax),
            );

            // Store user role in a separate cookie for role-based access
            if let Ok(user) = db::get_user_by_username(&form.username).await {
                cookies
                    .add_private(Cookie::build(("user_role", user.role)).same_site(SameSite::Lax));
                cookies.add_private(
                    Cookie::build(("user_id", user.id.to_string())).same_site(SameSite::Lax),
                );
            }

            Ok(Redirect::to("/"))
        }
        _ => Err(Redirect::to(format!(
            "/login?username={}&error=Invalid%20username%20or%20password",
            form.username
        ))),
    }
}

#[get("/logout")]
pub fn logout(cookies: &CookieJar<'_>) -> Redirect {
    cookies.remove_private(Cookie::build("logged_in"));
    cookies.remove_private(Cookie::build("user_role"));
    cookies.remove_private(Cookie::build("user_id"));
    Redirect::to("/login")
}

#[derive(FromForm)]
pub struct LoginForm {
    username: String,
    password: String,
}

// Registration routes - only coaches can register new users
#[rocket::get("/register")]
pub fn register(user: User) -> Result<Template, Redirect> {
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
}

#[derive(FromForm)]
pub struct RegisterForm {
    username: String,
    password: String,
    role: String,
}

#[post("/register", data = "<form>")]
pub async fn process_register(user: User, form: Form<RegisterForm>) -> Result<Redirect, Redirect> {
    // Check if user is a coach
    if user.role != "coach" {
        return Err(Redirect::to("/"));
    }

    match db::create_user(&form.username, &form.password, &form.role).await {
        Ok(_) => Ok(Redirect::to("/")),
        Err(_) => Err(Redirect::to("/register?error=Registration%20failed")),
    }
}

#[catch(401)]
pub fn unauthorized(_req: &Request) -> Redirect {
    Redirect::to(uri!("/login"))
}

#[catch(403)]
pub fn forbidden(_req: &Request) -> Redirect {
    Redirect::to(uri!("/login"))
}
