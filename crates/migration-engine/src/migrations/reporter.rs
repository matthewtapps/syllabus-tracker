use crate::migrations::ChangesNeeded;

pub trait MigrationReporter: Send + Sync {
    fn migration_started(&self, changes: &ChangesNeeded);
    fn step_started(&self, description: &str);
    fn step_finished(&self);
    fn migration_finished(&self, changes_applied: bool);
}

pub struct NoopReporter;

impl MigrationReporter for NoopReporter {
    fn migration_started(&self, _changes: &ChangesNeeded) {}
    fn step_started(&self, _description: &str) {}
    fn step_finished(&self) {}
    fn migration_finished(&self, _changes_applied: bool) {}
}
