//! Per-(assignment, technique) progress rows. The student sees one of
//! these per technique in their syllabus view; the coach sees all of
//! them including soft-hidden ones (PR 4 adds the hidden-toggle).

use std::collections::HashMap;

use chrono::NaiveDateTime;
use serde::Serialize;
use sqlx::{Pool, Sqlite};
use tracing::instrument;

use crate::auth::{Role, User};
use crate::db::activity::{NewActivity, Verb, emit, payload};
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
pub async fn get_owner(pool: &Pool<Sqlite>, sst_id: i64) -> Result<Option<SstOwner>, AppError> {
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

    let mut tx = pool.begin().await?;

    // Resolve owner for denormalised activity fields.
    let owner = sqlx::query!(
        r#"SELECT a.student_id AS "student_id!: i64",
                  a.syllabus_id AS "syllabus_id!: i64",
                  sst.technique_id AS "technique_id!: i64"
           FROM student_syllabus_techniques sst
           JOIN syllabus_assignments a ON a.id = sst.assignment_id
           WHERE sst.id = ?"#,
        sst_id,
    )
    .fetch_one(&mut *tx)
    .await?;

    // Read the old status before any UPDATE so we can diff it.
    let old_status = sqlx::query_scalar!(
        r#"SELECT status AS "status!: String" FROM student_syllabus_techniques WHERE id = ?"#,
        sst_id,
    )
    .fetch_one(&mut *tx)
    .await?;

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
        .execute(&mut *tx)
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
        .execute(&mut *tx)
        .await?;
    }

    if let Some(ref status) = update.status {
        sqlx::query!(
            "UPDATE student_syllabus_techniques SET status = ? WHERE id = ?",
            status,
            sst_id,
        )
        .execute(&mut *tx)
        .await?;
    }
    if let Some(ref notes) = update.student_notes {
        sqlx::query!(
            "UPDATE student_syllabus_techniques SET student_notes = ? WHERE id = ?",
            notes,
            sst_id,
        )
        .execute(&mut *tx)
        .await?;
    }
    if let Some(ref notes) = update.coach_notes {
        sqlx::query!(
            "UPDATE student_syllabus_techniques SET coach_notes = ? WHERE id = ?",
            notes,
            sst_id,
        )
        .execute(&mut *tx)
        .await?;
    }

    // Emit one activity row per present field.
    if let Some(ref status) = update.status {
        emit(
            &mut tx,
            NewActivity::new(Verb::SstStatusChanged, actor.id)
                .target_student(owner.student_id)
                .sst(sst_id)
                .technique(owner.technique_id)
                .syllabus(owner.syllabus_id)
                .payload(payload::status_changed(&old_status, status)),
        )
        .await?;
    }
    if update.student_notes.is_some() {
        emit(
            &mut tx,
            NewActivity::new(Verb::SstStudentNotesEdited, actor.id)
                .target_student(owner.student_id)
                .sst(sst_id)
                .technique(owner.technique_id)
                .syllabus(owner.syllabus_id),
        )
        .await?;
    }
    if update.coach_notes.is_some() {
        emit(
            &mut tx,
            NewActivity::new(Verb::SstCoachNotesEdited, actor.id)
                .target_student(owner.student_id)
                .sst(sst_id)
                .technique(owner.technique_id)
                .syllabus(owner.syllabus_id),
        )
        .await?;
    }

    tx.commit().await?;
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

/// Coach-only soft-hide toggle on an SST row. Setting `hidden = true`
/// stamps `hidden_at`; clearing sets it back to NULL and drops the
/// `hidden_by_id`. Attempts and notes are preserved either way.
#[instrument]
pub async fn set_hidden(
    pool: &Pool<Sqlite>,
    coach_id: i64,
    sst_id: i64,
    hidden: bool,
) -> Result<(), AppError> {
    let now = chrono::Utc::now().naive_utc();
    let mut tx = pool.begin().await?;

    // Resolve owner for denormalised activity fields.
    let owner = sqlx::query!(
        r#"SELECT a.student_id AS "student_id!: i64",
                  a.syllabus_id AS "syllabus_id!: i64",
                  sst.technique_id AS "technique_id!: i64"
           FROM student_syllabus_techniques sst
           JOIN syllabus_assignments a ON a.id = sst.assignment_id
           WHERE sst.id = ?"#,
        sst_id,
    )
    .fetch_one(&mut *tx)
    .await?;

    if hidden {
        sqlx::query!(
            "UPDATE student_syllabus_techniques
             SET hidden_at = ?, hidden_by_id = ?, updated_at = ?
             WHERE id = ?",
            now,
            coach_id,
            now,
            sst_id,
        )
        .execute(&mut *tx)
        .await?;
    } else {
        sqlx::query!(
            "UPDATE student_syllabus_techniques
             SET hidden_at = NULL, hidden_by_id = NULL, updated_at = ?
             WHERE id = ?",
            now,
            sst_id,
        )
        .execute(&mut *tx)
        .await?;
    }

    let verb = if hidden {
        Verb::SstHidden
    } else {
        Verb::SstUnhidden
    };
    emit(
        &mut tx,
        NewActivity::new(verb, coach_id)
            .target_student(owner.student_id)
            .sst(sst_id)
            .technique(owner.technique_id)
            .syllabus(owner.syllabus_id),
    )
    .await?;

    tx.commit().await?;
    Ok(())
}

