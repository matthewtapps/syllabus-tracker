//! Syllabus CRUD and association queries.
//!
//! SQL identifiers (`collections`, `collection_techniques`,
//! `student_techniques.collection_id`) keep their legacy names per
//! M4.5's naming policy — the SQL rename ships atomically with the
//! M5c data-model cutover. Rust fn parameters, struct fields, and API
//! surfaces all use `syllabus_*` to match the user-facing concept.

use sqlx::{Pool, Sqlite};
use tracing::{info, instrument};

use crate::auth::{DbUser, User};
use crate::error::AppError;
use crate::models::{Syllabus, Technique, naive_to_utc};

#[instrument]
pub async fn create_syllabus(
    pool: &Pool<Sqlite>,
    name: &str,
    description: &str,
    coach_id: i64,
) -> Result<i64, AppError> {
    info!("Creating syllabus");
    let res = sqlx::query!(
        "INSERT INTO collections (name, description, coach_id) VALUES (?, ?, ?)",
        name,
        description,
        coach_id
    )
    .execute(pool)
    .await?;
    Ok(res.last_insert_rowid())
}

#[instrument]
pub async fn update_syllabus(
    pool: &Pool<Sqlite>,
    syllabus_id: i64,
    name: &str,
    description: &str,
) -> Result<(), AppError> {
    info!("Updating syllabus");
    sqlx::query!(
        "UPDATE collections SET name = ?, description = ? WHERE id = ?",
        name,
        description,
        syllabus_id
    )
    .execute(pool)
    .await?;
    Ok(())
}

#[instrument]
pub async fn delete_syllabus(pool: &Pool<Sqlite>, syllabus_id: i64) -> Result<(), AppError> {
    info!("Deleting syllabus");
    // Existing student assignments in this syllabus become "loose" rather
    // than disappear (preserves the student's history).
    sqlx::query!(
        // SQL identifier `collection_id` is the legacy name (M4.5 / decision #19).
        "UPDATE student_techniques SET collection_id = NULL WHERE collection_id = ?",
        syllabus_id
    )
    .execute(pool)
    .await?;
    sqlx::query!("DELETE FROM collections WHERE id = ?", syllabus_id)
        .execute(pool)
        .await?;
    Ok(())
}

#[instrument]
pub async fn get_all_syllabuses(pool: &Pool<Sqlite>) -> Result<Vec<Syllabus>, AppError> {
    info!("Listing syllabuses");
    let rows = sqlx::query!(
        r#"
        SELECT
            c.id, c.name, c.description, c.coach_id,
            c.created_at as "created_at: chrono::NaiveDateTime",
            (SELECT COUNT(*) FROM collection_techniques WHERE collection_id = c.id)
                as "technique_count!: i64",
            (SELECT COUNT(DISTINCT student_id) FROM student_techniques WHERE collection_id = c.id)
                as "student_count!: i64"
        FROM collections c
        ORDER BY c.name
        "#
    )
    .fetch_all(pool)
    .await?;

    Ok(rows
        .into_iter()
        .map(|r| Syllabus {
            id: r.id,
            name: r.name,
            description: r.description.unwrap_or_default(),
            coach_id: r.coach_id,
            created_at: r
                .created_at
                .map(naive_to_utc)
                .unwrap_or_else(chrono::Utc::now),
            technique_count: r.technique_count,
            student_count: r.student_count,
            techniques: Vec::new(),
        })
        .collect())
}

#[instrument]
pub async fn get_syllabus(pool: &Pool<Sqlite>, syllabus_id: i64) -> Result<Syllabus, AppError> {
    info!("Getting syllabus");
    let row = sqlx::query!(
        r#"
        SELECT
            c.id, c.name, c.description, c.coach_id,
            c.created_at as "created_at: chrono::NaiveDateTime",
            (SELECT COUNT(*) FROM collection_techniques WHERE collection_id = c.id)
                as "technique_count!: i64",
            (SELECT COUNT(DISTINCT student_id) FROM student_techniques WHERE collection_id = c.id)
                as "student_count!: i64"
        FROM collections c
        WHERE c.id = ?
        "#,
        syllabus_id
    )
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("Syllabus {} not found", syllabus_id)))?;

    let technique_rows = sqlx::query!(
        r#"
        SELECT t.id, t.name, t.description, t.coach_id, t.coach_name
        FROM collection_techniques ct
        JOIN techniques t ON t.id = ct.technique_id
        WHERE ct.collection_id = ?
        ORDER BY ct.position, t.name
        "#,
        syllabus_id
    )
    .fetch_all(pool)
    .await?;

    let techniques: Vec<Technique> = technique_rows
        .into_iter()
        .map(|r| Technique {
            id: r.id.unwrap_or_default(),
            name: r.name,
            description: r.description.unwrap_or_default(),
            coach_id: r.coach_id.unwrap_or_default(),
            coach_name: r.coach_name.unwrap_or_default(),
            tags: Vec::new(),
        })
        .collect();

    Ok(Syllabus {
        id: row.id,
        name: row.name,
        description: row.description.unwrap_or_default(),
        coach_id: row.coach_id,
        created_at: row
            .created_at
            .map(naive_to_utc)
            .unwrap_or_else(chrono::Utc::now),
        technique_count: row.technique_count,
        student_count: row.student_count,
        techniques,
    })
}

