//! Activity feed v1 for the student profile (M5).
//!
//! Returns the top-level items on the student's profile -- one row per
//! item, ordered by the timestamp of the most recent activity on that
//! item. M5 ships with two item kinds: `technique` (deduped by
//! student_technique) and `rank_change` (one-off, one row per
//! rank_audit insert). Future milestones add new kinds; M18 polishes
//! with search / filter chips / unseen divider on top of this shape.

use chrono::NaiveDateTime;
use serde::Serialize;
use sqlx::{Pool, Sqlite};
use tracing::instrument;

use crate::error::AppError;

#[derive(Debug, Serialize)]
pub struct StudentFeedResponse {
    pub items: Vec<FeedItem>,
}

#[derive(Debug, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum FeedItem {
    Technique(TechniqueFeedItem),
    RankChange(RankChangeFeedItem),
}

impl FeedItem {
    fn latest_activity_at(&self) -> NaiveDateTime {
        match self {
            FeedItem::Technique(t) => t.latest_activity_at,
            FeedItem::RankChange(r) => r.latest_activity_at,
        }
    }
}

#[derive(Debug, Serialize)]
pub struct TechniqueFeedItem {
    pub student_technique_id: i64,
    pub technique_id: i64,
    pub title: String,
    pub status: String,
    pub latest_activity_at: NaiveDateTime,
    pub latest_attempt_at: Option<NaiveDateTime>,
    pub attempt_count: i64,
    pub last_coach_update_at: Option<NaiveDateTime>,
    pub last_student_update_at: Option<NaiveDateTime>,
}

#[derive(Debug, Serialize)]
pub struct RankChangeFeedItem {
    pub rank_audit_id: i64,
    pub belt: Option<String>,
    pub stripes: Option<i64>,
    pub awarded_at: Option<NaiveDateTime>,
    pub changed_by_name: Option<String>,
    pub latest_activity_at: NaiveDateTime,
}

/// Fetch the feed for `student_id`. The caller is responsible for the
/// auth check; this function returns rows for whoever is asked about.
#[instrument(skip(pool))]
pub async fn get_student_feed(
    pool: &Pool<Sqlite>,
    student_id: i64,
) -> Result<Vec<FeedItem>, AppError> {
    let technique_rows = sqlx::query!(
        r#"
        SELECT
            st.id                       AS "id!: i64",
            st.technique_id             AS "technique_id?: i64",
            COALESCE(st.technique_name, t.name, '') AS "title!: String",
            COALESCE(st.status, 'red')  AS "status!: String",
            st.updated_at               AS "updated_at?: NaiveDateTime",
            st.last_coach_update_at     AS "last_coach_update_at?: NaiveDateTime",
            st.last_student_update_at   AS "last_student_update_at?: NaiveDateTime",
            (SELECT MAX(a.attempted_at) FROM attempts a WHERE a.student_technique_id = st.id)
                                        AS "latest_attempt_at?: NaiveDateTime",
            (SELECT COUNT(*) FROM attempts a WHERE a.student_technique_id = st.id)
                                        AS "attempt_count!: i64"
        FROM student_techniques st
        LEFT JOIN techniques t ON t.id = st.technique_id
        WHERE st.student_id = ?
        "#,
        student_id,
    )
    .fetch_all(pool)
    .await?;

    let mut items: Vec<FeedItem> = technique_rows
        .into_iter()
        .map(|row| {
            // Latest activity per technique = max of (updated_at,
            // last_*_update_at, latest_attempt_at). The Option chain
            // makes the precedence explicit instead of leaning on a
            // SQL COALESCE that would lose the "is anything set" signal.
            let candidates = [
                row.latest_attempt_at,
                row.last_coach_update_at,
                row.last_student_update_at,
                row.updated_at,
            ];
            let latest = candidates
                .iter()
                .filter_map(|opt| *opt)
                .max()
                .unwrap_or_else(|| chrono::Utc::now().naive_utc());
            FeedItem::Technique(TechniqueFeedItem {
                student_technique_id: row.id,
                technique_id: row.technique_id.unwrap_or_default(),
                title: row.title,
                status: row.status,
                latest_activity_at: latest,
                latest_attempt_at: row.latest_attempt_at,
                attempt_count: row.attempt_count,
                last_coach_update_at: row.last_coach_update_at,
                last_student_update_at: row.last_student_update_at,
            })
        })
        .collect();

    let rank_rows = sqlx::query!(
        r#"
        SELECT
            ra.id                       AS "id!: i64",
            ra.belt                     AS "belt?: String",
            ra.stripes                  AS "stripes?: i64",
            ra.last_graded_at           AS "last_graded_at?: NaiveDateTime",
            ra.changed_at               AS "changed_at!: NaiveDateTime",
            u.display_name              AS "changed_by_name?: String"
        FROM rank_audit ra
        LEFT JOIN users u ON u.id = ra.changed_by_id
        WHERE ra.user_id = ?
        "#,
        student_id,
    )
    .fetch_all(pool)
    .await?;

    items.extend(rank_rows.into_iter().map(|row| {
        FeedItem::RankChange(RankChangeFeedItem {
            rank_audit_id: row.id,
            belt: row.belt,
            stripes: row.stripes,
            awarded_at: row.last_graded_at,
            changed_by_name: row.changed_by_name,
            latest_activity_at: row.changed_at,
        })
    }));

    // Reverse-chronological. We sort in app code rather than in SQL so
    // adding new item kinds in later milestones doesn't require a
    // schema-level UNION on every read.
    items.sort_by_key(|item| std::cmp::Reverse(item.latest_activity_at()));
    Ok(items)
}
