#[macro_use]
extern crate rocket;

mod auth;
mod db;
mod models;
mod routes;

use auth::{
    JiuJitsuHatch, forbidden, login, logout, process_login, process_register, register,
    unauthorized,
};
use rocket_airlock::Airlock;
use rocket_dyn_templates::Template;
use thiserror::Error;

use routes::{
    add_multiple_techniques_to_student, add_technique_to_student,
    create_and_assign_technique_route, index, index_anon, profile, student_techniques, update_name,
    update_password, update_student_technique_route, update_username_route,
};
use sqlx::SqlitePool;

static DATABASE_URL: &str = "sqlite://sqlite.db";

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
    let pool = SqlitePool::connect(DATABASE_URL)
        .await
        .expect("Failed to connect to SQLite database");

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
        .attach(Template::fairing())
        .attach(Airlock::<JiuJitsuHatch>::fairing())
}
