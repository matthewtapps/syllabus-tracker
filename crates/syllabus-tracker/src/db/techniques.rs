use std::collections::{HashMap, hash_map::Entry};

use chrono::NaiveDateTime;
use serde::Serialize;
use sqlx::{Pool, Sqlite};
use tracing::{info, instrument};

use crate::error::AppError;
use crate::models::{AttemptBucket, Tag, Technique};

/// One row in the library / full-techniques admin list. Aggregates syllabus
/// membership count, how many students have the technique assigned, and the
/// most recent activity on any of those assignments.
#[derive(Debug, Serialize)]
pub struct LibraryTechniqueRow {
    pub id: i64,
    pub name: String,
    pub description: String,
    pub tags: Vec<Tag>,
    /// IDs of the syllabuses this technique belongs to. Sent alongside
    /// `syllabus_count` so the frontend can render bubble filters that
    /// scope the list to "techniques in syllabus X" without an extra
    /// per-row fetch.
    pub syllabus_ids: Vec<i64>,
    pub syllabus_count: i64,
    pub student_count: i64,
    pub video_count: i64,
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
            -- SQL identifier `collection_techniques` is the legacy table name (M4.5 / decision #19).
            COALESCE((SELECT COUNT(*) FROM collection_techniques ct WHERE ct.technique_id = t.id), 0) AS "syllabus_count!: i64",
            COALESCE((SELECT COUNT(DISTINCT st.student_id) FROM student_techniques st WHERE st.technique_id = t.id), 0) AS "student_count!: i64",
            COALESCE((SELECT COUNT(*) FROM videos v WHERE v.technique_id = t.id AND v.deleted_at IS NULL), 0) AS "video_count!: i64",
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

    let syllabus_rows = sqlx::query!(
        // SQL identifiers `collection_techniques` / `collection_id` are legacy
        // table / column names (M4.5 / decision #19); aliased on the way out.
        r#"SELECT technique_id AS "technique_id!: i64",
                  collection_id AS "syllabus_id!: i64"
           FROM collection_techniques"#
    )
    .fetch_all(pool)
    .await?;
    let mut syllabuses_by_technique: HashMap<i64, Vec<i64>> = HashMap::new();
    for row in syllabus_rows {
        syllabuses_by_technique
            .entry(row.technique_id)
            .or_default()
            .push(row.syllabus_id);
    }

    Ok(rows
        .into_iter()
        .map(|r| LibraryTechniqueRow {
            id: r.id,
            tags: tags_by_technique.remove(&r.id).unwrap_or_default(),
            syllabus_ids: syllabuses_by_technique.remove(&r.id).unwrap_or_default(),
            name: r.name,
            description: r.description.unwrap_or_default(),
            syllabus_count: r.syllabus_count,
            student_count: r.student_count,
            video_count: r.video_count,
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

/// Syllabus reference shown on the library expanded row.
#[derive(Debug, Serialize)]
pub struct LibraryTechniqueSyllabusRef {
    pub id: i64,
    pub name: String,
}

/// Status mix across all student_techniques for a single library technique.
#[derive(Debug, Serialize)]
pub struct LibraryTechniqueStatusCounts {
    pub red: i64,
    pub amber: i64,
    pub green: i64,
}

/// Everything needed to render the expanded library row's stats strip.
#[derive(Debug, Serialize)]
pub struct LibraryTechniqueStats {
    pub syllabuses: Vec<LibraryTechniqueSyllabusRef>,
    pub status_counts: LibraryTechniqueStatusCounts,
    pub attempts_30d: i64,
    pub attempts_weekly_buckets: Vec<AttemptBucket>,
    pub video_plays: i64,
}

#[instrument]
pub async fn library_technique_stats(
    pool: &Pool<Sqlite>,
    technique_id: i64,
) -> Result<LibraryTechniqueStats, AppError> {
    // SQL identifiers `collection_techniques` / `collections` / `collection_id`
    // are legacy table / column names (M4.5 / decision #19).
    let syllabus_rows = sqlx::query!(
        r#"SELECT c.id AS "id!: i64", c.name AS "name!: String"
           FROM collection_techniques ct
           JOIN collections c ON c.id = ct.collection_id
           WHERE ct.technique_id = ?
           ORDER BY c.name"#,
        technique_id
    )
    .fetch_all(pool)
    .await?;
    let syllabuses = syllabus_rows
        .into_iter()
        .map(|r| LibraryTechniqueSyllabusRef {
            id: r.id,
            name: r.name,
        })
        .collect();

    let status_row = sqlx::query!(
        r#"SELECT
            COALESCE(SUM(CASE WHEN status = 'red'   THEN 1 ELSE 0 END), 0) AS "red!: i64",
            COALESCE(SUM(CASE WHEN status = 'amber' THEN 1 ELSE 0 END), 0) AS "amber!: i64",
            COALESCE(SUM(CASE WHEN status = 'green' THEN 1 ELSE 0 END), 0) AS "green!: i64"
           FROM student_techniques WHERE technique_id = ?"#,
        technique_id
    )
    .fetch_one(pool)
    .await?;
    let status_counts = LibraryTechniqueStatusCounts {
        red: status_row.red,
        amber: status_row.amber,
        green: status_row.green,
    };

    let attempts_30d_row = sqlx::query!(
        r#"SELECT COUNT(*) AS "count!: i64"
           FROM attempts a
           JOIN student_techniques st ON st.id = a.student_technique_id
           WHERE st.technique_id = ?
             AND a.attempted_at >= datetime('now', '-30 days')"#,
        technique_id
    )
    .fetch_one(pool)
    .await?;

    let bucket_rows = sqlx::query!(
        r#"SELECT date(a.attempted_at, 'weekday 0', '-6 days') AS "week_start!: String",
                  COUNT(*) AS "count!: i64"
           FROM attempts a
           JOIN student_techniques st ON st.id = a.student_technique_id
           WHERE st.technique_id = ?
             AND a.attempted_at >= datetime('now', '-56 days')
           GROUP BY date(a.attempted_at, 'weekday 0', '-6 days')
           ORDER BY 1"#,
        technique_id,
    )
    .fetch_all(pool)
    .await?;
    let attempts_weekly_buckets = bucket_rows
        .into_iter()
        .filter_map(|r| {
            chrono::NaiveDate::parse_from_str(&r.week_start, "%Y-%m-%d")
                .ok()
                .map(|date| AttemptBucket {
                    date,
                    count: r.count,
                })
        })
        .collect();

    let plays_row = sqlx::query!(
        r#"SELECT COALESCE(SUM(a.play_count), 0) AS "plays!: i64"
           FROM video_watch_aggregates a
           JOIN videos v ON v.id = a.video_id
           WHERE v.technique_id = ? AND v.deleted_at IS NULL"#,
        technique_id
    )
    .fetch_one(pool)
    .await?;

    Ok(LibraryTechniqueStats {
        syllabuses,
        status_counts,
        attempts_30d: attempts_30d_row.count,
        attempts_weekly_buckets,
        video_plays: plays_row.plays,
    })
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
    syllabus_id: Option<i64>,
) -> Result<(), AppError> {
    info!("Creating and assigning technique to student");
    let technique_id =
        create_technique(pool, technique_name, technique_description, coach_id).await?;

    super::assign_technique_to_student(pool, technique_id, student_id, syllabus_id, coach_id)
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