#[instrument]
pub async fn add_technique_to_syllabus(
    pool: &Pool<Sqlite>,
    syllabus_id: i64,
    technique_id: i64,
) -> Result<(), AppError> {
    info!("Adding technique to syllabus");
    sqlx::query!(
        "INSERT OR IGNORE INTO collection_techniques (collection_id, technique_id, position)
         VALUES (?, ?,
            (SELECT COALESCE(MAX(position), -1) + 1 FROM collection_techniques WHERE collection_id = ?))",
        syllabus_id,
        technique_id,
        syllabus_id
    )
    .execute(pool)
    .await?;
    Ok(())
}

#[instrument]
pub async fn add_techniques_to_syllabus(
    pool: &Pool<Sqlite>,
    syllabus_id: i64,
    technique_ids: Vec<i64>,
) -> Result<(), AppError> {
    info!("Adding techniques to syllabus");
    for technique_id in technique_ids {
        add_technique_to_syllabus(pool, syllabus_id, technique_id).await?;
    }
    Ok(())
}

#[instrument]
pub async fn create_technique_in_syllabus(
    pool: &Pool<Sqlite>,
    coach_id: i64,
    syllabus_id: i64,
    name: &str,
    description: &str,
) -> Result<i64, AppError> {
    info!("Creating technique in syllabus");
    let technique_id = super::create_technique(pool, name, description, coach_id).await?;
    add_technique_to_syllabus(pool, syllabus_id, technique_id).await?;
    Ok(technique_id)
}

#[instrument]
pub async fn remove_technique_from_syllabus(
    pool: &Pool<Sqlite>,
    syllabus_id: i64,
    technique_id: i64,
) -> Result<(), AppError> {
    info!("Removing technique from syllabus");
    sqlx::query!(
        "DELETE FROM collection_techniques WHERE collection_id = ? AND technique_id = ?",
        syllabus_id,
        technique_id
    )
    .execute(pool)
    .await?;
    // Detach the technique from any student assignments that were filed under
    // this syllabus (set collection_id to NULL, preserves the assignment).
    sqlx::query!(
        "UPDATE student_techniques
         SET collection_id = NULL
         WHERE collection_id = ? AND technique_id = ?",
        syllabus_id,
        technique_id
    )
    .execute(pool)
    .await?;
    Ok(())
}

/// Bulk-assign every technique in a syllabus to a student. Idempotent:
/// techniques the student already has are moved into this syllabus
/// (collection_id update), techniques they don't have are inserted. Returns
/// the number of NEW assignments created.
#[instrument]
pub async fn assign_syllabus_to_student(
    pool: &Pool<Sqlite>,
    student_id: i64,
    syllabus_id: i64,
    actor_id: i64,
) -> Result<usize, AppError> {
    info!("Assigning syllabus to student");
    let technique_ids: Vec<i64> = sqlx::query_scalar!(
        "SELECT technique_id FROM collection_techniques WHERE collection_id = ? ORDER BY position",
        syllabus_id
    )
    .fetch_all(pool)
    .await?;

    let before: i64 = sqlx::query_scalar!(
        "SELECT COUNT(*) FROM student_techniques WHERE student_id = ?",
        student_id
    )
    .fetch_one(pool)
    .await?;

    for tid in technique_ids {
        super::assign_technique_to_student(pool, tid, student_id, Some(syllabus_id), actor_id)
            .await?;
    }

    let after: i64 = sqlx::query_scalar!(
        "SELECT COUNT(*) FROM student_techniques WHERE student_id = ?",
        student_id
    )
    .fetch_one(pool)
    .await?;

    Ok((after - before).max(0) as usize)
}

#[instrument]
pub async fn get_students_with_syllabus(
    pool: &Pool<Sqlite>,
    syllabus_id: i64,
) -> Result<Vec<User>, AppError> {
    info!("Listing students with syllabus");
    let rows = sqlx::query_as!(
        DbUser,
        r#"
        SELECT DISTINCT u.id, u.username, u.role, u.display_name, u.archived,
               u.graduated_at as "graduated_at: chrono::NaiveDateTime",
               u.email,
               u.claimed_at as "claimed_at: chrono::NaiveDateTime",
               u.approved_at as "approved_at: chrono::NaiveDateTime",
               u.first_name, u.last_name,
               u.reset_requested_at as "reset_requested_at: chrono::NaiveDateTime",
               u.belt, u.stripes,
               u.last_graded_at as "last_graded_at: chrono::NaiveDateTime"
        FROM users u
        JOIN student_techniques st ON st.student_id = u.id
        WHERE st.collection_id = ?
        ORDER BY u.display_name, u.username
        "#,
        syllabus_id
    )
    .fetch_all(pool)
    .await?;
    Ok(rows.into_iter().map(User::from).collect())
}
