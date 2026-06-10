//! One-shot idempotent historical activity backfill. Seeds the `activity`
//! table from existing source tables (attempts, SST notes, watches,
//! assignments, graduations, pins). Safe to re-run: if the table is already
//! non-empty the function returns immediately without touching the DB.
//!
//! Run with `just backfill-activity` (which runs `just migrate` first).

use std::process::ExitCode;
use std::str::FromStr;

use anyhow::{Context, Result};
use sqlx::SqlitePool;
use sqlx::sqlite::SqliteConnectOptions;
use syllabus_tracker::db::run_backfill;
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
    println!("Backfilling activity from {}", url);

    let opts = SqliteConnectOptions::from_str(&url)
        .with_context(|| format!("Invalid DATABASE_URL: {}", url))?
        .create_if_missing(false);
    let pool = SqlitePool::connect_with(opts)
        .await
        .context("Failed to connect to database")?;

    let counts = run_backfill(&pool).await.context("Backfill failed")?;

    println!(
        "Backfill complete: attempts={} student_notes={} coach_notes={} watches={} assignments={} graduations={} pins={}",
        counts.attempts,
        counts.student_notes,
        counts.coach_notes,
        counts.watches,
        counts.assignments,
        counts.graduations,
        counts.pins,
    );

    Ok(())
}
