//! One-shot idempotent cursor seeding at deploy. Seeds every existing user's
//! `activity_cursors` row to the current `MAX(activity.id)` so pre-deploy
//! history reads as already-seen. Safe to re-run: `INSERT OR IGNORE` skips
//! users who already have a cursor row.
//!
//! Run with `just init-activity-cursors` (which runs `just migrate` first).

use std::process::ExitCode;
use std::str::FromStr;

use anyhow::{Context, Result};
use sqlx::SqlitePool;
use sqlx::sqlite::SqliteConnectOptions;
use syllabus_tracker::db::run_cursor_init;
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
    println!("Initialising activity cursors from {}", url);

    let opts = SqliteConnectOptions::from_str(&url)
        .with_context(|| format!("Invalid DATABASE_URL: {}", url))?
        .create_if_missing(false);
    let pool = SqlitePool::connect_with(opts)
        .await
        .context("Failed to connect to database")?;

    let inserted = run_cursor_init(&pool).await.context("Cursor init failed")?;

    println!(
        "Cursor init complete: {} user cursor rows inserted",
        inserted
    );

    Ok(())
}
