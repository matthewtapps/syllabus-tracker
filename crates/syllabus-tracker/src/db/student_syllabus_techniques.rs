//! Per-(assignment, technique) progress rows. The student sees one of
//! these per technique in their syllabus view; the coach sees all of
//! them including soft-hidden ones (PR 4 adds the hidden-toggle).

use std::collections::HashMap;

use chrono::NaiveDateTime;
use serde::Serialize;
use sqlx::{Pool, Sqlite};
use tracing::instrument;

use crate::auth::{Role, User};
use crate::error::AppError;
use crate::models::Tag;

#[derive(Debug, Serialize)]
pub struct SstRow {
    pub id: i64,
    pub assignment_id: i64,
    pub technique_id: i64,
    pub technique_name: String,
    pub technique_description: String,
    pub status: String,
    pub student_notes: String,
    pub coach_notes: String,
    pub hidden_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub last_coach_update_at: Option<String>,
    pub last_coach_update_by_id: Option<i64>,
    pub last_student_update_at: Option<String>,
    pub last_student_update_by_id: Option<i64>,
    pub tags: Vec<Tag>,
    pub attempt_count: i64,
    pub last_attempt_at: Option<String>,
}

#[derive(Debug, Default)]
pub struct SstUpdate {
    pub status: Option<String>,
    pub student_notes: Option<String>,
    pub coach_notes: Option<String>,
}

fn rfc3339(dt: NaiveDateTime) -> String {
    chrono::DateTime::<chrono::Utc>::from_naive_utc_and_offset(dt, chrono::Utc).to_rfc3339()
}

#[instrument]
pub async fn list_for_assignment(
    pool: &Pool<Sqlite>,
    assignment_id: i64,
    viewer: &User,
) -> Result<Vec<SstRow>, AppError> {
    let viewer_is_coach = matches!(viewer.role, Role::Coach | Role::Admin);

    let rows = sqlx::query!(
        r#"SELECT sst.id AS "id!: i64",
                  sst.assignment_id AS "assignment_id!: i64",
                  sst.technique_id AS "technique_id!: i64",
                  t.name AS "technique_name!: String",
                  t.description AS "technique_description!: String",
                  sst.status AS "status!: String",
                  sst.student_notes,
                  sst.coach_notes,
                  sst.hidden_at AS "hidden_at?: NaiveDateTime",
                  sst.created_at AS "created_at!: NaiveDateTime",
                  sst.updated_at AS "updated_at!: NaiveDateTime",
                  sst.last_coach_update_at AS "last_coach_update_at?: NaiveDateTime",
                  sst.last_coach_update_by_id,
                  sst.last_student_update_at AS "last_student_update_at?: NaiveDateTime",
                  sst.last_student_update_by_id,
                  COALESCE((SELECT COUNT(*) FROM syllabus_attempts WHERE student_syllabus_technique_id = sst.id), 0) AS "attempt_count!: i64",
                  (SELECT MAX(attempted_at) FROM syllabus_attempts WHERE student_syllabus_technique_id = sst.id) AS "last_attempt_at?: NaiveDateTime"
           FROM student_syllabus_techniques sst
           JOIN techniques t ON t.id = sst.technique_id
           WHERE sst.assignment_id = ?
             AND (? = 1 OR sst.hidden_at IS NULL)
           ORDER BY t.name"#,
        assignment_id,
        viewer_is_coach,
    )
    .fetch_all(pool)
    .await?;

    let tag_rows = sqlx::query!(
        r#"SELECT sst.technique_id AS "technique_id!: i64",
                  tag.id AS "tag_id!: i64",
                  tag.name AS "tag_name!: String"
           FROM student_syllabus_techniques sst
           JOIN technique_tags tt ON tt.technique_id = sst.technique_id
           JOIN tags tag ON tag.id = tt.tag_id
           WHERE sst.assignment_id = ?
           ORDER BY tag.name"#,
        assignment_id,
    )
    .fetch_all(pool)
    .await?;
    let mut tags_by_tid: HashMap<i64, Vec<Tag>> = HashMap::new();
    for row in tag_rows {
        tags_by_tid.entry(row.technique_id).or_default().push(Tag {
            id: row.tag_id,
            name: row.tag_name,
        });
    }

    Ok(rows
        .into_iter()
        .map(|r| SstRow {
            id: r.id,
            assignment_id: r.assignment_id,
            technique_id: r.technique_id,
            technique_name: r.technique_name,
            technique_description: r.technique_description,
            status: r.status,
            student_notes: r.student_notes.unwrap_or_default(),
            coach_notes: r.coach_notes.unwrap_or_default(),
            hidden_at: r.hidden_at.map(rfc3339),
            created_at: rfc3339(r.created_at),
            updated_at: rfc3339(r.updated_at),
            last_coach_update_at: r.last_coach_update_at.map(rfc3339),
            last_coach_update_by_id: r.last_coach_update_by_id,
            last_student_update_at: r.last_student_update_at.map(rfc3339),
            last_student_update_by_id: r.last_student_update_by_id,
            tags: tags_by_tid.remove(&r.technique_id).unwrap_or_default(),
            attempt_count: r.attempt_count,
            last_attempt_at: r.last_attempt_at.map(rfc3339),
        })
        .collect())
}

