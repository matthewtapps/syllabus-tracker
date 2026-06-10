//! Coach-owned, named, reusable collections of techniques. Replaces the
//! conceptual use of legacy `collections` going forward. Assignment to a
//! student is in `db/syllabus_assignments.rs`; per-student progress
//! against an assignment is in `db/student_syllabus_techniques.rs`.

use std::collections::HashMap;

use chrono::NaiveDateTime;
use serde::Serialize;
use sqlx::{Pool, Sqlite};
use tracing::instrument;

use crate::error::AppError;
use crate::models::Tag;

#[derive(Debug, Clone, Copy)]
pub enum PropagationMode {
    /// Touch the syllabus only. Active assignments keep their existing
    /// SST set; the change does not fan out.
    SyllabusOnly,
    /// Fan out to every active, non-graduated assignment of this
    /// syllabus. For add: insert a default SST row. For remove: set
    /// `hidden_at` on the matching SST so attempts stay intact.
    Cascade,
}

#[derive(Debug, Serialize)]
pub struct Syllabus {
    pub id: i64,
    pub name: String,
    pub description: String,
    pub created_at: String,
    pub created_by_id: Option<i64>,
    pub updated_at: String,
    /// How many techniques the syllabus currently contains.
    pub technique_count: i64,
    /// How many active (not soft-unassigned) student assignments exist.
    pub active_assignment_count: i64,
}

#[derive(Debug, Serialize)]
pub struct SyllabusTechniqueRow {
    pub technique_id: i64,
    pub name: String,
    pub description: String,
    pub position: i64,
    pub added_at: String,
    pub tags: Vec<Tag>,
}

fn rfc3339(dt: NaiveDateTime) -> String {
    chrono::DateTime::<chrono::Utc>::from_naive_utc_and_offset(dt, chrono::Utc).to_rfc3339()
}

#[instrument]
pub async fn list_syllabi(pool: &Pool<Sqlite>) -> Result<Vec<Syllabus>, AppError> {
    let rows = sqlx::query!(
        r#"SELECT s.id AS "id!: i64",
                  s.name AS "name!: String",
                  s.description,
                  s.created_at AS "created_at!: NaiveDateTime",
                  s.created_by_id,
                  s.updated_at AS "updated_at!: NaiveDateTime",
                  COALESCE((SELECT COUNT(*) FROM syllabus_techniques st WHERE st.syllabus_id = s.id), 0) AS "technique_count!: i64",
                  COALESCE((SELECT COUNT(*) FROM syllabus_assignments sa WHERE sa.syllabus_id = s.id AND sa.unassigned_at IS NULL), 0) AS "active_assignment_count!: i64"
           FROM syllabi s
           ORDER BY s.name"#
    )
    .fetch_all(pool)
    .await?;
    Ok(rows
        .into_iter()
        .map(|r| Syllabus {
            id: r.id,
            name: r.name,
            description: r.description.unwrap_or_default(),
            created_at: rfc3339(r.created_at),
            created_by_id: r.created_by_id,
            updated_at: rfc3339(r.updated_at),
            technique_count: r.technique_count,
            active_assignment_count: r.active_assignment_count,
        })
        .collect())
}

#[instrument]
pub async fn get_syllabus(
    pool: &Pool<Sqlite>,
    id: i64,
) -> Result<Option<Syllabus>, AppError> {
    let row = sqlx::query!(
        r#"SELECT s.id AS "id!: i64",
                  s.name AS "name!: String",
                  s.description,
                  s.created_at AS "created_at!: NaiveDateTime",
                  s.created_by_id,
                  s.updated_at AS "updated_at!: NaiveDateTime",
                  COALESCE((SELECT COUNT(*) FROM syllabus_techniques st WHERE st.syllabus_id = s.id), 0) AS "technique_count!: i64",
                  COALESCE((SELECT COUNT(*) FROM syllabus_assignments sa WHERE sa.syllabus_id = s.id AND sa.unassigned_at IS NULL), 0) AS "active_assignment_count!: i64"
           FROM syllabi s
           WHERE s.id = ?"#,
        id,
    )
    .fetch_optional(pool)
    .await?;
    Ok(row.map(|r| Syllabus {
        id: r.id,
        name: r.name,
        description: r.description.unwrap_or_default(),
        created_at: rfc3339(r.created_at),
        created_by_id: r.created_by_id,
        updated_at: rfc3339(r.updated_at),
        technique_count: r.technique_count,
        active_assignment_count: r.active_assignment_count,
    }))
}

#[instrument]
pub async fn create_syllabus(
    pool: &Pool<Sqlite>,
    name: &str,
    description: Option<&str>,
    coach_id: i64,
) -> Result<i64, AppError> {
    let res = sqlx::query!(
        "INSERT INTO syllabi (name, description, created_by_id)
         VALUES (?, ?, ?)",
        name,
        description,
        coach_id,
    )
    .execute(pool)
    .await?;
    Ok(res.last_insert_rowid())
}

