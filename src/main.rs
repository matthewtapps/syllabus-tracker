#[macro_use]
extern crate rocket;

mod auth;
mod db;
mod error;
mod models;
mod routes;
mod telemetry;
#[cfg(test)]
mod test;

use auth::{Permission, Role};
use auth::{forbidden, login, logout, process_login, process_register, register, unauthorized};
use db::clean_expired_sessions;
use error::{AppError, internal_server_error};
use rocket::fs::FileServer;
use rocket::{Build, Rocket, tokio};
use rocket_dyn_templates::Template;
use rocket_dyn_templates::handlebars::Context;
use rocket_dyn_templates::handlebars::Handlebars;
use rocket_dyn_templates::handlebars::Helper;
use rocket_dyn_templates::handlebars::HelperResult;
use rocket_dyn_templates::handlebars::Output;
use rocket_dyn_templates::handlebars::RenderContext;
use rocket_dyn_templates::handlebars::RenderErrorReason;
use telemetry::TelemetryFairing;
use telemetry::init_tracing;
use thiserror::Error;

use routes::{
    add_multiple_techniques_to_student, add_technique_to_student, admin_archive_user,
    admin_edit_user, admin_process_edit_user, admin_users, create_and_assign_technique_route,
    health, index, index_anon, profile, student_techniques, update_name, update_password,
    update_student_technique_route, update_username_route,
};
use sqlx::SqlitePool;
use tracing::info;

#[derive(Debug, Error)]
pub enum Error {
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

    let pool_clone = pool.clone();

    tokio::spawn(async move {
        tokio::time::sleep(tokio::time::Duration::from_secs(5)).await;

        loop {
            match clean_expired_sessions(&pool_clone).await {
                Ok(count) => {
                    if count > 0 {
                        info!("Cleaned up {} expired sessions", count);
                    }
                }
                Err(e) => {
                    error!("Failed to clean expired sessions: {}", e);
                }
            }

            tokio::time::sleep(tokio::time::Duration::from_secs(3600)).await;
        }
    });

    info!("Running database migrations...");
    match sqlx::migrate!("./migrations").run(&pool).await {
        Ok(_) => info!("Migrations completed successfully"),
        Err(e) => {
            error!("Failed to run migrations: {}", e);
            panic!("Database migration failed: {}", e);
        }
    }

    init_rocket(pool).await
}

pub async fn init_rocket(pool: SqlitePool) -> Rocket<Build> {
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
                update_username_route,
                admin_users,
                admin_edit_user,
                admin_process_edit_user,
                admin_archive_user,
                health,
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

            engines.handlebars.register_helper(
                "has_permission",
                Box::new(
                    |h: &Helper,
                     _: &Handlebars,
                     _ctx: &Context,
                     _: &mut RenderContext,
                     out: &mut dyn Output|
                     -> HelperResult {
                        let user =
                            h.param(0)
                                .and_then(|v| v.value().as_object())
                                .ok_or_else(|| {
                                    RenderErrorReason::ParamNotFoundForName(
                                        "has_permission",
                                        "user".to_string(),
                                    )
                                })?;

                        let permission_str =
                            h.param(1).and_then(|v| v.value().as_str()).ok_or_else(|| {
                                RenderErrorReason::ParamNotFoundForName(
                                    "has_permission",
                                    "permission".to_string(),
                                )
                            })?;

                        let permission = match permission_str {
                            "RegisterUsers" => Permission::RegisterUsers,
                            "ViewAllStudents" => Permission::ViewAllStudents,
                            "EditAllTechniques" => Permission::EditAllTechniques,
                            "AssignTechniques" => Permission::AssignTechniques,
                            "CreateTechniques" => Permission::CreateTechniques,
                            _ => return Ok(()), // Unknown permission, return false
                        };

                        let role_str = user
                            .get("role")
                            .and_then(|v| match v {
                                serde_json::Value::String(s) => Some(s.as_str()),
                                serde_json::Value::Object(o) => {
                                    o.get("type").and_then(|t| t.as_str())
                                }
                                _ => None,
                            })
                            .unwrap_or("student");

                        let role = match role_str {
                            "Coach" => Role::Coach,
                            "Admin" => Role::Admin,
                            _ => Role::Student,
                        };

                        if role.has_permission(permission) {
                            out.write("true")?;
                        }

                        Ok(())
                    },
                ),
            );

            engines.handlebars.register_helper(
                "and",
                Box::new(
                    |h: &Helper,
                     _: &Handlebars,
                     _: &Context,
                     _: &mut RenderContext,
                     out: &mut dyn Output|
                     -> HelperResult {
                        let params = h.params();
                        let all_true = params.iter().all(|param| match param.value() {
                            serde_json::Value::Bool(b) => *b,
                            serde_json::Value::String(s) => s == "true",
                            _ => false,
                        });

                        if all_true {
                            out.write("true")?;
                        }

                        Ok(())
                    },
                ),
            );
        }))
}
