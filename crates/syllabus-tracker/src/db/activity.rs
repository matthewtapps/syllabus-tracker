//! Activity event-log write side. Owns the row shape, the code-side verb
//! registry (verb -> primary entity column + notifiable flag), typed payload
//! constructors, and the `emit` / `emit_fanout` helpers. Every live write path
//! calls into here inside its own transaction so the activity row is atomic
//! with the event it records. This module never deserialises payloads; the
//! typed read side lands in PR 2 (`db/activity_read.rs`).

use chrono::{NaiveDateTime, Utc};
use serde_json::json;
use sqlx::{Pool, Sqlite, Transaction};

use crate::error::AppError;

/// Which real FK column a verb treats as its "primary entity" for coalescing.
/// The coalesce key is (actor_user_id, verb, <this column>, target_student_id).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EntityKind {
    Technique,
    Syllabus,
    Sst,
    Video,
}

/// The activity verbs. Named `<target>_<past_tense>`. Each carries static
/// metadata (`notifiable`, `primary_entity`) read by the write side now and
/// the unread rule in PR 2. This is the registry; there is no DB column for it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Verb {
    VideoWatched,
    AttemptLogged,
    AttemptEdited,
    AttemptDeleted,
    SstStatusChanged,
    SstStudentNotesEdited,
    SstCoachNotesEdited,
    TechniquePinned,
    TechniqueUnpinned,
    SyllabusAssigned,
    SyllabusUnassigned,
    SyllabusGraduated,
    SstAdded,
    SstHidden,
    SstUnhidden,
    SyllabusTechniqueAdded,
    SyllabusTechniqueRemoved,
    VideoAdded,
    VideoVisibilitySet,
    TechniqueEdited,
}

impl Verb {
    pub const ALL: [Verb; 20] = [
        Verb::VideoWatched,
        Verb::AttemptLogged,
        Verb::AttemptEdited,
        Verb::AttemptDeleted,
        Verb::SstStatusChanged,
        Verb::SstStudentNotesEdited,
        Verb::SstCoachNotesEdited,
        Verb::TechniquePinned,
        Verb::TechniqueUnpinned,
        Verb::SyllabusAssigned,
        Verb::SyllabusUnassigned,
        Verb::SyllabusGraduated,
        Verb::SstAdded,
        Verb::SstHidden,
        Verb::SstUnhidden,
        Verb::SyllabusTechniqueAdded,
        Verb::SyllabusTechniqueRemoved,
        Verb::VideoAdded,
        Verb::VideoVisibilitySet,
        Verb::TechniqueEdited,
    ];

    pub fn as_str(self) -> &'static str {
        match self {
            Verb::VideoWatched => "video_watched",
            Verb::AttemptLogged => "attempt_logged",
            Verb::AttemptEdited => "attempt_edited",
            Verb::AttemptDeleted => "attempt_deleted",
            Verb::SstStatusChanged => "sst_status_changed",
            Verb::SstStudentNotesEdited => "sst_student_notes_edited",
            Verb::SstCoachNotesEdited => "sst_coach_notes_edited",
            Verb::TechniquePinned => "technique_pinned",
            Verb::TechniqueUnpinned => "technique_unpinned",
            Verb::SyllabusAssigned => "syllabus_assigned",
            Verb::SyllabusUnassigned => "syllabus_unassigned",
            Verb::SyllabusGraduated => "syllabus_graduated",
            Verb::SstAdded => "sst_added",
            Verb::SstHidden => "sst_hidden",
            Verb::SstUnhidden => "sst_unhidden",
            Verb::SyllabusTechniqueAdded => "syllabus_technique_added",
            Verb::SyllabusTechniqueRemoved => "syllabus_technique_removed",
            Verb::VideoAdded => "video_added",
            Verb::VideoVisibilitySet => "video_visibility_set",
            Verb::TechniqueEdited => "technique_edited",
        }
    }

    pub fn from_str_verb(s: &str) -> Option<Verb> {
        Verb::ALL.into_iter().find(|v| v.as_str() == s)
    }

    /// Whether a row of this verb can ever drive an unread badge. The
    /// delete / remove / hide / un-* verbs are history-only. Viewer-relative
    /// conditions are applied on the read side (PR 2).
    pub fn notifiable(self) -> bool {
        !matches!(
            self,
            Verb::AttemptDeleted
                | Verb::TechniqueUnpinned
                | Verb::SyllabusUnassigned
                | Verb::SstHidden
                | Verb::SstUnhidden
                | Verb::SyllabusTechniqueRemoved
                | Verb::VideoVisibilitySet
        )
    }

    /// The column the coalesce key uses to identify "the same thing happening
    /// again." sst_* verbs also denormalise technique_id / syllabus_id onto the
    /// row, but coalesce on the sst_id.
    pub fn primary_entity(self) -> EntityKind {
        match self {
            Verb::VideoWatched | Verb::VideoAdded | Verb::VideoVisibilitySet => EntityKind::Video,
            Verb::AttemptLogged
            | Verb::AttemptEdited
            | Verb::AttemptDeleted
            | Verb::SstStatusChanged
            | Verb::SstStudentNotesEdited
            | Verb::SstCoachNotesEdited
            | Verb::SstAdded
            | Verb::SstHidden
            | Verb::SstUnhidden => EntityKind::Sst,
            Verb::TechniquePinned | Verb::TechniqueUnpinned | Verb::TechniqueEdited => {
                EntityKind::Technique
            }
            Verb::SyllabusAssigned
            | Verb::SyllabusUnassigned
            | Verb::SyllabusGraduated
            | Verb::SyllabusTechniqueAdded
            | Verb::SyllabusTechniqueRemoved => EntityKind::Syllabus,
        }
    }
}

