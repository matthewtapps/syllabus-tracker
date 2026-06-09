#[macro_use]
extern crate rocket;

pub use syllabus_tracker::{
    api, auth, capabilities, catchers, db, env, error, models, telemetry, validation, videos,
};

#[cfg(test)]
mod test;

use api::api_get_all_users;
use api::{
    api_add_tag_to_technique, api_add_techniques_to_collection, api_approve_user,
    api_assign_collection, api_assign_techniques, api_attempt_heatmap, api_attempt_sparkline,
    api_attempt_summary, api_change_password, api_claim_invite,
    api_create_and_assign_technique, api_create_attempt, api_create_collection, api_create_tag,
    api_create_technique_in_collection, api_delete_attempt, api_delete_collection, api_delete_tag,
    api_get_all_tags, api_get_collection, api_get_collection_students, api_get_collections,
    api_get_invite, api_get_single_student_technique, api_get_student_techniques,
    api_get_students, api_get_technique_tags,
    api_get_unassigned_techniques, api_invite_user, api_library_stats,
    api_library_technique_stats, api_list_library_techniques, api_list_attempts,
    api_login, api_logout, api_mark_student_technique_seen, api_me, api_me_unauthorized,
    api_recent_attempts, api_register_user,
    api_remove_tag_from_technique, api_remove_technique_from_collection,
    api_request_password_reset, api_reset_user_claim, api_self_register,
    api_set_student_graduated, api_set_student_rank, api_update_attempt, api_update_collection,
    api_update_library_technique, api_update_profile, api_update_student_technique,
    api_update_user, health,
};
use auth::unauthorized_api;
use capabilities::{Capabilities, api_capabilities};
use catchers::{
    bad_request, default_catcher, internal_error, not_found, payload_too_large,
    unprocessable_entity,
};
use db::clean_expired_sessions;
use error::AppError;
use rocket::{Build, Rocket, tokio};
use migration_engine::migrations::{get_schema_changes, read_schema_file_to_string};
use telemetry::TelemetryFairing;
use telemetry::init_tracing;
use thiserror::Error;
use videos::{
    api_admin_storage, api_dashboard_video_overview, api_delete_video, api_list_technique_videos,
    api_my_watch_state, api_reorder_videos, api_replace_video,
    api_set_video_global_hidden, api_set_video_student_visibility,
    api_student_watch_activity,
    api_update_video, api_video_download_url, api_video_link, api_video_playback_url,
    api_video_privacy_ack, api_video_privacy_ack_status, api_video_stats, api_video_status,
    api_video_upload, api_video_watch_events,
};

use sqlx::SqlitePool;
use sqlx::sqlite::SqliteConnectOptions;
use std::str::FromStr;
use tracing::{error, info};

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
    if let Err(e) = env::load_environment() {
        eprintln!("Failed to load environment variables: {}", e);
    }

    let videos_enabled = dotenvy::var("VIDEOS_ENABLED")
        .map(|v| v == "true" || v == "1")
        .unwrap_or(false);

    init_tracing(videos_enabled);

    info!("Feature flag VIDEOS_ENABLED = {}", videos_enabled);

    let database_url =
        dotenvy::var("DATABASE_URL").expect("Failed to get database url from environment");

    let opts = SqliteConnectOptions::from_str(&database_url)
        .expect("Failed to parse DATABASE_URL")
        .pragma("journal_mode", "WAL")
        .pragma("synchronous", "NORMAL")
        .pragma("busy_timeout", "5000")
        .pragma("foreign_keys", "ON");
    let pool = SqlitePool::connect_with(opts)
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

    // Panic if db schema isn't up to date or database doesn't exist
    let schema_path =
        dotenvy::var("SCHEMA_PATH").expect("SCHEMA_PATH environment variable not set");
    let schema = read_schema_file_to_string(std::path::Path::new(&schema_path))
        .expect("Failed to read schema file");
    let changes = get_schema_changes(pool.clone(), &schema)
        .await
        .unwrap_or_else(|e| panic!("Failed to analyze database schema: {:?}", e));

    if changes.has_any_changes() {
        error!("Database schema is out of sync with config/schema.sql:");
        if !changes.new_tables.is_empty() {
            error!("  Missing tables: {:?}", changes.new_tables);
        }
        if !changes.removed_tables.is_empty() {
            error!("  Unexpected tables: {:?}", changes.removed_tables);
        }
        if !changes.new_indices.is_empty() {
            error!("  Missing indices: {:?}", changes.new_indices);
        }
        if !changes.removed_indices.is_empty() {
            error!("  Unexpected indices: {:?}", changes.removed_indices);
        }
        for table in &changes.modified_tables {
            if !table.new_columns.is_empty() {
                error!(
                    "  Missing columns on {}: {:?}",
                    table.name, table.new_columns
                );
            }
            if !table.removed_columns.is_empty() {
                error!(
                    "  Unexpected columns on {}: {:?}",
                    table.name, table.removed_columns
                );
            }
        }
        panic!(
            "Database schema does not match config/schema.sql. \
             Run the migrate binary first (locally: `just migrate` or \
             `just migrate-destructive`; in prod: the CI migrate_database job)."
        );
    }
    info!("Database schema matches config/schema.sql");

    let video_stack = if videos_enabled {
        let storage_config = videos::S3Config::from_env()
            .expect("VIDEOS_ENABLED=true but S3 config missing from environment");
        Some(videos::VideoStack {
            storage: std::sync::Arc::new(videos::S3VideoStorage::new(&storage_config)),
            probe: std::sync::Arc::new(videos::FfprobeMediaProbe::from_env()),
            transcode: std::sync::Arc::new(videos::FfmpegMediaTranscode::from_env()),
        })
    } else {
        None
    };

    init_rocket(pool, video_stack).await
}

