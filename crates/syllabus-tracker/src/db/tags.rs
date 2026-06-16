use sqlx::{Pool, Sqlite};
use tracing::{info, instrument};

use crate::db::activity::{
    NewActivity, Verb, affected_students_for_technique, emit_fanout, payload,
};
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
    actor_id: i64,
) -> Result<(), AppError> {
    info!("Adding tag to technique");
    let mut tx = pool.begin().await?;

    let tag_name = sqlx::query_scalar!(
        r#"SELECT name AS "name!: String" FROM tags WHERE id = ?"#,
        tag_id
    )
    .fetch_one(&mut *tx)
    .await?;

    sqlx::query!(
        "INSERT OR IGNORE INTO technique_tags (technique_id, tag_id) VALUES (?, ?)",
        technique_id,
        tag_id
    )
    .execute(&mut *tx)
    .await?;

    let affected = affected_students_for_technique(&mut tx, technique_id).await?;
    emit_fanout(
        &mut tx,
        NewActivity::new(Verb::TechniqueEdited, actor_id)
            .technique(technique_id)
            .payload(payload::technique_edited(false, false, &[tag_name], &[])),
        &affected,
    )
    .await?;

    tx.commit().await?;
    Ok(())
}

#[instrument]
pub async fn remove_tag_from_technique(
    pool: &Pool<Sqlite>,
    technique_id: i64,
    tag_id: i64,
    actor_id: i64,
) -> Result<(), AppError> {
    info!("Removing tag from technique");
    let mut tx = pool.begin().await?;

    let tag_name = sqlx::query_scalar!(
        r#"SELECT name AS "name!: String" FROM tags WHERE id = ?"#,
        tag_id
    )
    .fetch_one(&mut *tx)
    .await?;

    sqlx::query!(
        "DELETE FROM technique_tags WHERE technique_id = ? AND tag_id = ?",
        technique_id,
        tag_id
    )
    .execute(&mut *tx)
    .await?;

    let affected = affected_students_for_technique(&mut tx, technique_id).await?;
    emit_fanout(
        &mut tx,
        NewActivity::new(Verb::TechniqueEdited, actor_id)
            .technique(technique_id)
            .payload(payload::technique_edited(false, false, &[], &[tag_name])),
        &affected,
    )
    .await?;

    tx.commit().await?;
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
