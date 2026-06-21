//! Camps: a generic camp is a coach-curated stretch of work for one student,
//! holding camp-owned videos and camp threads. Techniques are "in" a camp when a
//! camp_technique THREAD (anchor_kind='camp_technique') exists for them; there is
//! no separate ordered-list table.

use chrono::NaiveDateTime;
use serde::Serialize;
use sqlx::{Pool, Sqlite};
use tracing::instrument;

use crate::db::activity::{emit, NewActivity, Verb};
use crate::error::AppError;

/// Scope for a technique created inside a camp.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TechniqueScope {
    /// Technique joins the global library (is_global=1, scoped_camp_id=NULL).
    Global,
    /// Technique is scoped to this camp only (is_global=0, scoped_camp_id=<camp>).
    Scoped,
}

#[derive(Debug, Clone, Serialize)]
pub struct Camp {
    pub id: i64,
    pub student_id: i64,
    pub coach_id: i64,
    pub name: String,
    pub description: Option<String>,
    pub created_at: NaiveDateTime,
    pub archived_at: Option<NaiveDateTime>,
}

pub struct NewCamp {
    pub student_id: i64,
    pub coach_id: i64,
    pub name: String,
    pub description: Option<String>,
}

#[instrument(skip(pool, new))]
pub async fn create_camp(pool: &Pool<Sqlite>, new: NewCamp) -> Result<i64, AppError> {
    let mut tx = pool.begin().await?;
    let id = sqlx::query_scalar!(
        r#"INSERT INTO camps (student_id, coach_id, name, description)
           VALUES (?, ?, ?, ?) RETURNING id AS "id!: i64""#,
        new.student_id,
        new.coach_id,
        new.name,
        new.description,
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
                  archived_at AS "archived_at?: NaiveDateTime"
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
                  archived_at AS "archived_at?: NaiveDateTime"
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
        })
        .collect())
}

#[derive(Debug, Clone, Serialize)]
pub struct CampSummary {
    pub id: i64,
    pub student_id: i64,
    pub coach_id: i64,
    pub name: String,
    pub description: Option<String>,
    pub created_at: NaiveDateTime,
    pub archived_at: Option<NaiveDateTime>,
    pub video_count: i64,
    /// Most recent activity timestamp for this camp (MAX over the activity
    /// table by camp_id). None when the camp has no activity rows.
    pub last_activity_at: Option<NaiveDateTime>,
}

/// Enriched camp list for the profile/list surfaces: bare camp columns plus
/// video count and last-activity. Ordered active first, then by last activity
/// (falling back to creation) descending.
#[instrument(skip(pool))]
pub async fn list_camp_summaries_for_student(
    pool: &Pool<Sqlite>,
    student_id: i64,
    include_archived: bool,
) -> Result<Vec<CampSummary>, AppError> {
    let rows = sqlx::query!(
        r#"SELECT
               c.id AS "id!: i64", c.student_id AS "student_id!: i64",
               c.coach_id AS "coach_id!: i64", c.name, c.description,
               c.created_at AS "created_at!: NaiveDateTime",
               c.archived_at AS "archived_at?: NaiveDateTime",
               (SELECT COUNT(*) FROM videos v WHERE v.camp_id = c.id)
                   AS "video_count!: i64",
               (SELECT MAX(a.occurred_at) FROM activity a WHERE a.camp_id = c.id)
                   AS "last_activity_at?: NaiveDateTime"
           FROM camps c
           WHERE c.student_id = ? AND (? OR c.archived_at IS NULL)
           ORDER BY (c.archived_at IS NOT NULL),
                    COALESCE(
                        (SELECT MAX(a.occurred_at) FROM activity a WHERE a.camp_id = c.id),
                        c.created_at
                    ) DESC"#,
        student_id,
        include_archived,
    )
    .fetch_all(pool)
    .await?;
    Ok(rows
        .into_iter()
        .map(|r| CampSummary {
            id: r.id,
            student_id: r.student_id,
            coach_id: r.coach_id,
            name: r.name,
            description: r.description,
            created_at: r.created_at,
            archived_at: r.archived_at,
            video_count: r.video_count,
            last_activity_at: r.last_activity_at,
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

/// CC-009 (global) + CC-010 (scoped): create a NEW technique inside a camp.
///
/// `scope = TechniqueScope::Global`  → technique joins the shared library
///   (`is_global=1`, `scoped_camp_id=NULL`).
/// `scope = TechniqueScope::Scoped`  → technique is camp-only
///   (`is_global=0`, `scoped_camp_id=camp_id`).
///
/// The technique is NOT inserted into a camp_techniques list (that table no
/// longer exists). The caller is responsible for posting a camp_technique
/// THREAD so the technique appears in the camp feed.
#[instrument(skip(pool))]
pub async fn create_camp_technique_new(
    pool: &Pool<Sqlite>,
    camp_id: i64,
    name: &str,
    description: &str,
    scope: TechniqueScope,
    by_id: i64,
) -> Result<i64, AppError> {
    let technique_id = match scope {
        TechniqueScope::Global => {
            // is_global=1, scoped_camp_id stays NULL.
            let res = sqlx::query!(
                "INSERT INTO techniques (name, description, coach_id, is_global)
                 VALUES (?, ?, ?, 1)",
                name,
                description,
                by_id,
            )
            .execute(pool)
            .await?;
            res.last_insert_rowid()
        }
        TechniqueScope::Scoped => {
            // is_global=0, scoped_camp_id=camp_id.
            let res = sqlx::query!(
                "INSERT INTO techniques (name, description, coach_id, is_global, scoped_camp_id)
                 VALUES (?, ?, ?, 0, ?)",
                name,
                description,
                by_id,
                camp_id,
            )
            .execute(pool)
            .await?;
            res.last_insert_rowid()
        }
    };

    Ok(technique_id)
}
