#[macro_use]
extern crate rocket;

mod auth;
mod db;
mod models;
mod routes;
mod telemetry;

use auth::{
    JiuJitsuHatch, forbidden, login, logout, process_login, process_register, register,
    unauthorized,
};
use once_cell::sync::Lazy;
use rocket_airlock::Airlock;
use rocket_dyn_templates::Template;
use std::sync::Arc;
use std::sync::Mutex;
use std::sync::Once;
use telemetry::TelemetryFairing;
use telemetry::init_honeycomb_telemetry;
use thiserror::Error;

use routes::{
    add_multiple_techniques_to_student, add_technique_to_student,
    create_and_assign_technique_route, index, index_anon, profile, student_techniques, update_name,
    update_password, update_student_technique_route, update_username_route,
};
use sqlx::SqlitePool;

#[cfg(feature = "production")]
static DATABASE_URL: &str = "sqlite:///var/www/syllabus-tracker/data/sqlite.db";

#[cfg(not(feature = "production"))]
static DATABASE_URL: &str = "sqlite://sqlite.db";

static TELEMETRY_INIT: Once = Once::new();
static TELEMETRY_GUARD: Lazy<Arc<Mutex<Option<telemetry::OtelGuard>>>> =
    Lazy::new(|| Arc::new(Mutex::new(None)));

#[derive(Debug, Error)]
pub enum Error {
    #[error("Hatch")]
    Hatch,
    #[error("{0}")]
    Anyhow(anyhow::Error),
    #[error("{0}")]
    Figment(rocket::figment::Error),
    #[error("{0}")]
    Sqlx(#[from] sqlx::Error),
}

impl From<anyhow::Error> for Error {
    fn from(value: anyhow::Error) -> Self {
        Error::Anyhow(value)
    }
}

impl From<rocket::figment::Error> for Error {
    fn from(value: rocket::figment::Error) -> Self {
        Error::Figment(value)
    }
}

#[launch]
async fn rocket() -> _ {
    TELEMETRY_INIT.call_once(|| {
        let guard = init_honeycomb_telemetry();
        // Store the guard in the static variable
        *TELEMETRY_GUARD.lock().unwrap() = Some(guard);
    });

    let pool = SqlitePool::connect(DATABASE_URL)
        .await
        .expect("Failed to connect to SQLite database");

    tracing::info!("Starting syllabus tracker");

    rocket::build()
        .mount(
            "/",
            routes![
                index,
                index_anon,
                student_techniques,
                update_student_technique_route,
                add_technique_to_student,
                add_multiple_techniques_to_student,
                create_and_assign_technique_route,
                login,
                process_login,
                logout,
                register,
                process_register,
                profile,
                update_name,
                update_password,
                update_username_route
            ],
        )
        .register("/", catchers![unauthorized, forbidden])
        .manage(pool)
        .attach(TelemetryFairing)
        .attach(Template::fairing())
        .attach(Airlock::<JiuJitsuHatch>::fairing())
        .attach(rocket::fairing::AdHoc::on_shutdown(
            "Telemetry Shutdown",
            |_| {
                Box::pin(async {
                    telemetry::shutdown_telemetry();
                })
            },
        ))
}
