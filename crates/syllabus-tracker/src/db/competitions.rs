//! Competitions: gym-wide events that students register for. A registration
//! may link to a camp (promote_camp_to_competition). All writes are coach-gated
//! at the route layer except register_student (students may self-register).

use chrono::NaiveDateTime;
use serde::Serialize;
use sqlx::{Pool, Sqlite};
use tracing::instrument;

use crate::db::activity::{emit, NewActivity, Verb};
use crate::error::AppError;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize)]
pub struct Competition {
    pub id: i64,
    pub name: String,
    /// Optional event date. Stored as TEXT (SQLite DATE) in ISO-8601 format.
    pub date: Option<String>,
    pub created_by_id: i64,
    pub created_at: NaiveDateTime,
}

#[derive(Debug, Clone, Serialize)]
pub struct Registration {
    pub id: i64,
    pub student_id: i64,
    pub competition_id: i64,
    pub registered_at: NaiveDateTime,
    pub registered_by_id: Option<i64>,
    pub unregistered_at: Option<NaiveDateTime>,
}

/// Roster row for a competition. Includes the student's display name and, if
/// they have a camp linked to this competition, that camp's id.
#[derive(Debug, Clone, Serialize)]
pub struct RegistrationRosterRow {
    pub student_id: i64,
    pub student_name: Option<String>,
    pub registered_at: NaiveDateTime,
    pub camp_id: Option<i64>,
}

// ---------------------------------------------------------------------------
// Competitions
// ---------------------------------------------------------------------------

#[instrument(skip(pool))]
pub async fn create_competition(
    pool: &Pool<Sqlite>,
    name: &str,
    date: Option<&str>,
    created_by_id: i64,
) -> Result<i64, AppError> {
    let mut tx = pool.begin().await?;
    let id = sqlx::query_scalar!(
        r#"INSERT INTO competitions (name, date, created_by_id)
           VALUES (?, ?, ?) RETURNING id AS "id!: i64""#,
        name,
        date,
        created_by_id,
    )
    .fetch_one(&mut *tx)
    .await?;
    emit(
        &mut tx,
        NewActivity::new(Verb::CompetitionCreated, created_by_id)
            .competition(id)
            .context_kind("competition"),
        // target_student is NULL: gym-wide event, not scoped to one student.
    )
    .await?;
    tx.commit().await?;
    Ok(id)
}

#[instrument(skip(pool))]
pub async fn get_competition(
    pool: &Pool<Sqlite>,
    id: i64,
) -> Result<Option<Competition>, AppError> {
    let row = sqlx::query!(
        r#"SELECT id AS "id!: i64", name,
                  date AS "date?: String",
                  created_by_id AS "created_by_id!: i64",
                  created_at AS "created_at!: NaiveDateTime"
           FROM competitions WHERE id = ?"#,
        id
    )
    .fetch_optional(pool)
    .await?;
    Ok(row.map(|r| Competition {
        id: r.id,
        name: r.name,
        date: r.date,
        created_by_id: r.created_by_id,
        created_at: r.created_at,
    }))
}

/// List all competitions, newest / soonest first. Rows with a `date` sort by
/// date ascending (upcoming first); undated rows follow, newest created first.
#[instrument(skip(pool))]
pub async fn list_competitions(pool: &Pool<Sqlite>) -> Result<Vec<Competition>, AppError> {
    let rows = sqlx::query!(
        r#"SELECT id AS "id!: i64", name,
                  date AS "date?: String",
                  created_by_id AS "created_by_id!: i64",
                  created_at AS "created_at!: NaiveDateTime"
           FROM competitions
           ORDER BY CASE WHEN date IS NULL THEN 1 ELSE 0 END,
                    date ASC,
                    created_at DESC"#
    )
    .fetch_all(pool)
    .await?;
    Ok(rows
        .into_iter()
        .map(|r| Competition {
            id: r.id,
            name: r.name,
            date: r.date,
            created_by_id: r.created_by_id,
            created_at: r.created_at,
        })
        .collect())
}

