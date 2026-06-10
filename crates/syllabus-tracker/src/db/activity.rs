//! Activity event-log write side. Owns the row shape, the code-side verb
//! registry (verb -> primary entity column + notifiable flag), typed payload
//! constructors, and the `emit` / `emit_fanout` helpers. Every live write path
//! calls into here inside its own transaction so the activity row is atomic
//! with the event it records. This module never deserialises payloads; the
//! typed read side lands in PR 2 (`db/activity_read.rs`).

use chrono::{NaiveDateTime, Utc};
use serde_json::json;
use sqlx::{Sqlite, Transaction};

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
/// `to`. All other verbs take the new payload as-is.
async fn merge_payload(
    tx: &mut Transaction<'_, Sqlite>,
    existing_id: i64,
    ev: &NewActivity,
) -> Result<Option<String>, AppError> {
    if ev.verb != Verb::SstStatusChanged {
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
    Ok(Some(
        json!({ "from": old_v["from"], "to": new_v["to"] }).to_string(),
    ))
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
