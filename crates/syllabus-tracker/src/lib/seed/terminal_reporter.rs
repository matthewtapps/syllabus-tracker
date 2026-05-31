use std::io::IsTerminal;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use indicatif::{MultiProgress, ProgressBar, ProgressStyle};

use crate::lib::seed::reporter::{ItemOutcome, SeedReporter};

/// Human-readable progress display for the seed binary.
///
/// Interactive (TTY): pre-renders the full phase checklist with `indicatif`,
/// spins a cyan spinner on the active phase, ticks it green with a tally
/// (e.g. "12 new, 13 existed") when it finishes.
///
/// Non-TTY (CI/deploy): emits one line per phase as it finishes, with the
/// same tally and no escape codes.
pub struct TerminalSeedReporter {
    inner: Mutex<Inner>,
}

struct Inner {
    is_tty: bool,
    multi: Option<MultiProgress>,
    bars: Vec<(String, ProgressBar)>,
    current_phase: Option<String>,
    current_bar: Option<ProgressBar>,
    started_at: Option<Instant>,
    phase_created: u64,
    phase_existed: u64,
    phase_total: Option<u64>,
    total_created: u64,
    total_existed: u64,
}

impl Default for TerminalSeedReporter {
    fn default() -> Self {
        Self::new()
    }
}

impl TerminalSeedReporter {
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(Inner {
                is_tty: std::io::stdout().is_terminal(),
                multi: None,
                bars: Vec::new(),
                current_phase: None,
                current_bar: None,
                started_at: None,
                phase_created: 0,
                phase_existed: 0,
                phase_total: None,
                total_created: 0,
                total_existed: 0,
            }),
        }
    }
}

impl SeedReporter for TerminalSeedReporter {
    fn seed_started(&self, phases: &[&str]) {
        let mut inner = self.inner.lock().expect("reporter mutex poisoned");
        inner.started_at = Some(Instant::now());

        if !inner.is_tty {
            // Non-TTY emits a line per phase on phase_finished; nothing to
            // pre-render here.
            return;
        }

        println!();
        let multi = MultiProgress::new();
        let mut bars = Vec::with_capacity(phases.len());
        for phase in phases {
            let bar = multi.add(ProgressBar::new_spinner());
            bar.set_style(pending_style());
            bar.set_message((*phase).to_string());
            bars.push(((*phase).to_string(), bar));
        }
        inner.multi = Some(multi);
        inner.bars = bars;
    }

    fn phase_started(&self, phase: &str, total: Option<u64>) {
        let mut inner = self.inner.lock().expect("reporter mutex poisoned");
        inner.phase_created = 0;
        inner.phase_existed = 0;
        inner.phase_total = total;
        inner.current_phase = Some(phase.to_string());

        if !inner.is_tty {
            return;
        }

        let bar = inner
            .bars
            .iter()
            .find(|(p, _)| p == phase)
            .map(|(_, b)| b.clone());
        if let Some(bar) = bar {
            bar.set_style(spinner_style());
            bar.set_message(live_label(phase, 0, 0, total));
            bar.enable_steady_tick(Duration::from_millis(80));
            inner.current_bar = Some(bar);
        }
    }

    fn phase_item(&self, outcome: ItemOutcome) {
        let mut inner = self.inner.lock().expect("reporter mutex poisoned");
        match outcome {
            ItemOutcome::Created => {
                inner.phase_created += 1;
                inner.total_created += 1;
            }
            ItemOutcome::Existed => {
                inner.phase_existed += 1;
                inner.total_existed += 1;
            }
        }

        if !inner.is_tty {
            return;
        }
        if let (Some(phase), Some(bar)) = (inner.current_phase.as_ref(), inner.current_bar.as_ref())
        {
            bar.set_message(live_label(
                phase,
                inner.phase_created,
                inner.phase_existed,
                inner.phase_total,
            ));
        }
    }

    fn phase_finished(&self) {
        let mut inner = self.inner.lock().expect("reporter mutex poisoned");
        let created = inner.phase_created;
        let existed = inner.phase_existed;
        let total = inner.phase_total;
        let phase = inner.current_phase.take();

        let Some(phase) = phase else { return };

        if !inner.is_tty {
            println!("  {}", final_label(&phase, created, existed, total));
            return;
        }

        if let Some(bar) = inner.current_bar.take() {
            bar.disable_steady_tick();
            bar.set_style(done_style());
            bar.set_prefix("✓");
            bar.finish_with_message(final_label(&phase, created, existed, total));
        }
    }

    fn seed_finished(&self) {
        let mut inner = self.inner.lock().expect("reporter mutex poisoned");

        // Abandon any bars still pending (e.g. on mid-phase error) so the
        // terminal isn't left with a stuck spinner.
        if let Some(bar) = inner.current_bar.take() {
            bar.abandon();
        }
        for (_, bar) in &inner.bars {
            if !bar.is_finished() {
                bar.abandon();
            }
        }
        inner.multi.take();

        let elapsed = inner.started_at.map(|t| t.elapsed());
        let total_created = inner.total_created;
        let total_existed = inner.total_existed;
        drop(inner);

        let elapsed_str = elapsed
            .map(format_duration)
            .map(|s| format!(" in {}", s))
            .unwrap_or_default();

        if total_created == 0 && total_existed > 0 {
            println!(
                "\nSeed complete{}. Nothing to do, all demo data already present.",
                elapsed_str
            );
        } else {
            println!(
                "\nSeed complete{}. {} created, {} existed.",
                elapsed_str, total_created, total_existed
            );
        }
    }
}

fn live_label(phase: &str, created: u64, existed: u64, total: Option<u64>) -> String {
    match total {
        Some(t) => {
            let done = created + existed;
            // For single-item phases the n/n form looks odd; just show the
            // bare phase name until phase_finished writes the result.
            if t <= 1 {
                phase.to_string()
            } else {
                format!("{} ({}/{})", phase, done, t)
            }
        }
        None => {
            if created == 0 && existed == 0 {
                phase.to_string()
            } else if existed == 0 {
                format!("{} ({} new)", phase, created)
            } else if created == 0 {
                format!("{} ({} existed)", phase, existed)
            } else {
                format!("{} ({} new, {} existed)", phase, created, existed)
            }
        }
    }
}

fn final_label(phase: &str, created: u64, existed: u64, total: Option<u64>) -> String {
    if total == Some(1) {
        if created > 0 {
            return format!("{} (created)", phase);
        }
        if existed > 0 {
            return format!("{} (existed)", phase);
        }
        return phase.to_string();
    }
    if created == 0 && existed == 0 {
        return phase.to_string();
    }
    if existed == 0 {
        return format!("{} ({} new)", phase, created);
    }
    if created == 0 {
        return format!("{} ({} existed)", phase, existed);
    }
    format!("{} ({} new, {} existed)", phase, created, existed)
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

fn format_duration(d: Duration) -> String {
    let secs = d.as_secs_f64();
    if secs < 10.0 {
        format!("{:.1}s", secs)
    } else {
        format!("{:.0}s", secs)
    }
}
