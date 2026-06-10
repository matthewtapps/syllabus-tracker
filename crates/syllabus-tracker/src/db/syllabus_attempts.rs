//! Attempts logged against an SST row. Parallel to legacy `attempts`,
//! which now stays dormant. `attempted_at` is client-supplied so coaches
//! can log retroactive attempts. The handler validates `attempted_at`
//! is not in the future.

use chrono::{DateTime, NaiveDateTime, Utc};
use serde::Serialize;
use sqlx::{Pool, Sqlite};
use tracing::{info, instrument};

use crate::auth::{Permission, Role, User};
use crate::error::AppError;

#[derive(Debug, Serialize)]
pub struct SyllabusAttempt {
    pub id: i64,
    pub student_syllabus_technique_id: i64,
    pub recorded_by_id: i64,
    pub attempted_at: String,
    pub coach_note: Option<String>,
    pub coach_note_by_id: Option<i64>,
    pub coach_note_at: Option<String>,
    pub student_note: Option<String>,
    pub student_note_at: Option<String>,
    pub created_at: String,
}

fn rfc3339(dt: NaiveDateTime) -> String {
    DateTime::<Utc>::from_naive_utc_and_offset(dt, Utc).to_rfc3339()
}

/// Walks SST → assignment to verify the actor may access this attempt
/// chain. Mirrors the access shape used by the legacy attempts module.
#[instrument]
pub async fn ensure_can_access_syllabus_sst(
    pool: &Pool<Sqlite>,
    actor: &User,
    sst_id: i64,
) -> Result<(), AppError> {
    let row = sqlx::query!(
        r#"SELECT a.student_id AS "student_id!: i64"
           FROM student_syllabus_techniques sst
           JOIN syllabus_assignments a ON a.id = sst.assignment_id
           WHERE sst.id = ?"#,
        sst_id,
    )
    .fetch_optional(pool)
    .await?;
    let row = row.ok_or_else(|| AppError::NotFound("SST not found".into()))?;
    if actor.id != row.student_id && !actor.has_permission(Permission::ViewAllStudents) {
        return Err(AppError::Authorization("Forbidden".into()));
    }
    Ok(())
}

#[instrument]
pub async fn list_syllabus_attempts_for_sst(
    pool: &Pool<Sqlite>,
    sst_id: i64,
) -> Result<Vec<SyllabusAttempt>, AppError> {
    let rows = sqlx::query!(
        r#"SELECT id AS "id!: i64",
                  student_syllabus_technique_id AS "student_syllabus_technique_id!: i64",
                  recorded_by_id AS "recorded_by_id!: i64",
                  attempted_at AS "attempted_at!: NaiveDateTime",
                  coach_note,
                  coach_note_by_id,
                  coach_note_at AS "coach_note_at?: NaiveDateTime",
                  student_note,
                  student_note_at AS "student_note_at?: NaiveDateTime",
                  created_at AS "created_at!: NaiveDateTime"
           FROM syllabus_attempts
           WHERE student_syllabus_technique_id = ?
           ORDER BY attempted_at DESC, id DESC"#,
        sst_id,
    )
    .fetch_all(pool)
    .await?;
    Ok(rows
        .into_iter()
        .map(|r| SyllabusAttempt {
            id: r.id,
            student_syllabus_technique_id: r.student_syllabus_technique_id,
            recorded_by_id: r.recorded_by_id,
            attempted_at: rfc3339(r.attempted_at),
            coach_note: r.coach_note,
            coach_note_by_id: r.coach_note_by_id,
            coach_note_at: r.coach_note_at.map(rfc3339),
            student_note: r.student_note,
            student_note_at: r.student_note_at.map(rfc3339),
            created_at: rfc3339(r.created_at),
        })
        .collect())
}

#[derive(Debug)]
pub struct CreateSyllabusAttempt {
    pub attempted_at: NaiveDateTime,
    pub coach_note: Option<String>,
    pub student_note: Option<String>,
}

#[instrument]
pub async fn create_syllabus_attempt(
    pool: &Pool<Sqlite>,
    actor: &User,
    sst_id: i64,
    input: &CreateSyllabusAttempt,
) -> Result<i64, AppError> {
    let now = Utc::now().naive_utc();
    let coach_note_by_id = if input.coach_note.is_some() {
        Some(actor.id)
    } else {
        None
    };
    let coach_note_at = if input.coach_note.is_some() {
        Some(now)
    } else {
        None
    };
    let student_note_at = if input.student_note.is_some() {
        Some(now)
    } else {
        None
    };
    let res = sqlx::query!(
        "INSERT INTO syllabus_attempts (
            student_syllabus_technique_id,
            recorded_by_id,
            attempted_at,
            coach_note,
            coach_note_by_id,
            coach_note_at,
            student_note,
            student_note_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        sst_id,
        actor.id,
        input.attempted_at,
        input.coach_note,
        coach_note_by_id,
        coach_note_at,
        input.student_note,
        student_note_at,
    )
    .execute(pool)
    .await?;
    info!(sst_id, "Logged syllabus attempt");
    Ok(res.last_insert_rowid())
}

#[instrument]
pub async fn delete_syllabus_attempt(
    pool: &Pool<Sqlite>,
    attempt_id: i64,
) -> Result<(), AppError> {
    sqlx::query!("DELETE FROM syllabus_attempts WHERE id = ?", attempt_id)
        .execute(pool)
        .await?;
    Ok(())
}

#[derive(Debug, Default)]
pub struct SyllabusAttemptUpdate {
    pub attempted_at: Option<NaiveDateTime>,
    pub coach_note: Option<Option<String>>,
    pub student_note: Option<Option<String>>,
}

#[instrument(skip(pool, update))]
pub async fn update_syllabus_attempt(
    pool: &Pool<Sqlite>,
    attempt_id: i64,
    actor: &User,
    update: &SyllabusAttemptUpdate,
) -> Result<(), AppError> {
    let now = Utc::now().naive_utc();
    let actor_is_coach = matches!(actor.role, Role::Coach | Role::Admin);

    if let Some(ts) = update.attempted_at {
        sqlx::query!(
            "UPDATE syllabus_attempts SET attempted_at = ? WHERE id = ?",
            ts,
            attempt_id
        )
        .execute(pool)
        .await?;
    }
    if actor_is_coach {
        if let Some(ref note) = update.coach_note {
            sqlx::query!(
                "UPDATE syllabus_attempts
                 SET coach_note = ?, coach_note_by_id = ?, coach_note_at = ?
                 WHERE id = ?",
                note,
                actor.id,
                now,
                attempt_id,
            )
            .execute(pool)
            .await?;
        }
    } else if let Some(ref note) = update.student_note {
        sqlx::query!(
            "UPDATE syllabus_attempts
             SET student_note = ?, student_note_at = ?
             WHERE id = ?",
            note,
            now,
            attempt_id,
        )
        .execute(pool)
        .await?;
    }
    Ok(())
}

#[instrument]
pub async fn get_syllabus_attempt_sst_id(
    pool: &Pool<Sqlite>,
    attempt_id: i64,
) -> Result<Option<i64>, AppError> {
    let id = sqlx::query_scalar!(
        r#"SELECT student_syllabus_technique_id AS "id!: i64"
           FROM syllabus_attempts WHERE id = ?"#,
        attempt_id,
    )
    .fetch_optional(pool)
    .await?;
    Ok(id)
}
