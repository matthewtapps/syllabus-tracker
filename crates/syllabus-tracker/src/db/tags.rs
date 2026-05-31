use sqlx::{Pool, Sqlite};
use tracing::{info, instrument};

use crate::error::AppError;
use crate::models::{DbTag, DbTechnique, Tag, Technique};

#[instrument]
pub async fn create_tag(pool: &Pool<Sqlite>, name: &str) -> Result<i64, AppError> {
    info!("Creating tag");
    let res = sqlx::query!("INSERT INTO tags (name) VALUES (?)", name)
        .execute(pool)
        .await?;
    Ok(res.last_insert_rowid())
}

#[instrument]
pub async fn get_all_tags(pool: &Pool<Sqlite>) -> Result<Vec<Tag>, AppError> {
    info!("Getting all tags");
    let rows = sqlx::query_as!(DbTag, "SELECT id, name FROM tags ORDER BY name")
        .fetch_all(pool)
        .await?;

    Ok(rows.into_iter().map(Tag::from).collect())
}

#[instrument]
pub async fn get_tags_for_technique(
    pool: &Pool<Sqlite>,
    technique_id: i64,
) -> Result<Vec<Tag>, AppError> {
    info!("Getting tags for technique");
    let rows = sqlx::query_as!(
        DbTag,
        "SELECT t.id, t.name
         FROM tags t
         JOIN technique_tags tt ON t.id = tt.tag_id
         WHERE tt.technique_id = ?
         ORDER BY t.name",
        technique_id
    )
    .fetch_all(pool)
    .await?;

    Ok(rows.into_iter().map(Tag::from).collect())
}

#[instrument]
pub async fn add_tag_to_technique(
    pool: &Pool<Sqlite>,
    technique_id: i64,
    tag_id: i64,
) -> Result<(), AppError> {
    info!("Adding tag to technique");
    sqlx::query!(
        "INSERT OR IGNORE INTO technique_tags (technique_id, tag_id) VALUES (?, ?)",
        technique_id,
        tag_id
    )
    .execute(pool)
    .await?;

    Ok(())
}

#[instrument]
pub async fn remove_tag_from_technique(
    pool: &Pool<Sqlite>,
    technique_id: i64,
    tag_id: i64,
) -> Result<(), AppError> {
    info!("Removing tag from technique");
    sqlx::query!(
        "DELETE FROM technique_tags WHERE technique_id = ? AND tag_id = ?",
        technique_id,
        tag_id
    )
    .execute(pool)
    .await?;

    Ok(())
}

#[instrument]
pub async fn delete_tag(pool: &Pool<Sqlite>, tag_id: i64) -> Result<(), AppError> {
    info!("Deleting tag");
    // technique_tags rows are cleaned up by the ON DELETE CASCADE constraint.
    sqlx::query!("DELETE FROM tags WHERE id = ?", tag_id)
        .execute(pool)
        .await?;

    Ok(())
}

#[instrument]
pub async fn get_tag_by_name(pool: &Pool<Sqlite>, name: &str) -> Result<Option<Tag>, AppError> {
    info!("Getting tag by name");
    let row = sqlx::query_as!(DbTag, "SELECT id, name FROM tags WHERE name = ?", name)
        .fetch_optional(pool)
        .await?;

    Ok(row.map(Tag::from))
}

#[instrument]
pub async fn get_techniques_by_tag(
    pool: &Pool<Sqlite>,
    tag_id: i64,
) -> Result<Vec<Technique>, AppError> {
    info!("Getting techniques by tag");
    let rows = sqlx::query_as!(
        DbTechnique,
        "SELECT t.*
         FROM techniques t
         JOIN technique_tags tt ON t.id = tt.technique_id
         WHERE tt.tag_id = ?
         ORDER BY t.name",
        tag_id
    )
    .fetch_all(pool)
    .await?;

    Ok(rows.into_iter().map(Technique::from).collect())
}