#[instrument(skip(pool))]
pub async fn update_competition(
    pool: &Pool<Sqlite>,
    id: i64,
    name: &str,
    date: Option<&str>,
) -> Result<(), AppError> {
    let affected = sqlx::query!(
        "UPDATE competitions SET name = ?, date = ? WHERE id = ?",
        name,
        date,
        id,
    )
    .execute(pool)
    .await?
    .rows_affected();
    if affected == 0 {
        return Err(AppError::NotFound(format!("competition #{id} not found")));
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Registrations
// ---------------------------------------------------------------------------

/// Register a student for a competition. On conflict (same student + comp),
/// clear `unregistered_at` and update `registered_by_id` so a re-register
/// is idempotent. Mirrors syllabus_assignments upsert pattern.
#[instrument(skip(pool))]
pub async fn register_student(
    pool: &Pool<Sqlite>,
    competition_id: i64,
    student_id: i64,
    registered_by_id: i64,
) -> Result<i64, AppError> {
    let mut tx = pool.begin().await?;
    let id = sqlx::query_scalar!(
        r#"INSERT INTO competition_registrations
               (student_id, competition_id, registered_by_id)
           VALUES (?, ?, ?)
           ON CONFLICT(student_id, competition_id)
               DO UPDATE SET unregistered_at  = NULL,
                             registered_by_id = excluded.registered_by_id,
                             registered_at    = CURRENT_TIMESTAMP
           RETURNING id AS "id!: i64""#,
        student_id,
        competition_id,
        registered_by_id,
    )
    .fetch_one(&mut *tx)
    .await?;
    emit(
        &mut tx,
        NewActivity::new(Verb::StudentRegistered, registered_by_id)
            .target_student(student_id)
            .competition(competition_id)
            .context_kind("competition"),
    )
    .await?;
    tx.commit().await?;
    Ok(id)
}

/// Soft-unregister: set `unregistered_at = CURRENT_TIMESTAMP` only when the
/// registration is currently active. A double-unregister is a no-op and does
/// not emit an activity row.
#[instrument(skip(pool))]
pub async fn unregister_student(
    pool: &Pool<Sqlite>,
    competition_id: i64,
    student_id: i64,
) -> Result<(), AppError> {
    sqlx::query!(
        "UPDATE competition_registrations
         SET unregistered_at = CURRENT_TIMESTAMP
         WHERE student_id = ? AND competition_id = ?
           AND unregistered_at IS NULL",
        student_id,
        competition_id,
    )
    .execute(pool)
    .await?;
    // No emit on no-op (mirrors archive_camp pattern).
    Ok(())
}

#[instrument(skip(pool))]
pub async fn get_registration(
    pool: &Pool<Sqlite>,
    id: i64,
) -> Result<Option<Registration>, AppError> {
    let row = sqlx::query!(
        r#"SELECT id AS "id!: i64",
                  student_id AS "student_id!: i64",
                  competition_id AS "competition_id!: i64",
                  registered_at AS "registered_at!: NaiveDateTime",
                  registered_by_id AS "registered_by_id?: i64",
                  unregistered_at AS "unregistered_at?: NaiveDateTime"
           FROM competition_registrations WHERE id = ?"#,
        id
    )
    .fetch_optional(pool)
    .await?;
    Ok(row.map(|r| Registration {
        id: r.id,
        student_id: r.student_id,
        competition_id: r.competition_id,
        registered_at: r.registered_at,
        registered_by_id: r.registered_by_id,
        unregistered_at: r.unregistered_at,
    }))
}

/// Fetch the registration for a specific (student, competition) pair.
/// Returns `None` when the student has never been registered (or was removed
/// entirely from the table, which cannot happen given the upsert path).
#[instrument(skip(pool))]
pub async fn registration_for(
    pool: &Pool<Sqlite>,
    student_id: i64,
    competition_id: i64,
) -> Result<Option<Registration>, AppError> {
    let row = sqlx::query!(
        r#"SELECT id AS "id!: i64",
                  student_id AS "student_id!: i64",
                  competition_id AS "competition_id!: i64",
                  registered_at AS "registered_at!: NaiveDateTime",
                  registered_by_id AS "registered_by_id?: i64",
                  unregistered_at AS "unregistered_at?: NaiveDateTime"
           FROM competition_registrations
           WHERE student_id = ? AND competition_id = ?"#,
        student_id,
        competition_id,
    )
    .fetch_optional(pool)
    .await?;
    Ok(row.map(|r| Registration {
        id: r.id,
        student_id: r.student_id,
        competition_id: r.competition_id,
        registered_at: r.registered_at,
        registered_by_id: r.registered_by_id,
        unregistered_at: r.unregistered_at,
    }))
}

/// Active roster for a competition (unregistered students excluded). Joins
/// the student's display_name and, via a LEFT JOIN, the camp they have linked
/// to this competition (if any).
#[instrument(skip(pool))]
pub async fn list_registrations_for_competition(
    pool: &Pool<Sqlite>,
    competition_id: i64,
) -> Result<Vec<RegistrationRosterRow>, AppError> {
    let rows = sqlx::query!(
        r#"SELECT
               reg.student_id AS "student_id!: i64",
               u.display_name AS "student_name?: String",
               reg.registered_at AS "registered_at!: NaiveDateTime",
               c.id AS "camp_id?: i64"
           FROM competition_registrations reg
           JOIN users u ON u.id = reg.student_id
           LEFT JOIN camps c
               ON c.student_id = reg.student_id
              AND c.competition_id = reg.competition_id
           WHERE reg.competition_id = ?
             AND reg.unregistered_at IS NULL
           ORDER BY reg.registered_at"#,
        competition_id,
    )
    .fetch_all(pool)
    .await?;
    Ok(rows
        .into_iter()
        .map(|r| RegistrationRosterRow {
            student_id: r.student_id,
            student_name: r.student_name,
            registered_at: r.registered_at,
            camp_id: r.camp_id,
        })
        .collect())
}

// ---------------------------------------------------------------------------
// Camp promotion
// ---------------------------------------------------------------------------

/// Set `camps.competition_id` for the given camp, linking it to a competition.
/// Returns `AppError::NotFound` when the camp does not exist. Emits
/// `CampPromotedToCompetition` with `target_student = camp.student_id`.
#[instrument(skip(pool))]
pub async fn promote_camp_to_competition(
    pool: &Pool<Sqlite>,
    camp_id: i64,
    competition_id: i64,
    by_id: i64,
) -> Result<(), AppError> {
    let mut tx = pool.begin().await?;
    let camp = sqlx::query!(
        r#"SELECT student_id AS "student_id!: i64" FROM camps WHERE id = ?"#,
        camp_id
    )
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| AppError::NotFound("camp not found".into()))?;

    let affected = sqlx::query!(
        "UPDATE camps SET competition_id = ? WHERE id = ?",
        competition_id,
        camp_id,
    )
    .execute(&mut *tx)
    .await?
    .rows_affected();

    if affected == 0 {
        return Err(AppError::NotFound(format!("camp #{camp_id} not found")));
    }

    emit(
        &mut tx,
        NewActivity::new(Verb::CampPromotedToCompetition, by_id)
            .target_student(camp.student_id)
            .camp(camp_id)
            .competition(competition_id)
            .context_kind("competition"),
    )
    .await?;
    tx.commit().await?;
    Ok(())
}
