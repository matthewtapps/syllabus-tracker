//! Activity event-log write side. Owns the row shape, the code-side verb
//! registry (verb -> primary entity column + notifiable flag), typed payload
//! constructors, and the `emit` / `emit_fanout` helpers. Every live write path
//! calls into here inside its own transaction so the activity row is atomic
//! with the event it records. This module never deserialises payloads; the
//! typed read side lands in PR 2 (`db/activity_read.rs`).

#[allow(unused_imports)]
use chrono::{NaiveDateTime, Utc};
#[allow(unused_imports)]
use serde::Serialize;
#[allow(unused_imports)]
use serde_json::json;
#[allow(unused_imports)]
use sqlx::{Sqlite, Transaction};

#[allow(unused_imports)]
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
    #[allow(dead_code)]
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
        assert_eq!(Verb::TechniqueEdited.primary_entity(), EntityKind::Technique);
        assert_eq!(Verb::VideoAdded.primary_entity(), EntityKind::Video);
    }
}

#[cfg(test)]
mod payload_tests {
    use super::{payload, NewActivity, Verb};

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
        let ev = NewActivity::new(Verb::TechniquePinned, 7).target_student(7).technique(3);
        assert_eq!(ev.actor_user_id, 7);
        assert_eq!(ev.target_student_id, Some(7));
        assert_eq!(ev.technique_id, Some(3));
        assert_eq!(ev.syllabus_id, None);
        assert_eq!(ev.sst_id, None);
        assert_eq!(ev.video_id, None);
        assert!(ev.payload_json.is_none());
    }
}
