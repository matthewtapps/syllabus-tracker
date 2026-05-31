use chrono::{DateTime, NaiveDateTime, Utc};
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Clone)]
pub struct Technique {
    pub id: i64,
    pub name: String,
    pub description: String,
    pub coach_id: i64,
    pub coach_name: String, // Denormalized for convenience
    pub tags: Vec<Tag>,
}

#[derive(sqlx::FromRow, Clone)]
pub struct DbTechnique {
    pub id: Option<i64>,
    pub name: Option<String>,
    pub description: Option<String>,
    pub coach_id: Option<i64>,
    pub coach_name: Option<String>,
}

impl From<DbTechnique> for Technique {
    fn from(technique: DbTechnique) -> Self {
        Self {
            id: technique.id.unwrap_or_default(),
            name: technique.name.unwrap_or_default(),
            description: technique.description.unwrap_or_default(),
            coach_id: technique.coach_id.unwrap_or_default(),
            coach_name: technique.coach_name.unwrap_or_default(),
            tags: Vec::new(),
        }
    }
}

#[derive(Serialize)]
pub struct StudentTechnique {
    pub id: i64,
    pub technique_id: i64,
    pub student_id: i64,
    pub technique_name: String,
    pub technique_description: String,
    pub status: String,
    pub student_notes: String,
    pub coach_notes: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub last_coach_update_at: Option<DateTime<Utc>>,
    pub last_coach_update_by_id: Option<i64>,
    pub last_coach_update_by_name: Option<String>,
    pub last_student_update_at: Option<DateTime<Utc>>,
    pub last_student_update_by_id: Option<i64>,
    pub last_student_update_by_name: Option<String>,
    pub collection_id: Option<i64>,
    pub collection_name: Option<String>,
    pub tags: Vec<Tag>,
    pub attempt_count: i64,
    pub last_attempt_at: Option<DateTime<Utc>>,
    /// When the viewer (whoever the request was made for) last opened this
    /// row. `None` means they have never opened it. Drives `has_unseen_activity`
    /// in the API response.
    pub viewer_seen_at: Option<DateTime<Utc>>,
}

#[derive(sqlx::FromRow, Clone, Default)]
pub struct DbStudentTechnique {
    pub id: Option<i64>,
    pub technique_id: Option<i64>,
    pub student_id: Option<i64>,
    pub technique_name: Option<String>,
    pub technique_description: Option<String>,
    pub status: Option<String>,
    pub student_notes: Option<String>,
    pub coach_notes: Option<String>,
    pub created_at: Option<NaiveDateTime>,
    pub updated_at: Option<NaiveDateTime>,
    pub last_coach_update_at: Option<NaiveDateTime>,
    pub last_coach_update_by_id: Option<i64>,
    pub last_student_update_at: Option<NaiveDateTime>,
    pub last_student_update_by_id: Option<i64>,
    pub collection_id: Option<i64>,
}

pub fn naive_to_utc(dt: NaiveDateTime) -> DateTime<Utc> {
    DateTime::<Utc>::from_naive_utc_and_offset(dt, Utc)
}

impl From<DbStudentTechnique> for StudentTechnique {
    fn from(db: DbStudentTechnique) -> Self {
        Self {
            id: db.id.unwrap_or_default(),
            technique_id: db.technique_id.unwrap_or_default(),
            student_id: db.student_id.unwrap_or_default(),
            technique_name: db.technique_name.unwrap_or_default(),
            technique_description: db.technique_description.unwrap_or_default(),
            status: db.status.unwrap_or_default(),
            student_notes: db.student_notes.unwrap_or_default(),
            coach_notes: db.coach_notes.unwrap_or_default(),
            created_at: db.created_at.map(naive_to_utc).unwrap_or_else(Utc::now),
            updated_at: db.updated_at.map(naive_to_utc).unwrap_or_else(Utc::now),
            last_coach_update_at: db.last_coach_update_at.map(naive_to_utc),
            last_coach_update_by_id: db.last_coach_update_by_id,
            last_coach_update_by_name: None,
            last_student_update_at: db.last_student_update_at.map(naive_to_utc),
            last_student_update_by_id: db.last_student_update_by_id,
            last_student_update_by_name: None,
            collection_id: db.collection_id,
            collection_name: None,
            tags: Vec::new(),
            attempt_count: 0,
            last_attempt_at: None,
            viewer_seen_at: None,
        }
    }
}

