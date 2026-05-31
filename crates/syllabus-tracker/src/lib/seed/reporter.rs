/// Outcome for a single seeded item. Drives the per-phase tally
/// (e.g. "12 new, 13 existed") and the grand-total summary line.
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub enum ItemOutcome {
    Created,
    Existed,
}

/// Progress sink for the seed binary. The terminal implementation renders a
/// live checklist; the noop implementation is provided for tests or scripted
/// use where output would just be noise.
pub trait SeedReporter: Send + Sync {
    /// Called once at the start with the ordered list of phase labels so the
    /// reporter can pre-render the checklist. Labels must match the strings
    /// later passed to [`phase_started`].
    fn seed_started(&self, phases: &[&str]);

    /// Begin a phase. `total` is the expected item count when it's cheap to
    /// know up front; `None` for phases whose total depends on per-row state
    /// the seed only learns mid-flight (attempts).
    fn phase_started(&self, phase: &str, total: Option<u64>);

    /// Record one item's outcome. The reporter tallies these internally and
    /// uses them for both the live spinner message and the final phase label.
    fn phase_item(&self, outcome: ItemOutcome);

    /// Finish the current phase. The reporter renders a final label from its
    /// counters (e.g. "(12 new, 13 existed)" or "(existed)").
    fn phase_finished(&self);

    /// Print the closing summary line with elapsed time and grand totals.
    fn seed_finished(&self);
}

pub struct NoopSeedReporter;

impl SeedReporter for NoopSeedReporter {
    fn seed_started(&self, _phases: &[&str]) {}
    fn phase_started(&self, _phase: &str, _total: Option<u64>) {}
    fn phase_item(&self, _outcome: ItemOutcome) {}
    fn phase_finished(&self) {}
    fn seed_finished(&self) {}
}