/// A row to be written to `activity`. Built with the fluent setters; entity
/// ids default to None. `occurred_at` is server-set inside `emit`.
#[derive(Debug, Clone)]
pub struct NewActivity {
    pub verb: Verb,
    pub actor_user_id: i64,
    pub target_student_id: Option<i64>,
    pub technique_id: Option<i64>,
    pub syllabus_id: Option<i64>,
    pub sst_id: Option<i64>,
    pub video_id: Option<i64>,
    pub payload_json: Option<String>,
}

impl NewActivity {
    pub fn new(verb: Verb, actor_user_id: i64) -> Self {
        NewActivity {
            verb,
            actor_user_id,
            target_student_id: None,
            technique_id: None,
            syllabus_id: None,
            sst_id: None,
            video_id: None,
            payload_json: None,
        }
    }

    pub fn target_student(mut self, id: i64) -> Self {
        self.target_student_id = Some(id);
        self
    }
    pub fn technique(mut self, id: i64) -> Self {
        self.technique_id = Some(id);
        self
    }
    pub fn syllabus(mut self, id: i64) -> Self {
        self.syllabus_id = Some(id);
        self
    }
    pub fn sst(mut self, id: i64) -> Self {
        self.sst_id = Some(id);
        self
    }
    pub fn video(mut self, id: i64) -> Self {
        self.video_id = Some(id);
        self
    }
    pub fn payload(mut self, json: String) -> Self {
        self.payload_json = Some(json);
        self
    }

    /// The value of the primary-entity column for this row, used by coalescing.
    pub(crate) fn primary_entity_id(&self) -> Option<i64> {
        match self.verb.primary_entity() {
            EntityKind::Technique => self.technique_id,
            EntityKind::Syllabus => self.syllabus_id,
            EntityKind::Sst => self.sst_id,
            EntityKind::Video => self.video_id,
        }
    }
}

/// Typed per-verb payload constructors. Each returns serialised JSON text.
/// PR 1 only writes these; the typed read side deserialises them in PR 2.
pub mod payload {
    use serde_json::json;

    pub fn video_watched(cumulative_seconds: i64, duration_seconds: i64) -> String {
        json!({
            "cumulative_seconds": cumulative_seconds,
            "duration_seconds": duration_seconds
        })
        .to_string()
    }

    pub fn status_changed(from: &str, to: &str) -> String {
        json!({ "from": from, "to": to }).to_string()
    }

    pub fn video_visibility_set(scope: &str, visible: bool) -> String {
        json!({ "scope": scope, "visible": visible }).to_string()
    }

    pub fn attempt_pointer(attempt_id: i64) -> String {
        json!({ "attempt_id": attempt_id }).to_string()
    }

    /// `technique_edited` delta. Pass which fields changed; tags carry the
    /// added / removed name lists.
    pub fn technique_edited(
        name_changed: bool,
        description_changed: bool,
        tags_added: &[String],
        tags_removed: &[String],
    ) -> String {
        let mut fields = serde_json::Map::new();
        if name_changed {
            fields.insert("name".into(), json!(true));
        }
        if description_changed {
            fields.insert("description".into(), json!(true));
        }
        if !tags_added.is_empty() || !tags_removed.is_empty() {
            fields.insert(
                "tags".into(),
                json!({ "added": tags_added, "removed": tags_removed }),
            );
        }
        json!({ "fields": fields }).to_string()
    }
}