#[instrument]
pub async fn update_syllabus(
    pool: &Pool<Sqlite>,
    id: i64,
    name: Option<&str>,
    description: Option<Option<&str>>,
) -> Result<(), AppError> {
    let now = chrono::Utc::now().naive_utc();
    match (name, description) {
        (Some(n), Some(d)) => {
            sqlx::query!(
                "UPDATE syllabi SET name = ?, description = ?, updated_at = ? WHERE id = ?",
                n,
                d,
                now,
                id
            )
            .execute(pool)
            .await?;
        }
        (Some(n), None) => {
            sqlx::query!(
                "UPDATE syllabi SET name = ?, updated_at = ? WHERE id = ?",
                n,
                now,
                id
            )
            .execute(pool)
            .await?;
        }
        (None, Some(d)) => {
            sqlx::query!(
                "UPDATE syllabi SET description = ?, updated_at = ? WHERE id = ?",
                d,
                now,
                id
            )
            .execute(pool)
            .await?;
        }
        (None, None) => {}
    }
    Ok(())
}

#[instrument]
pub async fn delete_syllabus(pool: &Pool<Sqlite>, id: i64) -> Result<(), AppError> {
    sqlx::query!("DELETE FROM syllabi WHERE id = ?", id)
        .execute(pool)
        .await?;
    Ok(())
}

#[instrument]
pub async fn list_syllabus_techniques(
    pool: &Pool<Sqlite>,
    syllabus_id: i64,
) -> Result<Vec<SyllabusTechniqueRow>, AppError> {
    let rows = sqlx::query!(
        r#"SELECT t.id AS "technique_id!: i64",
                  t.name AS "name!: String",
                  t.description AS "description!: String",
                  st.position AS "position!: i64",
                  st.added_at AS "added_at!: NaiveDateTime"
           FROM syllabus_techniques st
           JOIN techniques t ON t.id = st.technique_id
           WHERE st.syllabus_id = ?
           ORDER BY st.position ASC, t.name ASC"#,
        syllabus_id,
    )
    .fetch_all(pool)
    .await?;

    let tag_rows = sqlx::query!(
        r#"SELECT tt.technique_id AS "technique_id!: i64",
                  tag.id AS "tag_id!: i64",
                  tag.name AS "tag_name!: String"
           FROM syllabus_techniques st
           JOIN technique_tags tt ON tt.technique_id = st.technique_id
           JOIN tags tag ON tag.id = tt.tag_id
           WHERE st.syllabus_id = ?
           ORDER BY tag.name"#,
        syllabus_id,
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
        .map(|r| SyllabusTechniqueRow {
            technique_id: r.technique_id,
            name: r.name,
            description: r.description,
            position: r.position,
            added_at: rfc3339(r.added_at),
            tags: tags_by_tid.remove(&r.technique_id).unwrap_or_default(),
        })
        .collect())
}

/// Add a technique to a syllabus. When `mode = Cascade`, eager-fill SST
/// rows for every active, non-graduated assignment of this syllabus.
/// Wraps the whole op in a single transaction so a partial fan-out
/// doesn't leave the syllabus in an inconsistent state.
#[instrument]
pub async fn add_technique_to_syllabus(
    pool: &Pool<Sqlite>,
    syllabus_id: i64,
    technique_id: i64,
    coach_id: i64,
    mode: PropagationMode,
) -> Result<(), AppError> {
    let mut tx = pool.begin().await?;

    sqlx::query!(
        "INSERT OR IGNORE INTO syllabus_techniques
            (syllabus_id, technique_id, added_by_id)
         VALUES (?, ?, ?)",
        syllabus_id,
        technique_id,
        coach_id,
    )
    .execute(&mut *tx)
    .await?;

    if matches!(mode, PropagationMode::Cascade) {
        // Fan-out: every active, non-graduated assignment of this
        // syllabus gets a default-status SST row for the new technique.
        // Existing rows (e.g. previously-hidden) are preserved by the
        // `INSERT OR IGNORE` on the (assignment_id, technique_id) unique.
        let assignment_ids: Vec<i64> = sqlx::query_scalar!(
            r#"SELECT id AS "id!: i64"
               FROM syllabus_assignments
               WHERE syllabus_id = ?
                 AND unassigned_at IS NULL
                 AND graduated_at IS NULL"#,
            syllabus_id,
        )
        .fetch_all(&mut *tx)
        .await?;

        for assignment_id in assignment_ids {
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
    }

    tx.commit().await?;
    Ok(())
}

/// Remove a technique from a syllabus. When `mode = Cascade`, set
/// `hidden_at` on every matching SST row across active, non-graduated
/// assignments (soft-hide; attempts are preserved).
#[instrument]
pub async fn remove_technique_from_syllabus(
    pool: &Pool<Sqlite>,
    syllabus_id: i64,
    technique_id: i64,
    coach_id: i64,
    mode: PropagationMode,
) -> Result<(), AppError> {
    let mut tx = pool.begin().await?;

    sqlx::query!(
        "DELETE FROM syllabus_techniques
         WHERE syllabus_id = ? AND technique_id = ?",
        syllabus_id,
        technique_id,
    )
    .execute(&mut *tx)
    .await?;

    if matches!(mode, PropagationMode::Cascade) {
        let now = chrono::Utc::now().naive_utc();
        sqlx::query!(
            "UPDATE student_syllabus_techniques
             SET hidden_at = ?, hidden_by_id = ?, updated_at = ?
             WHERE technique_id = ?
               AND hidden_at IS NULL
               AND assignment_id IN (
                   SELECT id FROM syllabus_assignments
                   WHERE syllabus_id = ?
                     AND unassigned_at IS NULL
                     AND graduated_at IS NULL
               )",
            now,
            coach_id,
            now,
            technique_id,
            syllabus_id,
        )
        .execute(&mut *tx)
        .await?;
    }

    tx.commit().await?;
    Ok(())
}
