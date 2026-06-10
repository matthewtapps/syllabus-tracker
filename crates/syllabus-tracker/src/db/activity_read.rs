//! Activity read side. Owns the per-viewer unread rule, the ActivityRow shape,
//! and (in later tasks) cursor operations, the keyset-paginated feed query, and
//! the unread-count query. No SQL in this task; later tasks add SQL queries and
//! will require sqlx-prepare.

use chrono::NaiveDateTime;
use serde::Serialize;
// Pool and Sqlite are used by later tasks (Task 20+). Suppressed here to keep
// the clippy gate green until those tasks add the SQL functions.
#[allow(unused_imports)]
use sqlx::{Pool, Sqlite};

use crate::db::activity::Verb;
// AppError is used by later tasks. Suppressed here to keep the clippy gate green.
#[allow(unused_imports)]
use crate::error::AppError;

/// The PR-1 derived notify rule, viewer-relative. `in_feed` is supplied by the
/// feed query (target_student_id = viewer for a student; actor != viewer for a
/// coach). Unknown verbs are treated as non-notifiable.
pub fn notifies(verb: &str, actor_user_id: i64, viewer_id: i64, in_feed: bool) -> bool {
    let notifiable = Verb::from_str_verb(verb)
        .map(|v| v.notifiable())
        .unwrap_or(false);
    notifiable && actor_user_id != viewer_id && in_feed
}

/// One row rendered into a feed. Joined names are nullable because the entity
/// FK may have been SET NULL by a deletion (greyed history).
/// Used by Tasks 21+ (feed query). Suppressed until then.
#[allow(dead_code)]
#[derive(Debug, Serialize)]
pub struct ActivityRow {
    pub id: i64,
    pub occurred_at: String,
    pub verb: String,
    pub actor_user_id: i64,
    pub actor_name: Option<String>,
    pub target_student_id: Option<i64>,
    pub technique_id: Option<i64>,
    pub technique_name: Option<String>,
    pub syllabus_id: Option<i64>,
    pub syllabus_name: Option<String>,
    pub sst_id: Option<i64>,
    pub video_id: Option<i64>,
    pub video_title: Option<String>,
    pub payload_json: Option<String>,
    pub unread: bool,
}

// NaiveDateTime is used in Task 21+ for keyset pagination.
#[allow(dead_code)]
fn _uses_naive_datetime(_: NaiveDateTime) {}
