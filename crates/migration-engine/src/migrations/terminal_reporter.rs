use std::collections::HashMap;
use std::io::IsTerminal;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use indicatif::{MultiProgress, ProgressBar, ProgressStyle};

use crate::migrations::reporter::MigrationReporter;
use crate::migrations::{ChangesNeeded, planned_step_descriptions};

/// Human-readable progress display for the migrate binary.
///
/// Interactive (TTY): renders a multi-line checklist using `indicatif`'s
/// `MultiProgress`. Each planned step is shown as `[ ] description` up front,
/// switches to a spinner when it starts, and ticks green when it finishes.
///
/// Non-TTY (CI/deploy): prints one line per step, no escape codes.
pub struct TerminalReporter {
    inner: Mutex<Inner>,
}

struct Inner {
    is_tty: bool,
    multi: Option<MultiProgress>,
    bars: HashMap<String, ProgressBar>,
    current: Option<ProgressBar>,
    started_at: Option<Instant>,
    saw_any_changes: bool,
}

impl Default for TerminalReporter {
    fn default() -> Self {
        Self::new()
    }
}

impl TerminalReporter {
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(Inner {
                is_tty: std::io::stdout().is_terminal(),
                multi: None,
                bars: HashMap::new(),
                current: None,
                started_at: None,
                saw_any_changes: false,
            }),
        }
    }
}

impl MigrationReporter for TerminalReporter {
    fn migration_started(&self, changes: &ChangesNeeded) {
        let mut inner = self.inner.lock().expect("reporter mutex poisoned");
        inner.started_at = Some(Instant::now());

        if !changes.has_any_changes() {
            // migration_finished will print "Schema already up to date."
            return;
        }
        inner.saw_any_changes = true;

        println!("Migrating database...");
        println!();

        let descriptions = planned_step_descriptions(changes);

        if !inner.is_tty {
            // Non-TTY: just print one line per step as each starts. Nothing to
            // pre-render here beyond the header above.
            return;
        }

        let multi = MultiProgress::new();
        let mut bars = HashMap::with_capacity(descriptions.len());
        for description in &descriptions {
            let label = label_for_step(description, changes);
            let bar = multi.add(ProgressBar::new_spinner());
            bar.set_style(pending_style());
            bar.set_message(label);
            bars.insert(description.clone(), bar);
        }
        inner.multi = Some(multi);
        inner.bars = bars;
    }

    fn step_started(&self, description: &str) {
        let mut inner = self.inner.lock().expect("reporter mutex poisoned");
        if !inner.is_tty {
            println!("  {}", description);
            return;
        }
        // Lookup the pre-allocated bar; if missing (unusual; would mean a
        // mismatch with planned_step_descriptions), skip silently rather than
        // panic in the middle of a migration.
        let bar = inner.bars.get(description).cloned();
        if let Some(bar) = bar {
            bar.set_style(spinner_style());
            bar.enable_steady_tick(Duration::from_millis(80));
            inner.current = Some(bar);
        }
    }

    fn step_finished(&self) {
        let mut inner = self.inner.lock().expect("reporter mutex poisoned");
        if let Some(bar) = inner.current.take() {
            bar.disable_steady_tick();
            let msg = bar.message();
            bar.set_style(done_style());
            bar.set_prefix("✓");
            bar.finish_with_message(msg);
        }
    }

    fn migration_finished(&self, changes_applied: bool) {
        let mut inner = self.inner.lock().expect("reporter mutex poisoned");

        // Abandon any bars still pending (e.g. when the migration errored
        // mid-way) so the terminal isn't left with a stale spinner.
        if let Some(bar) = inner.current.take() {
            bar.abandon();
        }
        for bar in inner.bars.values() {
            if !bar.is_finished() {
                bar.abandon();
            }
        }
        // Dropping MultiProgress flushes pending output.
        inner.multi.take();

        let elapsed = inner.started_at.map(|t| t.elapsed());
        let saw_changes = inner.saw_any_changes;
        drop(inner);

        if !changes_applied && !saw_changes {
            println!("Schema already up to date.");
            return;
        }

        if changes_applied {
            match elapsed {
                Some(dur) => println!("\nMigration complete ({}).", format_duration(dur)),
                None => println!("\nMigration complete."),
            }
        }
    }
}

fn pending_style() -> ProgressStyle {
    ProgressStyle::with_template("  [ ] {msg}").expect("pending template")
}

fn spinner_style() -> ProgressStyle {
    ProgressStyle::with_template("  [{spinner:.cyan}] {msg}")
        .expect("spinner template")
        .tick_chars("⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏ ")
}

fn done_style() -> ProgressStyle {
    ProgressStyle::with_template("  [{prefix:.green}] {msg}").expect("done template")
}

fn label_for_step(description: &str, changes: &ChangesNeeded) -> String {
    if let Some(table_name) = description.strip_prefix("Modifying table ") {
        if let Some(table) = changes.modified_tables.iter().find(|t| t.name == table_name) {
            let mut parts: Vec<String> = Vec::new();
            let mut new_cols = table.new_columns.clone();
            new_cols.sort();
            for c in &new_cols {
                parts.push(format!("+ {}", c));
            }
            let mut removed_cols = table.removed_columns.clone();
            removed_cols.sort();
            for c in &removed_cols {
                parts.push(format!("- {}", c));
            }
            if !parts.is_empty() {
                return format!("{} ({})", description, parts.join(", "));
            }
        }
    }
    description.to_string()
}

fn format_duration(d: Duration) -> String {
    let secs = d.as_secs_f64();
    if secs < 10.0 {
        format!("{:.1}s", secs)
    } else {
        format!("{:.0}s", secs)
    }
}