async fn sample_video_gauges(pool: &SqlitePool, active_jobs: i64) {
    let metrics = videos::metrics::video_metrics();
    metrics.processing_jobs_active.record(active_jobs, &[]);
    match db::total_video_storage_bytes(pool).await {
        Ok(bytes) => metrics.storage_bytes_total.record(bytes.max(0) as u64, &[]),
        Err(e) => error!("failed to sample storage bytes: {}", e),
    }
    match db::total_video_objects(pool).await {
        Ok(count) => metrics.storage_objects_total.record(count.max(0) as u64, &[]),
        Err(e) => error!("failed to sample storage objects: {}", e),
    }
}

pub async fn init_rocket(
    pool: SqlitePool,
    video_stack: Option<videos::VideoStack>,
) -> Rocket<Build> {
    info!("Starting syllabus tracker");

    let videos_enabled = video_stack.is_some();

    let upload_limit = videos::routes::upload_byte_limit();
    let limits = rocket::data::Limits::default()
        .limit("file", upload_limit)
        .limit("data-form", upload_limit);

    // The production image is built FROM scratch, so /tmp does not exist.
    // Rocket's multipart form parser streams uploads through its temp_dir;
    // point it at our pipeline temp dir (which we also persist into) and
    // create it eagerly so the first upload doesn't ENOENT.
    let temp_dir = videos::pipeline::temp_dir();
    if let Err(e) = std::fs::create_dir_all(&temp_dir) {
        error!(
            temp_dir = ?temp_dir,
            error = %e,
            "failed to create video temp dir at startup; uploads will fail"
        );
    }

    let figment = rocket::Config::figment()
        .merge(("limits", limits))
        .merge(("temp_dir", &temp_dir));

    let mut rocket = rocket::custom(figment)
        .manage(Capabilities { videos: videos_enabled })
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
                api_library_stats,
                api_list_library_techniques,
                api_library_technique_stats,
                api_set_student_graduated,
                api_set_student_rank,
                api_mark_student_technique_seen,
                api_invite_user,
                api_get_invite,
                api_claim_invite,
                api_reset_user_claim,
                api_self_register,
                api_approve_user,
                api_request_password_reset,
                api_get_collections,
                api_get_collection,
                api_create_collection,
                api_update_collection,
                api_delete_collection,
                api_add_techniques_to_collection,
                api_create_technique_in_collection,
                api_update_library_technique,
                api_remove_technique_from_collection,
                api_get_collection_students,
                api_assign_collection,
                api_get_single_student_technique,
                api_list_attempts,
                api_create_attempt,
                api_update_attempt,
                api_delete_attempt,
                api_recent_attempts,
                api_attempt_summary,
                api_attempt_heatmap,
                api_attempt_sparkline,
            ],
        )
        .register(
            "/api",
            catchers![
                unauthorized_api,
                bad_request,
                not_found,
                payload_too_large,
                unprocessable_entity,
                internal_error,
                default_catcher,
            ],
        )
        .mount("/api", routes![health, api_capabilities])
        .attach(TelemetryFairing);

    if let Some(stack) = video_stack {
        let jobs = std::sync::Arc::new(videos::ProcessingJobs::new());
        let pipeline_ctx = std::sync::Arc::new(videos::PipelineContext {
            pool: pool.clone(),
            storage: stack.storage.clone(),
            probe: stack.probe,
            transcode: stack.transcode,
            jobs: jobs.clone(),
            max_duration_seconds: videos::pipeline::max_video_duration_seconds(),
        });

        let sampler_pool = pool.clone();
        let sampler_jobs = jobs.clone();
        tokio::spawn(async move {
            loop {
                sample_video_gauges(&sampler_pool, sampler_jobs.snapshot()).await;
                tokio::time::sleep(tokio::time::Duration::from_secs(300)).await;
            }
        });

        rocket = rocket
            .manage(stack.storage)
            .manage(pipeline_ctx)
            .manage(jobs)
            .mount(
                "/api",
                routes![
                    api_video_upload,
                    api_video_status,
                    api_video_link,
                    api_list_technique_videos,
                    api_update_video,
                    api_reorder_videos,
                    api_replace_video,
                    api_delete_video,
                    api_set_video_global_hidden,
                    api_set_video_student_visibility,
                    api_video_playback_url,
                    api_video_download_url,
                    api_video_watch_events,
                    api_video_privacy_ack,
                    api_video_privacy_ack_status,
                    api_video_stats,
                    api_student_watch_activity,
                    api_my_watch_state,
                    api_dashboard_video_overview,
                    api_admin_storage,
                ],
            );
    }

    rocket.manage(pool)
}
