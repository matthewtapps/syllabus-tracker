//! Camps: a generic camp is a coach-curated stretch of work for one student,
//! holding library-technique membership, camp-owned videos, and camp threads.
//! Slice 1: generic only. All writes are coach-gated at the route layer.

use chrono::NaiveDateTime;
use serde::Serialize;
use sqlx::{Pool, Sqlite};
use tracing::instrument;

use crate::db::activity::{emit, NewActivity, Verb};
use crate::error::AppError;
use crate::models::Tag;

#[derive(Debug, Clone, Serialize)]
pub struct Camp {
    pub id: i64,
    pub student_id: i64,
    pub coach_id: i64,
    pub name: String,
    pub description: Option<String>,
    pub created_at: NaiveDateTime,
    pub archived_at: Option<NaiveDateTime>,
    pub competition_id: Option<i64>,
    /// Id of the camp this camp builds on (set at creation, optional).
    pub references_camp_id: Option<i64>,
}

#[derive(Debug, Clone, Serialize)]
pub struct CampTechnique {
    pub technique_id: i64,
    pub name: String,
    pub description: Option<String>,
    pub position: i64,
    pub tags: Vec<Tag>,
    pub video_count: i64,
}

pub struct NewCamp {
    pub student_id: i64,
    pub coach_id: i64,
    pub name: String,
    pub description: Option<String>,
    /// Optional id of an earlier camp this new camp builds on.
    pub references_camp_id: Option<i64>,
}

#[instrument(skip(pool, new))]
pub async fn create_camp(pool: &Pool<Sqlite>, new: NewCamp) -> Result<i64, AppError> {
    // A "builds on" reference must point at a camp of the SAME student, so we
    // don't link to (or leak the name of) another student's camp.
    if let Some(ref_id) = new.references_camp_id {
        let ref_student = sqlx::query_scalar!(
            r#"SELECT student_id AS "student_id!: i64" FROM camps WHERE id = ?"#,
            ref_id
        )
        .fetch_optional(pool)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("referenced camp #{ref_id} not found")))?;
        if ref_student != new.student_id {
            return Err(AppError::Validation(
                "referenced camp belongs to a different student".to_string(),
            ));
        }
    }
    let mut tx = pool.begin().await?;
    let id = sqlx::query_scalar!(
        r#"INSERT INTO camps (student_id, coach_id, name, description, references_camp_id)
           VALUES (?, ?, ?, ?, ?) RETURNING id AS "id!: i64""#,
        new.student_id,
        new.coach_id,
        new.name,
        new.description,
        new.references_camp_id,
    )
    .fetch_one(&mut *tx)
    .await?;
    emit(
        &mut tx,
        NewActivity::new(Verb::CampCreated, new.coach_id)
            .target_student(new.student_id)
            .camp(id)
            .context_kind("camp"),
    )
    .await?;
    tx.commit().await?;
    Ok(id)
}

#[instrument(skip(pool))]
pub async fn get_camp(pool: &Pool<Sqlite>, id: i64) -> Result<Option<Camp>, AppError> {
    let row = sqlx::query!(
        r#"SELECT id AS "id!: i64", student_id AS "student_id!: i64",
                  coach_id AS "coach_id!: i64", name, description,
                  created_at AS "created_at!: NaiveDateTime",
                  archived_at AS "archived_at?: NaiveDateTime",
                  competition_id AS "competition_id?: i64",
                  references_camp_id AS "references_camp_id?: i64"
           FROM camps WHERE id = ?"#,
        id
    )
    .fetch_optional(pool)
    .await?;
    Ok(row.map(|r| Camp {
        id: r.id,
        student_id: r.student_id,
        coach_id: r.coach_id,
        name: r.name,
        description: r.description,
        created_at: r.created_at,
        archived_at: r.archived_at,
        competition_id: r.competition_id,
        references_camp_id: r.references_camp_id,
    }))
}

#[instrument(skip(pool))]
pub async fn list_camps_for_student(
    pool: &Pool<Sqlite>,
    student_id: i64,
    include_archived: bool,
) -> Result<Vec<Camp>, AppError> {
    let rows = sqlx::query!(
        r#"SELECT id AS "id!: i64", student_id AS "student_id!: i64",
                  coach_id AS "coach_id!: i64", name, description,
                  created_at AS "created_at!: NaiveDateTime",
                  archived_at AS "archived_at?: NaiveDateTime",
                  competition_id AS "competition_id?: i64",
                  references_camp_id AS "references_camp_id?: i64"
           FROM camps
           WHERE student_id = ? AND (? OR archived_at IS NULL)
           ORDER BY (archived_at IS NOT NULL), created_at DESC"#,
        student_id,
        include_archived,
    )
    .fetch_all(pool)
    .await?;
    Ok(rows
        .into_iter()
        .map(|r| Camp {
            id: r.id,
            student_id: r.student_id,
            coach_id: r.coach_id,
            name: r.name,
            description: r.description,
            created_at: r.created_at,
            archived_at: r.archived_at,
            competition_id: r.competition_id,
            references_camp_id: r.references_camp_id,
        })
        .collect())
}

#[instrument(skip(pool))]
pub async fn update_camp(
    pool: &Pool<Sqlite>,
    id: i64,
    name: &str,
    description: Option<&str>,
) -> Result<(), AppError> {
    let affected = sqlx::query!(
        "UPDATE camps SET name = ?, description = ? WHERE id = ?",
        name,
        description,
        id,
    )
    .execute(pool)
    .await?
    .rows_affected();
    if affected == 0 {
        return Err(AppError::NotFound(format!("camp #{id} not found")));
    }
    Ok(())
}

