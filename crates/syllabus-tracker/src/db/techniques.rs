use std::collections::{HashMap, hash_map::Entry};

use chrono::NaiveDateTime;
use serde::{Deserialize, Serialize};
use sqlx::{Pool, Sqlite};
use tracing::{info, instrument};

use crate::error::AppError;
use crate::models::{Tag, Technique};

/// One row in the library / full-techniques admin list. Aggregates collection
/// membership count, how many students have the technique assigned, and the
/// most recent activity on any of those assignments.
#[derive(Debug, Serialize, Deserialize)]
pub struct LibraryTechniqueRow {
    pub id: i64,
    pub name: String,
    pub description: String,
    pub tags: Vec<Tag>,
    pub collection_count: i64,
    pub student_count: i64,
    pub last_activity_at: Option<String>,
}

#[instrument]
pub async fn list_library_techniques(
    pool: &Pool<Sqlite>,
) -> Result<Vec<LibraryTechniqueRow>, AppError> {
    info!("Listing library techniques with usage aggregates");

    let rows = sqlx::query!(
        r#"
        SELECT
            t.id AS "id!: i64",
            t.name,
            t.description,
            COALESCE((SELECT COUNT(*) FROM collection_techniques ct WHERE ct.technique_id = t.id), 0) AS "collection_count!: i64",
            COALESCE((SELECT COUNT(DISTINCT st.student_id) FROM student_techniques st WHERE st.technique_id = t.id), 0) AS "student_count!: i64",
            (SELECT MAX(st.updated_at) FROM student_techniques st WHERE st.technique_id = t.id) AS "last_activity_at?: NaiveDateTime"
        FROM techniques t
        ORDER BY t.name
        "#
    )
    .fetch_all(pool)
    .await?;

    let tag_rows = sqlx::query!(
        r#"SELECT tt.technique_id AS "technique_id!: i64",
                  tag.id AS "tag_id!: i64",
                  tag.name AS "tag_name!: String"
           FROM technique_tags tt
           JOIN tags tag ON tag.id = tt.tag_id
           ORDER BY tag.name"#
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

    Ok(rows
        .into_iter()
        .map(|r| LibraryTechniqueRow {
            id: r.id,
            tags: tags_by_technique.remove(&r.id).unwrap_or_default(),
            name: r.name,
            description: r.description.unwrap_or_default(),
            collection_count: r.collection_count,
            student_count: r.student_count,
            last_activity_at: r.last_activity_at.map(|dt| {
                chrono::DateTime::<chrono::Utc>::from_naive_utc_and_offset(dt, chrono::Utc)
                    .to_rfc3339()
            }),
        })
        .collect())
}

#[instrument]
pub async fn get_all_techniques(pool: &Pool<Sqlite>) -> Result<Vec<Technique>, AppError> {
    info!("Getting all techniques with tags");

    let rows = sqlx::query!(
        r#"
        SELECT t.id, t.name, t.description, t.coach_id, t.coach_name,
               tag.id as tag_id, tag.name as tag_name
        FROM techniques t
        LEFT JOIN technique_tags tt ON t.id = tt.technique_id
        LEFT JOIN tags tag ON tt.tag_id = tag.id
        ORDER BY t.name
        "#
    )
    .fetch_all(pool)
    .await?;

    let mut techniques_map: HashMap<i64, Technique> = HashMap::new();

    for row in rows {
        let technique_id = row.id;

        if let Entry::Vacant(e) = techniques_map.entry(technique_id) {
            let technique = Technique {
                id: technique_id,
                name: row.name,
                description: row.description.unwrap_or_default(),
                coach_id: row.coach_id.unwrap_or_default(),
                coach_name: row.coach_name.unwrap_or_default(),
                tags: Vec::new(),
            };
            e.insert(technique);
        }

        if let (tag_id, Some(tag_name)) = (row.tag_id, row.tag_name) {
            let tag = Tag {
                id: tag_id,
                name: tag_name,
            };

            let technique = techniques_map.get_mut(&technique_id).unwrap();
            if !technique.tags.iter().any(|t| t.id == tag_id) {
                technique.tags.push(tag);
            }
        }
    }

    for technique in techniques_map.values_mut() {
        technique.tags.sort_by(|a, b| a.name.cmp(&b.name));
    }

    let techniques: Vec<Technique> = techniques_map.into_values().collect();
    Ok(techniques)
}

#[instrument]
pub async fn update_technique(
    pool: &Pool<Sqlite>,
    technique_id: i64,
    name: &str,
    description: &str,
) -> Result<(), AppError> {
    info!("Updating technique");
    sqlx::query!(
        "UPDATE techniques
         SET name = ?, description = ?
         WHERE id = ?",
        name,
        description,
        technique_id
    )
    .execute(pool)
    .await?;

    sqlx::query!(
        "UPDATE student_techniques
         SET technique_name = ?, technique_description = ?
         WHERE technique_id = ?",
        name,
        description,
        technique_id
    )
    .execute(pool)
    .await?;

    Ok(())
}

#[instrument]
pub async fn create_technique(
    pool: &Pool<Sqlite>,
    name: &str,
    description: &str,
    coach_id: i64,
) -> Result<i64, AppError> {
    info!("Creating technique");
    let res = sqlx::query!(
        "INSERT INTO techniques (name, description, coach_id)
         VALUES (?, ?, ?)",
        name,
        description,
        coach_id
    )
    .execute(pool)
    .await?;
    Ok(res.last_insert_rowid())
}

#[instrument]
pub async fn create_and_assign_technique(
    pool: &Pool<Sqlite>,
    coach_id: i64,
    student_id: i64,
    technique_name: &str,
    technique_description: &str,
    collection_id: Option<i64>,
) -> Result<(), AppError> {
    info!("Creating and assigning technique to student");
    let technique_id =
        create_technique(pool, technique_name, technique_description, coach_id).await?;

    super::assign_technique_to_student(pool, technique_id, student_id, collection_id, coach_id)
        .await?;

    Ok(())
}

#[instrument]
pub async fn count_techniques(pool: &Pool<Sqlite>) -> Result<i64, AppError> {
    let row = sqlx::query!("SELECT COUNT(*) as count FROM techniques")
        .fetch_one(pool)
        .await?;
    Ok(row.count as i64)
}
