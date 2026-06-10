//! Data-access layer. One file per domain (users, sessions, techniques, etc.);
//! cross-domain read-only queries live in `reporting.rs`. Composite write
//! operations belong to the file that owns the outer transaction, with calls
//! fanning out one-way to leaf modules. Each submodule re-exports its public
//! names through this `mod.rs` so call sites stay flat (`crate::db::foo`).

mod activity;
mod attempts;
mod collections;
mod invites;
mod pinned;
mod reporting;
mod sessions;
mod student_syllabus_techniques;
mod student_techniques;
mod syllabus_assignments;
mod syllabus_attempts;
mod syllabi;
mod tags;
mod techniques;
mod users;
mod videos;
mod watch;

pub use activity::*;
pub use attempts::*;
pub use collections::*;
pub use invites::*;
pub use pinned::*;
pub use reporting::*;
pub use sessions::*;
pub use student_syllabus_techniques::*;
pub use student_techniques::*;
pub use syllabus_assignments::*;
pub use syllabus_attempts::*;
pub use syllabi::*;
pub use tags::*;
pub use techniques::*;
pub use users::*;
pub use videos::*;
pub use watch::*;

// Back-compat re-exports for callers that historically reached for these types
// via `crate::db::*`. The types themselves now live in `crate::models`; this
// shim keeps the call sites unchanged.
pub use crate::models::{
    AttemptBucket, AttemptCreateResult, AttemptListItem, AttemptSuggestion, AttemptSummary,
    Collection, DashboardVideoOverview, DashboardVideoRow, StorageObjectRow, StorageOverview,
    StudentWatchActivityRow, VideoStatsSnapshot, WatchAggregateRow,
};

// Production uses bcrypt's default cost (currently 12). Tests use the minimum
// (4) because each hash at cost 12 takes ~220ms, which dominates test runtime
// on suites that create users in setup. Cost 4 is ~250x faster. Gated on the
// `test-support` feature, not `cfg(test)`, because tests live in the binary
// crate but call into this library crate; `cfg(test)` is not propagated.
#[cfg(feature = "test-support")]
pub(crate) const BCRYPT_COST: u32 = 4;
#[cfg(not(feature = "test-support"))]
pub(crate) const BCRYPT_COST: u32 = bcrypt::DEFAULT_COST;