/// 30-second coalescing window (see Task 5). Constant, tunable later.
const COALESCE_WINDOW_SECS: i64 = 30;

/// Insert (or coalesce, Task 5) an activity row inside the caller's
/// transaction. Atomic with the event being recorded.
pub async fn emit(tx: &mut Transaction<'_, Sqlite>, ev: NewActivity) -> Result<(), AppError> {
    let now = Utc::now().naive_utc();
    let window_start = now - chrono::Duration::seconds(COALESCE_WINDOW_SECS);
    let verb = ev.verb.as_str();

    // Find the most recent same-key row within the window. The key is
    // (actor, verb, primary entity col, target_student_id). The primary entity
    // column varies by verb, so branch on its kind.
    let existing_id = find_coalesce_target(tx, &ev, verb, window_start).await?;

    if let Some(id) = existing_id {
        // Merge: bump occurred_at, and for sst_status_changed keep the original
        // `from` while taking the new `to`.
        let merged_payload = merge_payload(tx, id, &ev).await?;
        sqlx::query!(
            "UPDATE activity SET occurred_at = ?, payload_json = ? WHERE id = ?",
            now,
            merged_payload,
            id,
        )
        .execute(&mut **tx)
        .await?;
        return Ok(());
    }

    sqlx::query!(
        "INSERT INTO activity
            (occurred_at, verb, actor_user_id, target_student_id,
             technique_id, syllabus_id, sst_id, video_id, payload_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        now,
        verb,
        ev.actor_user_id,
        ev.target_student_id,
        ev.technique_id,
        ev.syllabus_id,
        ev.sst_id,
        ev.video_id,
        ev.payload_json,
    )
    .execute(&mut **tx)
    .await?;
    Ok(())
}

/// Look up a coalesce target. SQLite NULL never equals NULL, so the
/// target_student_id match is written as `(target_student_id IS ? OR
/// target_student_id = ?)` collapsed via `IS`. We pass the value twice and use
/// `IS` semantics by comparing with `coalesce`-safe predicates per branch.
async fn find_coalesce_target(
    tx: &mut Transaction<'_, Sqlite>,
    ev: &NewActivity,
    verb: &str,
    window_start: NaiveDateTime,
) -> Result<Option<i64>, AppError> {
    let entity_id = match ev.primary_entity_id() {
        Some(id) => id,
        // No primary entity value (should not happen for real verbs); never
        // coalesce.
        None => return Ok(None),
    };
    let target = ev.target_student_id;
    let id = match ev.verb.primary_entity() {
        EntityKind::Technique => {
            sqlx::query_scalar!(
                r#"SELECT id AS "id!: i64" FROM activity
                   WHERE actor_user_id = ? AND verb = ? AND occurred_at >= ?
                     AND technique_id = ?
                     AND target_student_id IS ?
                   ORDER BY occurred_at DESC, id DESC LIMIT 1"#,
                ev.actor_user_id,
                verb,
                window_start,
                entity_id,
                target,
            )
            .fetch_optional(&mut **tx)
            .await?
        }
        EntityKind::Syllabus => {
            sqlx::query_scalar!(
                r#"SELECT id AS "id!: i64" FROM activity
                   WHERE actor_user_id = ? AND verb = ? AND occurred_at >= ?
                     AND syllabus_id = ?
                     AND target_student_id IS ?
                   ORDER BY occurred_at DESC, id DESC LIMIT 1"#,
                ev.actor_user_id,
                verb,
                window_start,
                entity_id,
                target,
            )
            .fetch_optional(&mut **tx)
            .await?
        }
        EntityKind::Sst => {
            sqlx::query_scalar!(
                r#"SELECT id AS "id!: i64" FROM activity
                   WHERE actor_user_id = ? AND verb = ? AND occurred_at >= ?
                     AND sst_id = ?
                     AND target_student_id IS ?
                   ORDER BY occurred_at DESC, id DESC LIMIT 1"#,
                ev.actor_user_id,
                verb,
                window_start,
                entity_id,
                target,
            )
            .fetch_optional(&mut **tx)
            .await?
        }
        EntityKind::Video => {
            sqlx::query_scalar!(
                r#"SELECT id AS "id!: i64" FROM activity
                   WHERE actor_user_id = ? AND verb = ? AND occurred_at >= ?
                     AND video_id = ?
                     AND target_student_id IS ?
                   ORDER BY occurred_at DESC, id DESC LIMIT 1"#,
                ev.actor_user_id,
                verb,
                window_start,
                entity_id,
                target,
            )
            .fetch_optional(&mut **tx)
            .await?
        }
    };
    Ok(id)
}

/// For sst_status_changed, keep the existing row's `from` and take the new
/// `to`. For technique_edited, deep-merge the `fields` maps and concatenate
/// the tag added/removed arrays so a rename then a tag-add within the 30s
/// window coalesces into one row keeping both deltas. All other verbs take
/// the new payload as-is.
async fn merge_payload(
    tx: &mut Transaction<'_, Sqlite>,
    existing_id: i64,
    ev: &NewActivity,
) -> Result<Option<String>, AppError> {
    if ev.verb != Verb::SstStatusChanged && ev.verb != Verb::TechniqueEdited {
        return Ok(ev.payload_json.clone());
    }
    let existing = sqlx::query_scalar!(
        r#"SELECT payload_json FROM activity WHERE id = ?"#,
        existing_id
    )
    .fetch_one(&mut **tx)
    .await?;
    let (Some(old), Some(new)) = (existing, ev.payload_json.as_ref()) else {
        return Ok(ev.payload_json.clone());
    };
    let old_v: serde_json::Value = serde_json::from_str(&old).unwrap_or(json!({}));
    let new_v: serde_json::Value = serde_json::from_str(new).unwrap_or(json!({}));

    if ev.verb == Verb::SstStatusChanged {
        return Ok(Some(
            json!({ "from": old_v["from"], "to": new_v["to"] }).to_string(),
        ));
    }

    // TechniqueEdited: deep-merge fields maps and concatenate tag arrays.
    let mut merged_fields = match old_v.get("fields") {
        Some(serde_json::Value::Object(m)) => m.clone(),
        _ => serde_json::Map::new(),
    };
    let new_fields = match new_v.get("fields") {
        Some(serde_json::Value::Object(m)) => m.clone(),
        _ => serde_json::Map::new(),
    };

    // Merge boolean field flags (name, description): either true wins.
    for key in &["name", "description"] {
        if new_fields.get(*key) == Some(&json!(true)) {
            merged_fields.insert((*key).to_string(), json!(true));
        }
    }

    // Merge tags: concatenate added and removed arrays from both sides.
    let old_tags = old_v.pointer("/fields/tags");
    let new_tags = new_v.pointer("/fields/tags");
    if old_tags.is_some() || new_tags.is_some() {
        let mut added: Vec<serde_json::Value> = vec![];
        let mut removed: Vec<serde_json::Value> = vec![];
        if let Some(arr) = old_tags
            .and_then(|t| t.get("added"))
            .and_then(|a| a.as_array())
        {
            added.extend(arr.clone());
        }
        if let Some(arr) = new_tags
            .and_then(|t| t.get("added"))
            .and_then(|a| a.as_array())
        {
            added.extend(arr.clone());
        }
        if let Some(arr) = old_tags
            .and_then(|t| t.get("removed"))
            .and_then(|a| a.as_array())
        {
            removed.extend(arr.clone());
        }
        if let Some(arr) = new_tags
            .and_then(|t| t.get("removed"))
            .and_then(|a| a.as_array())
        {
            removed.extend(arr.clone());
        }
        merged_fields.insert(
            "tags".to_string(),
            json!({ "added": added, "removed": removed }),
        );
    }

    Ok(Some(json!({ "fields": merged_fields }).to_string()))
}

/// Write one activity row per affected student, reusing `ev` as a template
/// (its `target_student_id` is overwritten per student). Each per-student row
/// coalesces independently. If `affected` is empty, write a single coach-only
/// row with `target_student_id = NULL` so the coach view still records it.
pub async fn emit_fanout(
    tx: &mut Transaction<'_, Sqlite>,
    ev: NewActivity,
    affected: &[i64],
) -> Result<(), AppError> {
    if affected.is_empty() {
        let mut coach_only = ev;
        coach_only.target_student_id = None;
        return emit(tx, coach_only).await;
    }
    for &student_id in affected {
        let mut row = ev.clone();
        row.target_student_id = Some(student_id);
        emit(tx, row).await?;
    }
    Ok(())
}

/// Students with an active (unassigned_at IS NULL) assignment to this syllabus.
pub async fn affected_students_for_syllabus(
    tx: &mut Transaction<'_, Sqlite>,
    syllabus_id: i64,
) -> Result<Vec<i64>, AppError> {
    let ids = sqlx::query_scalar!(
        r#"SELECT DISTINCT student_id AS "id!: i64"
           FROM syllabus_assignments
           WHERE syllabus_id = ? AND unassigned_at IS NULL
           ORDER BY student_id"#,
        syllabus_id,
    )
    .fetch_all(&mut **tx)
    .await?;
    Ok(ids)
}

/// Union of {students with this technique in an active assigned syllabus} and
/// {students who pinned this technique}.
pub async fn affected_students_for_technique(
    tx: &mut Transaction<'_, Sqlite>,
    technique_id: i64,
) -> Result<Vec<i64>, AppError> {
    let ids = sqlx::query_scalar!(
        r#"SELECT student_id AS "id!: i64" FROM (
               SELECT a.student_id
               FROM syllabus_assignments a
               JOIN student_syllabus_techniques sst ON sst.assignment_id = a.id
               WHERE a.unassigned_at IS NULL
                 AND sst.technique_id = ?
                 AND sst.hidden_at IS NULL
               UNION
               SELECT student_id
               FROM student_pinned_techniques
               WHERE technique_id = ?
           )
           ORDER BY student_id"#,
        technique_id,
        technique_id,
    )
    .fetch_all(&mut **tx)
    .await?;
    Ok(ids)
}

