//! Pinned-technique CRUD (M6 / SD-003).
//!
//! Pinning is a soft toggle: rows carry an `unpinned_at` so threads,
//! comments, and notes anchored to a pinned context survive an
//! unpin / re-pin cycle. Notes themselves live on the shared
//! `technique_notes` row, keyed by `(student_id, technique_id)`, so
//! the same text shows up in syllabus, pinned, and future camp views.

use chrono::{NaiveDateTime, Utc};
use serde::Serialize;
use sqlx::{Pool, Sqlite};
use tracing::{info, instrument};

use crate::error::AppError;

#[derive(Debug, Clone, Serialize)]
pub struct PinnedTechnique {
    pub id: i64,
    pub student_id: i64,
    pub technique_id: i64,
    pub technique_name: String,
    pub technique_description: String,
    pub pinned_at: NaiveDateTime,
}

/// Pin a technique for a student. Idempotent: re-pinning an already-pinned
/// row clears the `unpinned_at` timestamp instead of inserting a duplicate.
/// Returns the row id.
#[instrument]
pub async fn pin_technique(
    pool: &Pool<Sqlite>,
    student_id: i64,
    technique_id: i64,
) -> Result<i64, AppError> {
    info!("Pinning technique");
    let now = Utc::now().naive_utc();
    let row = sqlx::query!(
        "INSERT INTO pinned_techniques (student_id, technique_id, pinned_at)
         VALUES (?, ?, ?)
         ON CONFLICT(student_id, technique_id) DO UPDATE SET
             pinned_at = excluded.pinned_at,
             unpinned_at = NULL
         RETURNING id AS \"id!: i64\"",
        student_id,
        technique_id,
        now,
    )
    .fetch_one(pool)
    .await?;
    Ok(row.id)
}

/// Unpin a technique. Soft delete: writes `unpinned_at` so the row stays
/// addressable (threads / comments anchored to it survive).
#[instrument]
pub async fn unpin_technique(
    pool: &Pool<Sqlite>,
    student_id: i64,
    technique_id: i64,
) -> Result<(), AppError> {
    info!("Unpinning technique");
    let now = Utc::now().naive_utc();
    sqlx::query!(
        "UPDATE pinned_techniques
         SET unpinned_at = ?
         WHERE student_id = ? AND technique_id = ? AND unpinned_at IS NULL",
        now,
        student_id,
        technique_id,
    )
    .execute(pool)
    .await?;
    Ok(())
}

/// List a student's active pinned techniques, newest first.
#[instrument]
pub async fn list_pinned_techniques(
    pool: &Pool<Sqlite>,
    student_id: i64,
) -> Result<Vec<PinnedTechnique>, AppError> {
    info!("Listing pinned techniques");
    let rows = sqlx::query!(
        r#"SELECT p.id AS "id!: i64",
                  p.student_id AS "student_id!: i64",
                  p.technique_id AS "technique_id!: i64",
                  t.name AS "technique_name!: String",
                  t.description AS "technique_description?: String",
                  p.pinned_at AS "pinned_at!: NaiveDateTime"
           FROM pinned_techniques p
           JOIN techniques t ON t.id = p.technique_id
           WHERE p.student_id = ? AND p.unpinned_at IS NULL
           ORDER BY p.pinned_at DESC"#,
        student_id,
    )
    .fetch_all(pool)
    .await?;
    Ok(rows
        .into_iter()
        .map(|r| PinnedTechnique {
            id: r.id,
            student_id: r.student_id,
            technique_id: r.technique_id,
            technique_name: r.technique_name,
            technique_description: r.technique_description.unwrap_or_default(),
            pinned_at: r.pinned_at,
        })
        .collect())
}

/// True iff the (student, technique) pair has an active pin.
#[instrument]
pub async fn is_technique_pinned(
    pool: &Pool<Sqlite>,
    student_id: i64,
    technique_id: i64,
) -> Result<bool, AppError> {
    let row = sqlx::query!(
        r#"SELECT 1 AS "exists_flag!: i64"
           FROM pinned_techniques
           WHERE student_id = ? AND technique_id = ? AND unpinned_at IS NULL
           LIMIT 1"#,
        student_id,
        technique_id,
    )
    .fetch_optional(pool)
    .await?;
    Ok(row.is_some())
}