#[derive(Debug, Serialize, Clone)]
pub struct Attempt {
    pub id: i64,
    pub student_technique_id: i64,
    pub recorded_by_id: i64,
    pub recorded_by_name: Option<String>,
    pub attempted_at: DateTime<Utc>,
    pub coach_note: Option<String>,
    pub coach_note_by_id: Option<i64>,
    pub coach_note_by_name: Option<String>,
    pub coach_note_at: Option<DateTime<Utc>>,
    pub student_note: Option<String>,
    pub student_note_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum VideoKind {
    Native,
    Youtube,
    Vimeo,
    Drive,
    Link,
}

impl VideoKind {
    pub fn as_str(&self) -> &'static str {
        match self {
            VideoKind::Native => "native",
            VideoKind::Youtube => "youtube",
            VideoKind::Vimeo => "vimeo",
            VideoKind::Drive => "drive",
            VideoKind::Link => "link",
        }
    }

    pub fn from_str(s: &str) -> Self {
        match s {
            "native" => VideoKind::Native,
            "youtube" => VideoKind::Youtube,
            "vimeo" => VideoKind::Vimeo,
            "drive" => VideoKind::Drive,
            _ => VideoKind::Link,
        }
    }
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ProcessingStatus {
    Processing,
    Ready,
    Failed,
}

impl ProcessingStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            ProcessingStatus::Processing => "processing",
            ProcessingStatus::Ready => "ready",
            ProcessingStatus::Failed => "failed",
        }
    }

    pub fn from_str(s: &str) -> Self {
        match s {
            "ready" => ProcessingStatus::Ready,
            "failed" => ProcessingStatus::Failed,
            _ => ProcessingStatus::Processing,
        }
    }
}

#[derive(Debug, Serialize, Clone)]
pub struct Video {
    pub id: i64,
    pub technique_id: i64,
    pub title: String,
    pub description: Option<String>,
    pub position: i64,
    pub kind: VideoKind,
    pub processing_status: ProcessingStatus,
    pub processing_error: Option<String>,
    pub bytes: Option<i64>,
    pub duration_seconds: Option<i64>,
    pub width: Option<i64>,
    pub height: Option<i64>,
    pub external_url: Option<String>,
    pub external_host: Option<String>,
    pub external_video_id: Option<String>,
    pub uploaded_by_id: i64,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(sqlx::FromRow, Clone, Default)]
pub struct DbVideo {
    pub id: Option<i64>,
    pub technique_id: Option<i64>,
    pub title: Option<String>,
    pub description: Option<String>,
    pub position: Option<i64>,
    pub kind: Option<String>,
    pub processing_status: Option<String>,
    pub processing_error: Option<String>,
    pub storage_key: Option<String>,
    pub bytes: Option<i64>,
    pub duration_seconds: Option<i64>,
    pub width: Option<i64>,
    pub height: Option<i64>,
    pub external_url: Option<String>,
    pub external_host: Option<String>,
    pub external_video_id: Option<String>,
    pub uploaded_by_id: Option<i64>,
    pub created_at: Option<NaiveDateTime>,
    pub updated_at: Option<NaiveDateTime>,
}

impl From<DbVideo> for Video {
    fn from(db: DbVideo) -> Self {
        Self {
            id: db.id.unwrap_or_default(),
            technique_id: db.technique_id.unwrap_or_default(),
            title: db.title.unwrap_or_default(),
            description: db.description,
            position: db.position.unwrap_or_default(),
            kind: VideoKind::from_str(db.kind.as_deref().unwrap_or("link")),
            processing_status: ProcessingStatus::from_str(
                db.processing_status.as_deref().unwrap_or("processing"),
            ),
            processing_error: db.processing_error,
            bytes: db.bytes,
            duration_seconds: db.duration_seconds,
            width: db.width,
            height: db.height,
            external_url: db.external_url,
            external_host: db.external_host,
            external_video_id: db.external_video_id,
            uploaded_by_id: db.uploaded_by_id.unwrap_or_default(),
            created_at: db.created_at.map(naive_to_utc).unwrap_or_else(Utc::now),
            updated_at: db.updated_at.map(naive_to_utc).unwrap_or_else(Utc::now),
        }
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Tag {
    pub id: i64,
    pub name: String,
}

#[derive(sqlx::FromRow, Clone, Default)]
pub struct DbTag {
    pub id: Option<i64>,
    pub name: Option<String>,
}

impl From<DbTag> for Tag {
    fn from(tag: DbTag) -> Self {
        Self {
            id: tag.id.unwrap_or_default(),
            name: tag.name.unwrap_or_default(),
        }
    }
}