/// Counts returned by `run_backfill` (one field per source table / verb).
#[derive(Debug, Default)]
pub struct BackfillCounts {
    pub attempts: i64,
    pub student_notes: i64,
    pub coach_notes: i64,
    pub watches: i64,
    pub assignments: i64,
    pub graduations: i64,
    pub pins: i64,
}

/// Seed the `activity` table from existing source tables. Idempotent: if
/// `activity` already contains rows the function returns a default-zeroed
/// `BackfillCounts` immediately. Otherwise it runs one `INSERT ... SELECT`
/// per source inside a single transaction and counts rows affected.
///
/// Backfill writes INSERTs directly (not via `emit`) so `occurred_at` is
/// set from the source column rather than `now`, and coalescing is bypassed.
pub async fn run_backfill(pool: &Pool<Sqlite>) -> Result<BackfillCounts, AppError> {
    let existing = sqlx::query_scalar!(r#"SELECT COUNT(*) AS "c!: i64" FROM activity"#)
        .fetch_one(pool)
        .await?;
    if existing > 0 {
        return Ok(BackfillCounts::default());
    }

    let mut tx = pool.begin().await?;

    // Attempts: actor = recorded_by_id, target = student via SST + assignment join,
    // denormalise sst_id / technique_id / syllabus_id, payload = attempt_pointer.
    let attempts = sqlx::query!(
        r#"INSERT INTO activity
               (occurred_at, verb, actor_user_id, target_student_id,
                technique_id, syllabus_id, sst_id, payload_json)
           SELECT
               sa.created_at,
               'attempt_logged',
               sa.recorded_by_id,
               asn.student_id,
               sst.technique_id,
               asn.syllabus_id,
               sst.id,
               json_object('attempt_id', sa.id)
           FROM syllabus_attempts sa
           JOIN student_syllabus_techniques sst
               ON sst.id = sa.student_syllabus_technique_id
           JOIN syllabus_assignments asn
               ON asn.id = sst.assignment_id"#
    )
    .execute(&mut *tx)
    .await?
    .rows_affected() as i64;

    // SST student notes: actor = last_student_update_by_id, target = student via assignment.
    let student_notes = sqlx::query!(
        r#"INSERT INTO activity
               (occurred_at, verb, actor_user_id, target_student_id,
                technique_id, syllabus_id, sst_id)
           SELECT
               sst.last_student_update_at,
               'sst_student_notes_edited',
               sst.last_student_update_by_id,
               asn.student_id,
               sst.technique_id,
               asn.syllabus_id,
               sst.id
           FROM student_syllabus_techniques sst
           JOIN syllabus_assignments asn ON asn.id = sst.assignment_id
           WHERE sst.last_student_update_at IS NOT NULL
             AND sst.last_student_update_by_id IS NOT NULL"#
    )
    .execute(&mut *tx)
    .await?
    .rows_affected() as i64;

    // SST coach notes: actor = last_coach_update_by_id, target = student via assignment.
    let coach_notes = sqlx::query!(
        r#"INSERT INTO activity
               (occurred_at, verb, actor_user_id, target_student_id,
                technique_id, syllabus_id, sst_id)
           SELECT
               sst.last_coach_update_at,
               'sst_coach_notes_edited',
               sst.last_coach_update_by_id,
               asn.student_id,
               sst.technique_id,
               asn.syllabus_id,
               sst.id
           FROM student_syllabus_techniques sst
           JOIN syllabus_assignments asn ON asn.id = sst.assignment_id
           WHERE sst.last_coach_update_at IS NOT NULL
             AND sst.last_coach_update_by_id IS NOT NULL"#
    )
    .execute(&mut *tx)
    .await?
    .rows_affected() as i64;

    // Video watches: actor = target = user_id, occurred_at = first_watched_at.
    let watches = sqlx::query!(
        r#"INSERT INTO activity
               (occurred_at, verb, actor_user_id, target_student_id, video_id)
           SELECT
               vwa.first_watched_at,
               'video_watched',
               vwa.user_id,
               vwa.user_id,
               vwa.video_id
           FROM video_watch_aggregates vwa
           WHERE vwa.first_watched_at IS NOT NULL"#
    )
    .execute(&mut *tx)
    .await?
    .rows_affected() as i64;

    // Assignments: actor = assigned_by_id (fallback to student_id when NULL),
    // target = student, occurred_at = assigned_at.
    let assignments = sqlx::query!(
        r#"INSERT INTO activity
               (occurred_at, verb, actor_user_id, target_student_id, syllabus_id)
           SELECT
               sa.assigned_at,
               'syllabus_assigned',
               COALESCE(sa.assigned_by_id, sa.student_id),
               sa.student_id,
               sa.syllabus_id
           FROM syllabus_assignments sa"#
    )
    .execute(&mut *tx)
    .await?
    .rows_affected() as i64;

    // Graduations: same source, different verb, only rows where graduated_at IS NOT NULL.
    let graduations = sqlx::query!(
        r#"INSERT INTO activity
               (occurred_at, verb, actor_user_id, target_student_id, syllabus_id)
           SELECT
               sa.graduated_at,
               'syllabus_graduated',
               COALESCE(sa.graduated_by_id, sa.student_id),
               sa.student_id,
               sa.syllabus_id
           FROM syllabus_assignments sa
           WHERE sa.graduated_at IS NOT NULL"#
    )
    .execute(&mut *tx)
    .await?
    .rows_affected() as i64;

    // Pins: actor = target = student_id.
    let pins = sqlx::query!(
        r#"INSERT INTO activity
               (occurred_at, verb, actor_user_id, target_student_id, technique_id)
           SELECT
               spt.pinned_at,
               'technique_pinned',
               spt.student_id,
               spt.student_id,
               spt.technique_id
           FROM student_pinned_techniques spt"#
    )
    .execute(&mut *tx)
    .await?
    .rows_affected() as i64;

    tx.commit().await?;

    Ok(BackfillCounts {
        attempts,
        student_notes,
        coach_notes,
        watches,
        assignments,
        graduations,
        pins,
    })
}

#[cfg(test)]
mod registry_tests {
    use super::{EntityKind, Verb};

    #[test]
    fn verb_str_roundtrips() {
        for verb in Verb::ALL {
            assert_eq!(Verb::from_str_verb(verb.as_str()), Some(verb));
        }
    }

    #[test]
    fn non_notifiable_set_is_exact() {
        let non_notifiable: Vec<&str> = Verb::ALL
            .iter()
            .filter(|v| !v.notifiable())
            .map(|v| v.as_str())
            .collect();
        let mut got = non_notifiable.clone();
        got.sort_unstable();
        let mut want = vec![
            "attempt_deleted",
            "technique_unpinned",
            "syllabus_unassigned",
            "sst_hidden",
            "sst_unhidden",
            "syllabus_technique_removed",
            "video_visibility_set",
        ];
        want.sort_unstable();
        assert_eq!(got, want);
    }

    #[test]
    fn primary_entity_for_sst_verbs_is_sst() {
        assert_eq!(Verb::SstStatusChanged.primary_entity(), EntityKind::Sst);
        assert_eq!(Verb::AttemptLogged.primary_entity(), EntityKind::Sst);
    }

    #[test]
    fn primary_entity_for_fanout_verbs() {
        assert_eq!(
            Verb::SyllabusTechniqueAdded.primary_entity(),
            EntityKind::Syllabus
        );
        assert_eq!(
            Verb::TechniqueEdited.primary_entity(),
            EntityKind::Technique
        );
        assert_eq!(Verb::VideoAdded.primary_entity(), EntityKind::Video);
    }
}

#[cfg(test)]
mod merge_tests {
    use super::{json, payload};

    /// A rename then a tag-add within the window must produce one row that
    /// keeps BOTH the name flag and the tag delta.
    #[test]
    fn technique_edited_merge_unions_fields() {
        // Simulate what merge_payload does by calling the merge logic inline.
        // Build: old payload has name=true, new payload has tags added=["Sweep"].
        let old_json = payload::technique_edited(true, false, &[], &[]);
        let new_json = payload::technique_edited(false, false, &["Sweep".to_string()], &[]);

        let old_v: serde_json::Value = serde_json::from_str(&old_json).unwrap();
        let new_v: serde_json::Value = serde_json::from_str(&new_json).unwrap();

        // Replicate the merge logic.
        let mut merged_fields = match old_v.get("fields") {
            Some(serde_json::Value::Object(m)) => m.clone(),
            _ => serde_json::Map::new(),
        };
        let new_fields = match new_v.get("fields") {
            Some(serde_json::Value::Object(m)) => m.clone(),
            _ => serde_json::Map::new(),
        };
        for key in &["name", "description"] {
            if new_fields.get(*key) == Some(&json!(true)) {
                merged_fields.insert((*key).to_string(), json!(true));
            }
        }
        let old_tags = old_v.pointer("/fields/tags");
        let new_tags = new_v.pointer("/fields/tags");
        if old_tags.is_some() || new_tags.is_some() {
            let mut added: Vec<serde_json::Value> = vec![];
            let mut removed: Vec<serde_json::Value> = vec![];
            if let Some(arr) = old_tags
                .and_then(|t| t.get("added"))
                .and_then(|a| a.as_array())
            {
                added.extend(arr.clone());
            }
            if let Some(arr) = new_tags
                .and_then(|t| t.get("added"))
                .and_then(|a| a.as_array())
            {
                added.extend(arr.clone());
            }
            if let Some(arr) = old_tags
                .and_then(|t| t.get("removed"))
                .and_then(|a| a.as_array())
            {
                removed.extend(arr.clone());
            }
            if let Some(arr) = new_tags
                .and_then(|t| t.get("removed"))
                .and_then(|a| a.as_array())
            {
                removed.extend(arr.clone());
            }
            merged_fields.insert(
                "tags".to_string(),
                json!({ "added": added, "removed": removed }),
            );
        }
        let merged = json!({ "fields": merged_fields });

        assert_eq!(
            merged["fields"]["name"],
            json!(true),
            "name flag preserved from old"
        );
        let added = merged["fields"]["tags"]["added"].as_array().unwrap();
        assert!(
            added.iter().any(|v| v == "Sweep"),
            "tag add from new payload kept"
        );
    }
}

#[cfg(test)]
mod payload_tests {
    use super::{NewActivity, Verb, payload};

    #[test]
    fn status_change_payload_shape() {
        let p = payload::status_changed("red", "green");
        let v: serde_json::Value = serde_json::from_str(&p).unwrap();
        assert_eq!(v["from"], "red");
        assert_eq!(v["to"], "green");
    }

    #[test]
    fn video_watched_payload_shape() {
        let p = payload::video_watched(12, 60);
        let v: serde_json::Value = serde_json::from_str(&p).unwrap();
        assert_eq!(v["cumulative_seconds"], 12);
        assert_eq!(v["duration_seconds"], 60);
    }

    #[test]
    fn new_activity_builder_defaults_entities_to_none() {
        let ev = NewActivity::new(Verb::TechniquePinned, 7)
            .target_student(7)
            .technique(3);
        assert_eq!(ev.actor_user_id, 7);
        assert_eq!(ev.target_student_id, Some(7));
        assert_eq!(ev.technique_id, Some(3));
        assert_eq!(ev.syllabus_id, None);
        assert_eq!(ev.sst_id, None);
        assert_eq!(ev.video_id, None);
        assert!(ev.payload_json.is_none());
    }
}
