// main.rs
#[macro_use]
extern crate rocket;

mod db;
mod models;
mod routes;

use rocket_dyn_templates::Template;

use routes::{
    add_multiple_techniques_to_student, add_technique_to_student,
    create_and_assign_technique_route, index, student_techniques, update_student_technique_route,
};
use sqlx::SqlitePool;

static DATABASE_URL: &str = "sqlite://sqlite.db";

#[launch]
async fn rocket() -> _ {
    let pool = SqlitePool::connect(DATABASE_URL)
        .await
        .expect("Failed to connect to SQLite database");

    let figment = rocket::Config::figment()
        .merge(("address", "0.0.0.0"))
        .merge(("port", 8000));

    rocket::custom(figment)
        .mount(
            "/",
            routes![
                index,
                student_techniques,
                update_student_technique_route,
                add_technique_to_student,
                add_multiple_techniques_to_student,
                create_and_assign_technique_route
            ],
        )
        .manage(pool) // This is the key line that was missing
        .attach(Template::fairing())
}
