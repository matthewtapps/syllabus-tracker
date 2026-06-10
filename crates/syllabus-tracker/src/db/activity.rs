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
