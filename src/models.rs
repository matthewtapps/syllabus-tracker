use chrono::{DateTime, NaiveDateTime, Utc};
use serde::Serialize;

#[derive(Serialize)]
pub struct Technique {
    pub id: i64,
    pub name: String,
    pub description: String,
    pub coach_id: i64,
    pub coach_name: String, // Denormalized for convenience
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
            created_at: db
                .created_at
                .map(|dt| {
                    chrono::DateTime::<chrono::Utc>::from_naive_utc_and_offset(dt, chrono::Utc)
                })
                .unwrap_or_else(chrono::Utc::now),
            updated_at: db
                .updated_at
                .map(|dt| {
                    chrono::DateTime::<chrono::Utc>::from_naive_utc_and_offset(dt, chrono::Utc)
                })
                .unwrap_or_else(chrono::Utc::now),
        }
    }
}
