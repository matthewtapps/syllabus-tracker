//! Which student has which syllabus, plus the lifecycle around it
//! (assign / unassign). Graduation lands in PR 4.

use chrono::NaiveDateTime;
use serde::Serialize;
use sqlx::{Pool, Sqlite};
use tracing::{info, instrument};

use crate::error::AppError;

#[derive(Debug, Serialize)]
pub struct SyllabusAssignment {
    pub id: i64,
    pub student_id: i64,
    pub syllabus_id: i64,
    pub syllabus_name: String,
    pub assigned_at: String,
    pub assigned_by_id: Option<i64>,
    pub unassigned_at: Option<String>,
    pub unassigned_by_id: Option<i64>,
    pub graduated_at: Option<String>,
    pub graduated_by_id: Option<i64>,
    /// Progress summary across visible (non-hidden) SST rows. Cheap to
    /// compute alongside the assignment row and surfaces on the student's
    /// "my syllabi" list as a progress chip.
    pub red_count: i64,
    pub amber_count: i64,
    pub green_count: i64,
    pub total_count: i64,
}

fn rfc3339(dt: NaiveDateTime) -> String {
    chrono::DateTime::<chrono::Utc>::from_naive_utc_and_offset(dt, chrono::Utc).to_rfc3339()
}

#[instrument]
pub async fn list_assignments_for_student(
    pool: &Pool<Sqlite>,
    student_id: i64,
    include_unassigned: bool,
) -> Result<Vec<SyllabusAssignment>, AppError> {
    let rows = sqlx::query!(
        r#"SELECT a.id AS "id!: i64",
                  a.student_id AS "student_id!: i64",
                  a.syllabus_id AS "syllabus_id!: i64",
                  s.name AS "syllabus_name!: String",
                  a.assigned_at AS "assigned_at!: NaiveDateTime",
                  a.assigned_by_id,
                  a.unassigned_at AS "unassigned_at?: NaiveDateTime",
                  a.unassigned_by_id,
                  a.graduated_at AS "graduated_at?: NaiveDateTime",
                  a.graduated_by_id,
                  COALESCE(SUM(CASE WHEN sst.status = 'red'   AND sst.hidden_at IS NULL THEN 1 ELSE 0 END), 0) AS "red_count!: i64",
                  COALESCE(SUM(CASE WHEN sst.status = 'amber' AND sst.hidden_at IS NULL THEN 1 ELSE 0 END), 0) AS "amber_count!: i64",
                  COALESCE(SUM(CASE WHEN sst.status = 'green' AND sst.hidden_at IS NULL THEN 1 ELSE 0 END), 0) AS "green_count!: i64",
                  COALESCE(SUM(CASE WHEN sst.hidden_at IS NULL THEN 1 ELSE 0 END), 0) AS "total_count!: i64"
           FROM syllabus_assignments a
           JOIN syllabi s ON s.id = a.syllabus_id
           LEFT JOIN student_syllabus_techniques sst ON sst.assignment_id = a.id
           WHERE a.student_id = ?
             AND (? = 1 OR a.unassigned_at IS NULL)
           GROUP BY a.id
           ORDER BY s.name"#,
        student_id,
        include_unassigned,
    )
    .fetch_all(pool)
    .await?;
    Ok(rows
        .into_iter()
        .map(|r| SyllabusAssignment {
            id: r.id,
            student_id: r.student_id,
            syllabus_id: r.syllabus_id,
            syllabus_name: r.syllabus_name,
            assigned_at: rfc3339(r.assigned_at),
            assigned_by_id: r.assigned_by_id,
            unassigned_at: r.unassigned_at.map(rfc3339),
            unassigned_by_id: r.unassigned_by_id,
            graduated_at: r.graduated_at.map(rfc3339),
            graduated_by_id: r.graduated_by_id,
            red_count: r.red_count,
            amber_count: r.amber_count,
            green_count: r.green_count,
            total_count: r.total_count,
        })
        .collect())
}