#[derive(Debug)]
pub struct SstOwner {
    pub assignment_id: i64,
    pub student_id: i64,
    pub syllabus_id: i64,
}

#[instrument]
pub async fn get_owner(
    pool: &Pool<Sqlite>,
    sst_id: i64,
) -> Result<Option<SstOwner>, AppError> {
    let row = sqlx::query!(
        r#"SELECT sst.assignment_id AS "assignment_id!: i64",
                  a.student_id AS "student_id!: i64",
                  a.syllabus_id AS "syllabus_id!: i64"
           FROM student_syllabus_techniques sst
           JOIN syllabus_assignments a ON a.id = sst.assignment_id
           WHERE sst.id = ?"#,
        sst_id,
    )
    .fetch_optional(pool)
    .await?;
    Ok(row.map(|r| SstOwner {
        assignment_id: r.assignment_id,
        student_id: r.student_id,
        syllabus_id: r.syllabus_id,
    }))
}

/// Partial-update SST. Only the fields the caller provided appear in the
/// UPDATE set, so concurrent edits on disjoint fields do not clobber each
/// other. Bookkeeping bumps the actor's role pair (coach pair for
/// Coach / Admin, student pair for Student) regardless of which fields
/// changed, matching how legacy `student_techniques` tracked it.
#[instrument(skip(pool, update))]
pub async fn update_sst(
    pool: &Pool<Sqlite>,
    sst_id: i64,
    actor: &User,
    update: &SstUpdate,
) -> Result<(), AppError> {
    let now = chrono::Utc::now().naive_utc();
    let actor_is_coach = matches!(actor.role, Role::Coach | Role::Admin);

    // Common bookkeeping first.
    if actor_is_coach {
        sqlx::query!(
            "UPDATE student_syllabus_techniques
             SET updated_at = ?, last_coach_update_at = ?, last_coach_update_by_id = ?
             WHERE id = ?",
            now,
            now,
            actor.id,
            sst_id,
        )
        .execute(pool)
        .await?;
    } else {
        sqlx::query!(
            "UPDATE student_syllabus_techniques
             SET updated_at = ?, last_student_update_at = ?, last_student_update_by_id = ?
             WHERE id = ?",
            now,
            now,
            actor.id,
            sst_id,
        )
        .execute(pool)
        .await?;
    }

    if let Some(ref status) = update.status {
        sqlx::query!(
            "UPDATE student_syllabus_techniques SET status = ? WHERE id = ?",
            status,
            sst_id,
        )
        .execute(pool)
        .await?;
    }
    if let Some(ref notes) = update.student_notes {
        sqlx::query!(
            "UPDATE student_syllabus_techniques SET student_notes = ? WHERE id = ?",
            notes,
            sst_id,
        )
        .execute(pool)
        .await?;
    }
    if let Some(ref notes) = update.coach_notes {
        sqlx::query!(
            "UPDATE student_syllabus_techniques SET coach_notes = ? WHERE id = ?",
            notes,
            sst_id,
        )
        .execute(pool)
        .await?;
    }
    Ok(())
}

#[instrument]
pub async fn get_sst_id(
    pool: &Pool<Sqlite>,
    assignment_id: i64,
    technique_id: i64,
) -> Result<Option<i64>, AppError> {
    let id = sqlx::query_scalar!(
        r#"SELECT id AS "id!: i64"
           FROM student_syllabus_techniques
           WHERE assignment_id = ? AND technique_id = ?"#,
        assignment_id,
        technique_id,
    )
    .fetch_optional(pool)
    .await?;
    Ok(id)
}
