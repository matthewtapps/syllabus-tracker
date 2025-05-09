#[macro_use]
extern crate rocket;

mod auth;
mod db;
mod error;
mod models;
mod routes;
mod telemetry;

use auth::{forbidden, login, logout, process_login, process_register, register, unauthorized};
use error::{AppError, internal_server_error};
use rocket::fs::FileServer;
use rocket_dyn_templates::Template;
use rocket_dyn_templates::handlebars::Context;
use rocket_dyn_templates::handlebars::Handlebars;
use rocket_dyn_templates::handlebars::Helper;
use rocket_dyn_templates::handlebars::Output;
use rocket_dyn_templates::handlebars::RenderContext;
use telemetry::TelemetryFairing;
use telemetry::init_tracing;
use thiserror::Error;

use routes::{
    add_multiple_techniques_to_student, add_technique_to_student,
    create_and_assign_technique_route, index, index_anon, profile, student_techniques, update_name,
    update_password, update_student_technique_route, update_username_route,
};
use sqlx::SqlitePool;
use tracing::info;

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
    #[error("Application error: {0}")]
    App(#[from] AppError),
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
    init_tracing();

    let database_url = std::env::var("DATABASE_URL").unwrap_or_default();

    let pool = SqlitePool::connect(&database_url)
        .await
        .expect("Failed to connect to SQLite database");

    info!("Starting syllabus tracker");

    rocket::build()
        .manage(pool)
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
        .mount("/static", FileServer::new("static"))
        .register(
            "/",
            catchers![unauthorized, forbidden, internal_server_error],
        )
        .attach(TelemetryFairing)
        .attach(Template::custom(|engines| {
            let honeycomb_api_key = std::env::var("HONEYCOMB_API_KEY").unwrap_or_default();

            engines.handlebars.register_helper(
                "honeycomb_api_key",
                Box::new(
                    move |_h: &Helper,
                          _: &Handlebars,
                          _: &Context,
                          _: &mut RenderContext,
                          out: &mut dyn Output| {
                        out.write(&honeycomb_api_key)?;
                        Ok(())
                    },
                ),
            );
        }))
}