#[instrument]
pub async fn get_assignment(
    pool: &Pool<Sqlite>,
    student_id: i64,
    syllabus_id: i64,
) -> Result<Option<SyllabusAssignment>, AppError> {
    let row = sqlx::query!(
        r#"SELECT a.id AS "id!: i64",
                  a.student_id AS "student_id!: i64",
                  a.syllabus_id AS "syllabus_id!: i64",
                  s.name AS "syllabus_name!: String",
                  a.assigned_at AS "assigned_at!: NaiveDateTime",
                  a.assigned_by_id,
                  a.unassigned_at AS "unassigned_at?: NaiveDateTime",
                  a.unassigned_by_id,
                  a.graduated_at AS "graduated_at?: NaiveDateTime",
                  a.graduated_by_id,
                  COALESCE(SUM(CASE WHEN sst.status = 'red'   AND sst.hidden_at IS NULL THEN 1 ELSE 0 END), 0) AS "red_count!: i64",
                  COALESCE(SUM(CASE WHEN sst.status = 'amber' AND sst.hidden_at IS NULL THEN 1 ELSE 0 END), 0) AS "amber_count!: i64",
                  COALESCE(SUM(CASE WHEN sst.status = 'green' AND sst.hidden_at IS NULL THEN 1 ELSE 0 END), 0) AS "green_count!: i64",
                  COALESCE(SUM(CASE WHEN sst.hidden_at IS NULL THEN 1 ELSE 0 END), 0) AS "total_count!: i64"
           FROM syllabus_assignments a
           JOIN syllabi s ON s.id = a.syllabus_id
           LEFT JOIN student_syllabus_techniques sst ON sst.assignment_id = a.id
           WHERE a.student_id = ? AND a.syllabus_id = ?
           GROUP BY a.id"#,
        student_id,
        syllabus_id,
    )
    .fetch_optional(pool)
    .await?;
    Ok(row.map(|r| SyllabusAssignment {
        id: r.id,
        student_id: r.student_id,
        syllabus_id: r.syllabus_id,
        syllabus_name: r.syllabus_name,
        assigned_at: rfc3339(r.assigned_at),
        assigned_by_id: r.assigned_by_id,
        unassigned_at: r.unassigned_at.map(rfc3339),
        unassigned_by_id: r.unassigned_by_id,
        graduated_at: r.graduated_at.map(rfc3339),
        graduated_by_id: r.graduated_by_id,
        red_count: r.red_count,
        amber_count: r.amber_count,
        green_count: r.green_count,
        total_count: r.total_count,
    }))
}

#[instrument]
pub async fn list_students_assigned_to_syllabus(
    pool: &Pool<Sqlite>,
    syllabus_id: i64,
) -> Result<Vec<i64>, AppError> {
    let ids = sqlx::query_scalar!(
        r#"SELECT student_id AS "student_id!: i64"
           FROM syllabus_assignments
           WHERE syllabus_id = ? AND unassigned_at IS NULL
           ORDER BY assigned_at DESC"#,
        syllabus_id,
    )
    .fetch_all(pool)
    .await?;
    Ok(ids)
}

/// Assign (or re-activate) the (student, syllabus) pair. Re-assign clears
/// `unassigned_at` and keeps existing SST rows (including `hidden_at`)
/// intact; the only thing it adds is fresh SST rows for any
/// `syllabus_techniques` members that don't already have one. Wraps the
/// whole thing in a transaction so the assignment and its K SST rows
/// commit atomically.
#[instrument]
pub async fn assign(
    pool: &Pool<Sqlite>,
    coach_id: i64,
    student_id: i64,
    syllabus_id: i64,
) -> Result<i64, AppError> {
    let mut tx = pool.begin().await?;

    // Try re-activating a soft-deleted assignment first; fall back to insert.
    let existing: Option<i64> = sqlx::query_scalar!(
        r#"SELECT id AS "id!: i64"
           FROM syllabus_assignments
           WHERE student_id = ? AND syllabus_id = ?"#,
        student_id,
        syllabus_id,
    )
    .fetch_optional(&mut *tx)
    .await?;

    let assignment_id = if let Some(id) = existing {
        sqlx::query!(
            "UPDATE syllabus_assignments
             SET unassigned_at = NULL,
                 unassigned_by_id = NULL,
                 assigned_at = CURRENT_TIMESTAMP,
                 assigned_by_id = ?
             WHERE id = ?",
            coach_id,
            id,
        )
        .execute(&mut *tx)
        .await?;
        id
    } else {
        let res = sqlx::query!(
            "INSERT INTO syllabus_assignments
                (student_id, syllabus_id, assigned_by_id)
             VALUES (?, ?, ?)",
            student_id,
            syllabus_id,
            coach_id,
        )
        .execute(&mut *tx)
        .await?;
        res.last_insert_rowid()
    };

    // Eager-materialize SST for every current syllabus member that doesn't
    // already have a row in this assignment.
    let technique_ids: Vec<i64> = sqlx::query_scalar!(
        r#"SELECT technique_id AS "technique_id!: i64"
           FROM syllabus_techniques
           WHERE syllabus_id = ?"#,
        syllabus_id,
    )
    .fetch_all(&mut *tx)
    .await?;
    for technique_id in technique_ids {
        sqlx::query!(
            "INSERT OR IGNORE INTO student_syllabus_techniques
                (assignment_id, technique_id)
             VALUES (?, ?)",
            assignment_id,
            technique_id,
        )
        .execute(&mut *tx)
        .await?;
    }

    tx.commit().await?;
    info!(assignment_id, student_id, syllabus_id, "Assigned syllabus");
    Ok(assignment_id)
}