#[instrument(skip(pool))]
pub async fn archive_camp(pool: &Pool<Sqlite>, id: i64, by_id: i64) -> Result<(), AppError> {
    let mut tx = pool.begin().await?;
    let camp = sqlx::query!(
        r#"SELECT student_id AS "student_id!: i64" FROM camps WHERE id = ?"#,
        id
    )
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| AppError::NotFound("camp not found".into()))?;
    let updated = sqlx::query!(
        "UPDATE camps SET archived_at = CURRENT_TIMESTAMP, archived_by_id = ?
         WHERE id = ? AND archived_at IS NULL",
        by_id,
        id,
    )
    .execute(&mut *tx)
    .await?
    .rows_affected();
    // Only emit when this call actually archived the camp; a double-archive is
    // a no-op and must not produce a second CampArchived activity row.
    if updated > 0 {
        emit(
            &mut tx,
            NewActivity::new(Verb::CampArchived, by_id)
                .target_student(camp.student_id)
                .camp(id)
                .context_kind("camp"),
        )
        .await?;
    }
    tx.commit().await?;
    Ok(())
}

#[instrument(skip(pool))]
pub async fn add_camp_technique(
    pool: &Pool<Sqlite>,
    camp_id: i64,
    technique_id: i64,
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
    let position = sqlx::query_scalar!(
        r#"SELECT COALESCE(MAX(position), -1) + 1 AS "p!: i64"
           FROM camp_techniques WHERE camp_id = ?"#,
        camp_id
    )
    .fetch_one(&mut *tx)
    .await?;
    let affected = sqlx::query!(
        "INSERT OR IGNORE INTO camp_techniques (camp_id, technique_id, position, added_by_id)
         VALUES (?, ?, ?, ?)",
        camp_id,
        technique_id,
        position,
        by_id,
    )
    .execute(&mut *tx)
    .await?
    .rows_affected();
    // Re-adding an existing technique is a no-op (INSERT OR IGNORE); don't emit
    // a spurious CampTechniqueAdded activity row in that case.
    if affected > 0 {
        emit(
            &mut tx,
            NewActivity::new(Verb::CampTechniqueAdded, by_id)
                .target_student(camp.student_id)
                .camp(camp_id)
                .technique(technique_id)
                .context_kind("camp"),
        )
        .await?;
    }
    tx.commit().await?;
    Ok(())
}

#[instrument(skip(pool))]
pub async fn remove_camp_technique(
    pool: &Pool<Sqlite>,
    camp_id: i64,
    technique_id: i64,
) -> Result<(), AppError> {
    sqlx::query!(
        "DELETE FROM camp_techniques WHERE camp_id = ? AND technique_id = ?",
        camp_id,
        technique_id,
    )
    .execute(pool)
    .await?;
    Ok(())
}

#[instrument(skip(pool))]
pub async fn list_camp_techniques(
    pool: &Pool<Sqlite>,
    camp_id: i64,
) -> Result<Vec<CampTechnique>, AppError> {
    let rows = sqlx::query!(
        r#"SELECT t.id AS "technique_id!: i64", t.name, t.description,
                  ct.position AS "position!: i64",
                  COALESCE(
                      (SELECT COUNT(*) FROM videos v
                       WHERE v.technique_id = t.id AND v.deleted_at IS NULL),
                      0
                  ) AS "video_count!: i64"
           FROM camp_techniques ct
           JOIN techniques t ON t.id = ct.technique_id
           WHERE ct.camp_id = ?
           ORDER BY ct.position"#,
        camp_id
    )
    .fetch_all(pool)
    .await?;

    // Collect technique ids to fetch tags in one query, matching the library
    // list pattern (separate bulk fetch, keyed by technique_id, ordered by
    // tag name).
    let technique_ids: Vec<i64> = rows.iter().map(|r| r.technique_id).collect();

    let mut tags_by_technique: std::collections::HashMap<i64, Vec<Tag>> =
        std::collections::HashMap::new();

    if !technique_ids.is_empty() {
        let ids_json = serde_json::Value::Array(
            technique_ids
                .iter()
                .map(|id| serde_json::Value::Number((*id).into()))
                .collect(),
        );
        let tag_rows = sqlx::query!(
            r#"SELECT tt.technique_id AS "technique_id!: i64",
                      tag.id AS "tag_id!: i64",
                      tag.name AS "tag_name!: String"
               FROM technique_tags tt
               JOIN tags tag ON tag.id = tt.tag_id
               WHERE tt.technique_id IN (SELECT value FROM json_each(?))
               ORDER BY tag.name"#,
            ids_json
        )
        .fetch_all(pool)
        .await?;

        for row in tag_rows {
            tags_by_technique
                .entry(row.technique_id)
                .or_default()
                .push(Tag {
                    id: row.tag_id,
                    name: row.tag_name,
                });
        }
    }

    Ok(rows
        .into_iter()
        .map(|r| {
            let tags = tags_by_technique.remove(&r.technique_id).unwrap_or_default();
            CampTechnique {
                technique_id: r.technique_id,
                name: r.name,
                description: r.description,
                position: r.position,
                tags,
                video_count: r.video_count,
            }
        })
        .collect())
}