/// Adds a technique to this specific assignment, either inserting a fresh
/// SST or clearing `hidden_at` if one already exists. The technique does
/// not have to be in the syllabus's current `syllabus_techniques`; this
/// is the "arbitrary add for this student" affordance plus the "sync
/// missing" action from the diff view.
#[instrument]
pub async fn add_technique_to_assignment(
    pool: &Pool<Sqlite>,
    assignment_id: i64,
    technique_id: i64,
    coach_id: i64,
) -> Result<i64, AppError> {
    let mut tx = pool.begin().await?;
    let existing: Option<i64> = sqlx::query_scalar!(
        r#"SELECT id AS "id!: i64"
           FROM student_syllabus_techniques
           WHERE assignment_id = ? AND technique_id = ?"#,
        assignment_id,
        technique_id,
    )
    .fetch_optional(&mut *tx)
    .await?;
    let id = if let Some(id) = existing {
        let now = chrono::Utc::now().naive_utc();
        sqlx::query!(
            "UPDATE student_syllabus_techniques
             SET hidden_at = NULL, hidden_by_id = NULL, updated_at = ?
             WHERE id = ?",
            now,
            id,
        )
        .execute(&mut *tx)
        .await?;
        id
    } else {
        let res = sqlx::query!(
            "INSERT INTO student_syllabus_techniques
                (assignment_id, technique_id)
             VALUES (?, ?)",
            assignment_id,
            technique_id,
        )
        .execute(&mut *tx)
        .await?;
        res.last_insert_rowid()
    };

    // Resolve the assignment's student + syllabus for denormalised fields.
    let asgn = sqlx::query!(
        r#"SELECT student_id AS "student_id!: i64",
                  syllabus_id AS "syllabus_id!: i64"
           FROM syllabus_assignments WHERE id = ?"#,
        assignment_id,
    )
    .fetch_one(&mut *tx)
    .await?;

    emit(
        &mut tx,
        NewActivity::new(Verb::SstAdded, coach_id)
            .target_student(asgn.student_id)
            .sst(id)
            .technique(technique_id)
            .syllabus(asgn.syllabus_id),
    )
    .await?;

    tx.commit().await?;
    Ok(id)
}

/// A flat, cross-assignment view of one student's SST rows for the student's
/// own dashboard "currently working / recently done" widgets. Spans every
/// active (unassigned_at IS NULL) assignment; excludes soft-hidden rows.
#[derive(Debug, Serialize)]
pub struct StudentSyllabusTechniqueOverview {
    pub sst_id: i64,
    pub technique_id: i64,
    pub technique_name: String,
    pub syllabus_id: i64,
    pub syllabus_name: String,
    pub status: String,
    pub updated_at: String,
    pub last_attempt_at: Option<String>,
}