#[instrument]
pub async fn unassign(
    pool: &Pool<Sqlite>,
    coach_id: i64,
    assignment_id: i64,
) -> Result<(), AppError> {
    let now = chrono::Utc::now().naive_utc();
    sqlx::query!(
        "UPDATE syllabus_assignments
         SET unassigned_at = ?, unassigned_by_id = ?
         WHERE id = ? AND unassigned_at IS NULL",
        now,
        coach_id,
        assignment_id,
    )
    .execute(pool)
    .await?;
    Ok(())
}

/// Stamps graduation on an assignment. Graduated assignments are immutable
/// snapshots: PR 4 routes refuse student writes against any SST under a
/// graduated assignment, and the syllabus-add / syllabus-remove cascades
/// skip graduated assignments entirely. Coaches keep the ability to edit
/// (with a frontend confirmation), so they can correct an entry after
/// graduating by mistake without an explicit ungraduate.
#[instrument]
pub async fn graduate(
    pool: &Pool<Sqlite>,
    coach_id: i64,
    assignment_id: i64,
) -> Result<(), AppError> {
    let now = chrono::Utc::now().naive_utc();
    sqlx::query!(
        "UPDATE syllabus_assignments
         SET graduated_at = ?, graduated_by_id = ?
         WHERE id = ? AND graduated_at IS NULL",
        now,
        coach_id,
        assignment_id,
    )
    .execute(pool)
    .await?;
    Ok(())
}

/// Clears graduation. Does NOT auto-sync the SST set with the syllabus's
/// current shape; the coach uses the diff view to decide what to bring in
/// or hide.
#[instrument]
pub async fn ungraduate(
    pool: &Pool<Sqlite>,
    assignment_id: i64,
) -> Result<(), AppError> {
    sqlx::query!(
        "UPDATE syllabus_assignments
         SET graduated_at = NULL, graduated_by_id = NULL
         WHERE id = ?",
        assignment_id,
    )
    .execute(pool)
    .await?;
    Ok(())
}

#[derive(Debug)]
pub struct AssignmentLifecycleFlags {
    pub unassigned_at: Option<chrono::NaiveDateTime>,
    pub graduated_at: Option<chrono::NaiveDateTime>,
}

/// Cheap accessor used by the SST and attempts routes to gate student
/// writes on a graduated assignment.
#[instrument]
pub async fn get_assignment_lifecycle(
    pool: &Pool<Sqlite>,
    assignment_id: i64,
) -> Result<Option<AssignmentLifecycleFlags>, AppError> {
    let row = sqlx::query!(
        r#"SELECT unassigned_at AS "unassigned_at?: chrono::NaiveDateTime",
                  graduated_at AS "graduated_at?: chrono::NaiveDateTime"
           FROM syllabus_assignments WHERE id = ?"#,
        assignment_id,
    )
    .fetch_optional(pool)
    .await?;
    Ok(row.map(|r| AssignmentLifecycleFlags {
        unassigned_at: r.unassigned_at,
        graduated_at: r.graduated_at,
    }))
}
