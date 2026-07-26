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

// ---------------------------------------------------------------------------
// Camp search (Phase 4)
// ---------------------------------------------------------------------------

/// A technique hit from camp search: the camp_technique thread that anchors
/// the technique + the technique's id/name.
#[derive(Debug, Clone, serde::Serialize)]
pub struct CampTechniqueHit {
    pub thread_id: i64,
    pub technique_id: i64,
    pub technique_name: String,
}

/// A video hit from camp search: a video whose title matches, plus the thread
/// that owns it (either via `attached_video_id` or as camp footage).
#[derive(Debug, Clone, serde::Serialize)]
pub struct CampVideoHit {
    pub video_id: i64,
    pub title: String,
    /// The thread whose `attached_video_id` points to this video, if any.
    pub thread_id: Option<i64>,
}

/// A thread/comment body hit from camp search.
#[derive(Debug, Clone, serde::Serialize)]
pub struct CampThreadHit {
    pub thread_id: i64,
    /// A snippet of the matching body (truncated at 200 chars).
    pub snippet: String,
    /// `true` if the match came from a comment body rather than the root post.
    pub is_comment: bool,
}

const CAMP_SEARCH_LIMIT: i64 = 25;
const SNIPPET_LEN: usize = 200;

fn truncate_snippet(s: &str) -> String {
    if s.len() <= SNIPPET_LEN {
        s.to_string()
    } else {
        let mut end = SNIPPET_LEN;
        while !s.is_char_boundary(end) {
            end -= 1;
        }
        format!("{}…", &s[..end])
    }
}

/// Search techniques in a camp by name (case-insensitive LIKE %q%).
/// Techniques come from `camp_technique` threads joined to `techniques`.
#[instrument(skip(pool))]
pub async fn search_camp_techniques(
    pool: &Pool<Sqlite>,
    camp_id: i64,
    q: &str,
) -> Result<Vec<CampTechniqueHit>, AppError> {
    let pattern = format!("%{}%", q.to_lowercase());
    let rows = sqlx::query!(
        r#"SELECT t.id AS "technique_id!: i64",
                  t.name AS technique_name,
                  th.id AS "thread_id!: i64"
           FROM threads th
           JOIN techniques t ON t.id = th.technique_id
           WHERE th.anchor_kind = 'camp_technique'
             AND th.camp_id = ?
             AND th.deleted_at IS NULL
             AND lower(t.name) LIKE ?
           ORDER BY t.name
           LIMIT ?"#,
        camp_id,
        pattern,
        CAMP_SEARCH_LIMIT,
    )
    .fetch_all(pool)
    .await?;
    Ok(rows
        .into_iter()
        .map(|r| CampTechniqueHit {
            thread_id: r.thread_id,
            technique_id: r.technique_id,
            technique_name: r.technique_name,
        })
        .collect())
}

/// Search videos in a camp by title (case-insensitive LIKE %q%).
/// Hits include:
///   - Videos attached to any of this camp's threads (`threads.attached_video_id`).
///   - Videos directly owned by this camp (`videos.parent_kind='camp' AND videos.camp_id=?`).
#[instrument(skip(pool))]
pub async fn search_camp_videos(
    pool: &Pool<Sqlite>,
    camp_id: i64,
    q: &str,
) -> Result<Vec<CampVideoHit>, AppError> {
    let pattern = format!("%{}%", q.to_lowercase());
    // Union of attached-thread videos and camp-owned footage.
    // We dedup on video_id by taking the first matching row (lowest thread_id).
    let rows = sqlx::query!(
        r#"SELECT v.id AS "video_id!: i64",
                  v.title,
                  MIN(th.id) AS "thread_id?: i64"
           FROM (
               -- Branch 1: videos attached to a camp thread
               SELECT v.id, v.title, th.id AS thread_id
               FROM threads th
               JOIN videos v ON v.id = th.attached_video_id
               WHERE th.camp_id = ? AND th.deleted_at IS NULL
                 AND v.deleted_at IS NULL
                 AND lower(v.title) LIKE ?
               UNION
               -- Branch 2: camp-owned footage (parent_kind='camp')
               SELECT v.id, v.title, NULL AS thread_id
               FROM videos v
               WHERE v.parent_kind = 'camp'
                 AND v.camp_id = ?
                 AND v.deleted_at IS NULL
                 AND lower(v.title) LIKE ?
           ) AS v
           LEFT JOIN threads th ON th.attached_video_id = v.id AND th.camp_id = ? AND th.deleted_at IS NULL
           GROUP BY v.id
           ORDER BY v.title
           LIMIT ?"#,
        camp_id,
        pattern,
        camp_id,
        pattern,
        camp_id,
        CAMP_SEARCH_LIMIT,
    )
    .fetch_all(pool)
    .await?;
    Ok(rows
        .into_iter()
        .map(|r| CampVideoHit {
            video_id: r.video_id,
            title: r.title,
            thread_id: r.thread_id,
        })
        .collect())
}

/// Search thread/comment bodies in a camp (case-insensitive LIKE %q%).
/// Returns root-post matches (`is_comment=false`) and comment matches
/// (`is_comment=true`), both scoped to this camp.
#[instrument(skip(pool))]
pub async fn search_camp_threads(
    pool: &Pool<Sqlite>,
    camp_id: i64,
    q: &str,
) -> Result<Vec<CampThreadHit>, AppError> {
    let pattern = format!("%{}%", q.to_lowercase());
    // Thread root bodies.
    let thread_rows = sqlx::query!(
        r#"SELECT id AS "id!: i64", body
           FROM threads
           WHERE camp_id = ?
             AND deleted_at IS NULL
             AND lower(body) LIKE ?
           ORDER BY id
           LIMIT ?"#,
        camp_id,
        pattern,
        CAMP_SEARCH_LIMIT,
    )
    .fetch_all(pool)
    .await?;

    // Comment bodies.
    let comment_rows = sqlx::query!(
        r#"SELECT tc.thread_id AS "thread_id!: i64", tc.body
           FROM thread_comments tc
           JOIN threads th ON th.id = tc.thread_id
           WHERE th.camp_id = ?
             AND th.deleted_at IS NULL
             AND tc.deleted_at IS NULL
             AND lower(tc.body) LIKE ?
           ORDER BY tc.thread_id, tc.id
           LIMIT ?"#,
        camp_id,
        pattern,
        CAMP_SEARCH_LIMIT,
    )
    .fetch_all(pool)
    .await?;

    let mut hits: Vec<CampThreadHit> = thread_rows
        .into_iter()
        .map(|r| CampThreadHit {
            thread_id: r.id,
            snippet: truncate_snippet(&r.body),
            is_comment: false,
        })
        .collect();

    for r in comment_rows {
        hits.push(CampThreadHit {
            thread_id: r.thread_id,
            snippet: truncate_snippet(&r.body),
            is_comment: true,
        });
    }

    hits.sort_by_key(|h| (h.thread_id, h.is_comment));
    hits.truncate(CAMP_SEARCH_LIMIT as usize);
    Ok(hits)
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
