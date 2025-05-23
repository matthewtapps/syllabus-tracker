#[macro_use]
extern crate rocket;

mod api;
mod auth;
mod db;
mod env;
mod error;
mod models;
mod telemetry;
#[cfg(test)]
mod test;
mod validation;

use std::path::Path;

use api::api_get_all_users;
use api::{
    api_add_tag_to_technique, api_assign_techniques, api_change_password,
    api_create_and_assign_technique, api_create_tag, api_delete_tag, api_get_all_tags,
    api_get_student_techniques, api_get_students, api_get_technique_tags,
    api_get_unassigned_techniques, api_login, api_logout, api_me, api_me_unauthorized,
    api_register_user, api_remove_tag_from_technique, api_update_profile,
    api_update_student_technique, api_update_user, health,
};
use auth::unauthorized_api;
use db::clean_expired_sessions;
use error::AppError;
use rocket::{Build, Rocket, tokio};
use syllabus_tracker::lib::migrations::{
    get_schema_changes, migrate_database_declaratively, read_schema_file_to_string,
};
use telemetry::TelemetryFairing;
use telemetry::init_tracing;
use thiserror::Error;

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

    if let Err(e) = env::load_environment() {
        eprintln!("Failed to load environment variables: {}", e);
    }

    let database_url =
        dotenvy::var("DATABASE_URL").expect("Failed to get database url from environment");

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

    info!("Running declarative database migration...");

    let schema = get_schema_string();

    match get_schema_changes(pool.clone(), &schema).await {
        Ok(changes) => {
            let has_destructive_changes = !changes.removed_tables.is_empty()
                || !changes.removed_indices.is_empty()
                || changes
                    .modified_tables
                    .iter()
                    .any(|t| !t.removed_columns.is_empty());

            if has_destructive_changes {
                let allow_destructive = dotenvy::var("ALLOW_DESTRUCTIVE_MIGRATIONS")
                    .unwrap_or_else(|_| "false".to_string())
                    .parse::<bool>()
                    .unwrap_or(false);

                if !allow_destructive {
                    error!("Destructive database changes detected but not allowed:");

                    if !changes.removed_tables.is_empty() {
                        error!("  Tables to be removed: {:?}", changes.removed_tables);
                    }

                    if !changes.removed_indices.is_empty() {
                        error!("  Indices to be removed: {:?}", changes.removed_indices);
                    }

                    for table in &changes.modified_tables {
                        if !table.removed_columns.is_empty() {
                            error!(
                                "  Columns to be removed from {}: {:?}",
                                table.name, table.removed_columns
                            );
                        }
                    }

                    error!("Set ALLOW_DESTRUCTIVE_MIGRATIONS=true to allow these changes");
                    panic!("Deployment cancelled due to destructive database changes");
                } else {
                    warn!("Proceeding with destructive database changes (explicitly allowed)");
                }
            }

            info!("Running declarative database migration...");
            match migrate_database_declaratively(pool.clone(), &schema).await {
                Ok(changes_made) => {
                    if changes_made {
                        info!("Database migration completed with changes");
                    } else {
                        info!("Database schema is already up to date");
                    }
                }
                Err(e) => {
                    error!("Failed to migrate database: {:?}", e);
                    panic!("Database migration failed: {:?}", e);
                }
            }
        }
        Err(e) => {
            error!("Failed to analyze database changes: {:?}", e);
            panic!("Database analysis failed: {:?}", e);
        }
    }

    init_rocket(pool).await
}

pub async fn init_rocket(pool: SqlitePool) -> Rocket<Build> {
    info!("Starting syllabus tracker");

    rocket::build()
        .manage(pool)
        .mount(
            "/api",
            routes![
                api_login,
                api_me,
                api_me_unauthorized,
                api_update_student_technique,
                api_get_student_techniques,
                api_logout,
                api_get_students,
                api_get_unassigned_techniques,
                api_assign_techniques,
                api_create_and_assign_technique,
                api_register_user,
                api_change_password,
                api_update_profile,
                api_update_user,
                api_get_all_tags,
                api_create_tag,
                api_delete_tag,
                api_add_tag_to_technique,
                api_remove_tag_from_technique,
                api_get_technique_tags,
                api_get_all_users,
            ],
        )
        .register("/api", catchers![unauthorized_api])
        .mount("/api", routes![health])
        .attach(TelemetryFairing)
}

pub fn get_schema_string() -> String {
    let schema_var =
        dotenvy::var("SCHEMA_PATH").expect("Failed to find schema path from environment variable");
    let schema_path = Path::new(&schema_var);

    read_schema_file_to_string(schema_path).expect("Failed to read schema file to string")
}