#[instrument]
pub async fn list_sst_flat_for_student(
    pool: &Pool<Sqlite>,
    student_id: i64,
) -> Result<Vec<StudentSyllabusTechniqueOverview>, AppError> {
    let rows = sqlx::query!(
        r#"SELECT sst.id AS "sst_id!: i64",
                  sst.technique_id AS "technique_id!: i64",
                  t.name AS "technique_name!: String",
                  sa.syllabus_id AS "syllabus_id!: i64",
                  s.name AS "syllabus_name!: String",
                  sst.status AS "status!: String",
                  sst.updated_at AS "updated_at!: NaiveDateTime",
                  (SELECT MAX(attempted_at) FROM syllabus_attempts
                    WHERE student_syllabus_technique_id = sst.id) AS "last_attempt_at?: NaiveDateTime"
           FROM student_syllabus_techniques sst
           JOIN syllabus_assignments sa ON sa.id = sst.assignment_id
           JOIN syllabi s ON s.id = sa.syllabus_id
           JOIN techniques t ON t.id = sst.technique_id
           WHERE sa.student_id = ? AND sa.unassigned_at IS NULL AND sst.hidden_at IS NULL
           ORDER BY sst.updated_at DESC"#,
        student_id,
    )
    .fetch_all(pool)
    .await?;
    Ok(rows
        .into_iter()
        .map(|r| StudentSyllabusTechniqueOverview {
            sst_id: r.sst_id,
            technique_id: r.technique_id,
            technique_name: r.technique_name,
            syllabus_id: r.syllabus_id,
            syllabus_name: r.syllabus_name,
            status: r.status,
            updated_at: rfc3339(r.updated_at),
            last_attempt_at: r.last_attempt_at.map(rfc3339),
        })
        .collect())
}

#[derive(Debug, Serialize)]
pub struct DiffGhost {
    /// SST id whose technique is no longer in the syllabus's current set.
    pub sst_id: i64,
    pub technique_id: i64,
    pub technique_name: String,
    /// Whether this SST is currently hidden.
    pub hidden: bool,
}

#[derive(Debug, Serialize)]
pub struct DiffMissing {
    /// Technique in the syllabus_techniques set that the student is not
    /// actively progressing on (either no SST exists, or the SST is
    /// hidden).
    pub technique_id: i64,
    pub technique_name: String,
    /// Existing SST id if one exists but is hidden, else None.
    pub sst_id: Option<i64>,
}

#[derive(Debug, Serialize)]
pub struct SyllabusAssignmentDiff {
    pub ghosts: Vec<DiffGhost>,
    pub missing: Vec<DiffMissing>,
}

#[instrument]
pub async fn diff_for_assignment(
    pool: &Pool<Sqlite>,
    assignment_id: i64,
) -> Result<SyllabusAssignmentDiff, AppError> {
    // ghosts: SST rows whose technique is not in the syllabus's current
    // syllabus_techniques set.
    let ghost_rows = sqlx::query!(
        r#"SELECT sst.id AS "sst_id!: i64",
                  sst.technique_id AS "technique_id!: i64",
                  t.name AS "name!: String",
                  sst.hidden_at AS "hidden_at?: chrono::NaiveDateTime"
           FROM student_syllabus_techniques sst
           JOIN syllabus_assignments a ON a.id = sst.assignment_id
           JOIN techniques t ON t.id = sst.technique_id
           WHERE sst.assignment_id = ?
             AND NOT EXISTS (
                 SELECT 1 FROM syllabus_techniques st
                 WHERE st.syllabus_id = a.syllabus_id
                   AND st.technique_id = sst.technique_id
             )
           ORDER BY t.name"#,
        assignment_id,
    )
    .fetch_all(pool)
    .await?;

    // missing: techniques in syllabus_techniques whose SST either does not
    // exist for this assignment, or exists with hidden_at set.
    let missing_rows = sqlx::query!(
        r#"SELECT t.id AS "technique_id!: i64",
                  t.name AS "name!: String",
                  sst.id AS "sst_id?: i64"
           FROM syllabus_assignments a
           JOIN syllabus_techniques st ON st.syllabus_id = a.syllabus_id
           JOIN techniques t ON t.id = st.technique_id
           LEFT JOIN student_syllabus_techniques sst
                  ON sst.assignment_id = a.id
                 AND sst.technique_id = st.technique_id
           WHERE a.id = ?
             AND (sst.id IS NULL OR sst.hidden_at IS NOT NULL)
           ORDER BY t.name"#,
        assignment_id,
    )
    .fetch_all(pool)
    .await?;

    Ok(SyllabusAssignmentDiff {
        ghosts: ghost_rows
            .into_iter()
            .map(|r| DiffGhost {
                sst_id: r.sst_id,
                technique_id: r.technique_id,
                technique_name: r.name,
                hidden: r.hidden_at.is_some(),
            })
            .collect(),
        missing: missing_rows
            .into_iter()
            .map(|r| DiffMissing {
                technique_id: r.technique_id,
                technique_name: r.name,
                sst_id: r.sst_id,
            })
            .collect(),
    })
}
