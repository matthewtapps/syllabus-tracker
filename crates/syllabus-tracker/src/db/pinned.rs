//! Student-curated personal pin list, drawn from the global techniques
//! library. Independent of any coach assignment or syllabus.

use std::collections::{HashMap, HashSet};

use chrono::NaiveDateTime;
use sqlx::{Pool, Sqlite};
use tracing::{info, instrument};

use crate::db::activity::{NewActivity, Verb, emit};
use crate::error::AppError;
use crate::models::Tag;

use super::techniques::LibraryTechniqueRow;

#[instrument]
pub async fn list_pinned_for_student(
    pool: &Pool<Sqlite>,
    student_id: i64,
) -> Result<Vec<LibraryTechniqueRow>, AppError> {
    info!("Listing pinned techniques for student");

    let rows = sqlx::query!(
        r#"
        SELECT
            t.id AS "id!: i64",
            t.name,
            t.description,
            spt.pinned_at AS "pinned_at!: NaiveDateTime",
            COALESCE((SELECT COUNT(*) FROM collection_techniques ct WHERE ct.technique_id = t.id), 0) AS "collection_count!: i64",
            COALESCE((SELECT COUNT(DISTINCT st.student_id) FROM student_techniques st WHERE st.technique_id = t.id), 0) AS "student_count!: i64",
            COALESCE((SELECT COUNT(*) FROM videos v WHERE v.technique_id = t.id AND v.deleted_at IS NULL), 0) AS "video_count!: i64",
            (SELECT MAX(st.updated_at) FROM student_techniques st WHERE st.technique_id = t.id) AS "last_activity_at?: NaiveDateTime"
        FROM student_pinned_techniques spt
        JOIN techniques t ON t.id = spt.technique_id
        WHERE spt.student_id = ?
        ORDER BY spt.pinned_at DESC
        "#,
        student_id,
    )
    .fetch_all(pool)
    .await?;

    let tag_rows = sqlx::query!(
        r#"SELECT tt.technique_id AS "technique_id!: i64",
                  tag.id AS "tag_id!: i64",
                  tag.name AS "tag_name!: String"
           FROM technique_tags tt
           JOIN tags tag ON tag.id = tt.tag_id
           JOIN student_pinned_techniques spt ON spt.technique_id = tt.technique_id
           WHERE spt.student_id = ?
           ORDER BY tag.name"#,
        student_id,
    )
    .fetch_all(pool)
    .await?;

    let mut tags_by_technique: HashMap<i64, Vec<Tag>> = HashMap::new();
    for row in tag_rows {
        tags_by_technique
            .entry(row.technique_id)
            .or_default()
            .push(Tag {
                id: row.tag_id,
                name: row.tag_name,
            });
    }

    let collection_rows = sqlx::query!(
        r#"SELECT ct.technique_id AS "technique_id!: i64",
                  ct.collection_id AS "collection_id!: i64"
           FROM collection_techniques ct
           JOIN student_pinned_techniques spt ON spt.technique_id = ct.technique_id
           WHERE spt.student_id = ?"#,
        student_id,
    )
    .fetch_all(pool)
    .await?;
    let mut collections_by_technique: HashMap<i64, Vec<i64>> = HashMap::new();
    for row in collection_rows {
        collections_by_technique
            .entry(row.technique_id)
            .or_default()
            .push(row.collection_id);
    }

    Ok(rows
        .into_iter()
        .map(|r| LibraryTechniqueRow {
            id: r.id,
            tags: tags_by_technique.remove(&r.id).unwrap_or_default(),
            collection_ids: collections_by_technique.remove(&r.id).unwrap_or_default(),
            name: r.name,
            description: r.description.unwrap_or_default(),
            collection_count: r.collection_count,
            student_count: r.student_count,
            video_count: r.video_count,
            last_activity_at: r.last_activity_at.map(|dt| {
                chrono::DateTime::<chrono::Utc>::from_naive_utc_and_offset(dt, chrono::Utc)
                    .to_rfc3339()
            }),
            is_pinned: true,
        })
        .collect())
}

/// Returns the set of technique IDs the student has pinned. Used to overlay
/// `is_pinned` onto a full library listing without re-running the library
/// query per student.
#[instrument]
pub async fn pinned_technique_ids_for_student(
    pool: &Pool<Sqlite>,
    student_id: i64,
) -> Result<HashSet<i64>, AppError> {
    let rows = sqlx::query!(
        r#"SELECT technique_id AS "technique_id!: i64"
           FROM student_pinned_techniques
           WHERE student_id = ?"#,
        student_id,
    )
    .fetch_all(pool)
    .await?;
    Ok(rows.into_iter().map(|r| r.technique_id).collect())
}

#[instrument]
pub async fn pin_technique(
    pool: &Pool<Sqlite>,
    student_id: i64,
    technique_id: i64,
) -> Result<(), AppError> {
    info!("Pinning technique");
    let mut tx = pool.begin().await?;
    sqlx::query!(
        "INSERT OR IGNORE INTO student_pinned_techniques (student_id, technique_id) VALUES (?, ?)",
        student_id,
        technique_id,
    )
    .execute(&mut *tx)
    .await?;
    emit(
        &mut tx,
        NewActivity::new(Verb::TechniquePinned, student_id)
            .target_student(student_id)
            .technique(technique_id),
    )
    .await?;
    tx.commit().await?;
    Ok(())
}

#[instrument]
pub async fn unpin_technique(
    pool: &Pool<Sqlite>,
    student_id: i64,
    technique_id: i64,
) -> Result<(), AppError> {
    info!("Unpinning technique");
    let mut tx = pool.begin().await?;
    sqlx::query!(
        "DELETE FROM student_pinned_techniques WHERE student_id = ? AND technique_id = ?",
        student_id,
        technique_id,
    )
    .execute(&mut *tx)
    .await?;
    emit(
        &mut tx,
        NewActivity::new(Verb::TechniqueUnpinned, student_id)
            .target_student(student_id)
            .technique(technique_id),
    )
    .await?;
    tx.commit().await?;
    Ok(())
}
