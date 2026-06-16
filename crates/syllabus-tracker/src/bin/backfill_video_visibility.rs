//! One-shot idempotent backfill of the two legacy video-visibility tables
//! (`student_syllabus_video_visibility`, `video_student_visibility`) into the
//! unified `video_visibility_overrides` table.
//!
//! Run this ONCE before the legacy tables are dropped. Because the migrator is
//! declarative (no imperative pre-migrate hooks), the deploy ordering is:
//!   1. `just backfill-video-visibility` (legacy tables still present)
//!   2. `just migrate` (drops the legacy tables)
//!
//! The backfill reads the legacy tables with runtime queries, so it stays
//! compilable even after they are removed from `config/schema.sql`.
//!
//! Idempotent: `INSERT OR IGNORE` skips override rows that already exist, so it
//! is safe to re-run. ssvv rows with no matching `syllabus_assignments` row are
//! orphaned and skipped (the skipped count is logged).

use std::process::ExitCode;
use std::str::FromStr;

use anyhow::{Context, Result};
use sqlx::SqlitePool;
use sqlx::sqlite::SqliteConnectOptions;
use syllabus_tracker::db::run_video_visibility_backfill;
use syllabus_tracker::env;

#[tokio::main]
async fn main() -> ExitCode {
    if let Err(e) = run().await {
        eprintln!("Error: {:#}", e);
        return ExitCode::from(1);
    }
    ExitCode::SUCCESS
}

async fn run() -> Result<()> {
    env::load_environment().ok();

    let url = std::env::var("DATABASE_URL").unwrap_or_else(|_| "sqlite://sqlite.db".to_string());
    println!("Backfilling video visibility overrides from {}", url);

    let opts = SqliteConnectOptions::from_str(&url)
        .with_context(|| format!("Invalid DATABASE_URL: {}", url))?
        .create_if_missing(false);
    let pool = SqlitePool::connect_with(opts)
        .await
        .context("Failed to connect to database")?;

    let counts = run_video_visibility_backfill(&pool)
        .await
        .context("Video visibility backfill failed")?;

    println!(
        "Backfill complete: {} assignment-scope rows inserted ({} ssvv orphans skipped), \
         {} student-scope rows inserted",
        counts.assignment_inserted, counts.assignment_orphaned, counts.student_inserted,
    );

    Ok(())
}
