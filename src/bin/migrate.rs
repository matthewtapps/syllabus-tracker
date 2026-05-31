//! Apply the declarative schema in `config/schema.sql` to the database
//! pointed at by `DATABASE_URL`.
//!
//! Modes:
//! - default: detect changes, refuse destructive ones (unless
//!   `ALLOW_DESTRUCTIVE_MIGRATIONS=true`), then apply.
//! - `--dry-run`: do the destructive-changes check and exit 0 if safe, 1 if not.
//!   The deploy pipeline runs this against a copy of the prod DB as a gate
//!   before swapping containers.
//! - `--verbose`: re-enable the structured tracing logs (the default UI is a
//!   compact, human-readable progress display).
//!
//! The SQLite file is created on the fly if missing, so `just clean &&
//! just migrate` works out of the box.

use std::process::ExitCode;
use std::str::FromStr;
use std::sync::Arc;

use anyhow::{Context, Result};
use sqlx::SqlitePool;
use sqlx::sqlite::SqliteConnectOptions;
use syllabus_tracker::db::backfill_student_technique_views;
use syllabus_tracker::env;
use syllabus_tracker::get_schema_string;
use syllabus_tracker::lib::migrations::{
    ChangesNeeded, MigrationReporter, NoopReporter, TerminalReporter, get_schema_changes,
    migrate_database_declaratively_with_reporter,
};

struct Args {
    dry_run: bool,
    verbose: bool,
}

fn parse_args() -> Result<Args> {
    let mut dry_run = false;
    let mut verbose = false;
    for arg in std::env::args().skip(1) {
        match arg.as_str() {
            "--dry-run" => dry_run = true,
            "--verbose" | "-v" => verbose = true,
            "--help" | "-h" => {
                print_help();
                std::process::exit(0);
            }
            other => {
                anyhow::bail!("Unknown argument: {}", other);
            }
        }
    }
    Ok(Args { dry_run, verbose })
}

fn print_help() {
    println!("Usage: migrate [--dry-run] [--verbose]");
    println!();
    println!("Applies config/schema.sql to the database at $DATABASE_URL.");
    println!();
    println!("Options:");
    println!("  --dry-run    Detect changes and exit, without applying them.");
    println!("  --verbose    Re-enable structured tracing logs (raw SQL, spans).");
    println!();
    println!("Env:");
    println!("  DATABASE_URL                    sqlite:// URL of the target DB.");
    println!("  SCHEMA_PATH                     path to schema.sql.");
    println!("  ALLOW_DESTRUCTIVE_MIGRATIONS    set to 'true' to permit dropping");
    println!("                                  tables, columns, or indices.");
}

#[tokio::main]
async fn main() -> ExitCode {
    if let Err(e) = run().await {
        eprintln!("Error: {:#}", e);
        return ExitCode::from(1);
    }
    ExitCode::SUCCESS
}

async fn run() -> Result<()> {
    let args = parse_args()?;

    env::load_environment().ok();
    if args.verbose {
        // Default to debug for the migrations module so the SQL/span output
        // is back, but keep other crates at whatever RUST_LOG asks for
        // (config/dev.env pins RUST_LOG=info, which would otherwise hide the
        // migration debug logs we want in verbose mode).
        let filter = tracing_subscriber::EnvFilter::try_from_default_env()
            .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info"))
            .add_directive(
                "syllabus_tracker::lib::migrations=debug"
                    .parse()
                    .expect("static directive parses"),
            );
        tracing_subscriber::fmt().with_env_filter(filter).init();
    }

    let database_url = std::env::var("DATABASE_URL").context("DATABASE_URL not set")?;

    let opts = SqliteConnectOptions::from_str(&database_url)
        .with_context(|| format!("Invalid DATABASE_URL: {}", database_url))?
        .create_if_missing(true);
    let pool = SqlitePool::connect_with(opts)
        .await
        .context("Failed to connect to database")?;

    let schema = get_schema_string();

    let changes = get_schema_changes(pool.clone(), &schema)
        .await
        .map_err(|e| anyhow::anyhow!("Failed to analyze schema changes: {:?}", e))?;

    let allow_destructive = std::env::var("ALLOW_DESTRUCTIVE_MIGRATIONS")
        .unwrap_or_default()
        .parse::<bool>()
        .unwrap_or(false);

    if has_destructive_changes(&changes) {
        if !allow_destructive {
            print_destructive_changes(&changes);
            eprintln!("Set ALLOW_DESTRUCTIVE_MIGRATIONS=true to allow these changes.");
            anyhow::bail!("Destructive database changes detected but not allowed");
        }
        eprintln!("Warning: proceeding with destructive database changes (explicitly allowed).");
    }

    if args.dry_run {
        println!("--dry-run set: schema check passed, no changes applied.");
        return Ok(());
    }

    // Verbose mode emits the structured tracing logs and skips the TUI to
    // avoid mixing spinner escape codes with log lines.
    let reporter: Arc<dyn MigrationReporter> = if args.verbose {
        Arc::new(NoopReporter)
    } else {
        Arc::new(TerminalReporter::new())
    };

    migrate_database_declaratively_with_reporter(pool.clone(), &schema, allow_destructive, reporter)
        .await
        .map_err(|e| anyhow::anyhow!("Migration failed: {:?}", e))?;

    // Idempotent data backfills run after the schema apply so the migrate
    // binary owns "make DB app-ready" end to end. main.rs no longer mutates
    // anything at boot.
    backfill_student_technique_views(&pool)
        .await
        .context("Failed to backfill student_technique_views")?;

    Ok(())
}

fn has_destructive_changes(changes: &ChangesNeeded) -> bool {
    !changes.removed_tables.is_empty()
        || !changes.removed_indices.is_empty()
        || changes
            .modified_tables
            .iter()
            .any(|t| !t.removed_columns.is_empty())
}

fn print_destructive_changes(changes: &ChangesNeeded) {
    eprintln!("Destructive database changes detected but not allowed:");
    if !changes.removed_tables.is_empty() {
        eprintln!("  Tables to be removed: {:?}", changes.removed_tables);
    }
    if !changes.removed_indices.is_empty() {
        eprintln!("  Indices to be removed: {:?}", changes.removed_indices);
    }
    for table in &changes.modified_tables {
        if !table.removed_columns.is_empty() {
            eprintln!(
                "  Columns to be removed from {}: {:?}",
                table.name, table.removed_columns
            );
        }
    }
}
