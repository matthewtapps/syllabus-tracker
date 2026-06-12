//! Cross-domain read-only queries. Anything that joins across multiple
//! domains (users + student_techniques + video watch aggregates, video
//! aggregates + storage stats, etc.) lives here so the per-domain modules
//! stay focused on their own table.
//!
//! Rules of thumb for this file:
//! - Read-only. No writes; if a query inserts or updates, it belongs in a
//!   per-domain module.
//! - Cross-domain joins. If a query touches only one domain, push it back
//!   into that domain's file.

use std::str::FromStr;

use chrono::{DateTime, NaiveDateTime, Utc};
use sqlx::{Pool, Sqlite};
use tracing::instrument;

use crate::auth::{Role, User};
use crate::error::AppError;
use crate::models::{
    DashboardVideoOverview, DashboardVideoRow, StorageObjectRow, StorageOverview,
    StudentWatchActivityRow, VideoStatsSnapshot, naive_to_utc,
};

#[derive(sqlx::FromRow)]
struct UserWithActivityDto {
    pub id: Option<i64>,
    pub username: Option<String>,
    pub role: Option<String>,
    pub display_name: Option<String>,
    pub archived: Option<bool>,
    pub graduated_at: Option<NaiveDateTime>,
    pub email: Option<String>,
    pub claimed_at: Option<NaiveDateTime>,
    pub approved_at: Option<NaiveDateTime>,
    pub first_name: Option<String>,
    pub last_name: Option<String>,
    pub reset_requested_at: Option<NaiveDateTime>,
    pub last_update: Option<NaiveDateTime>,
    pub last_coach_update_at: Option<NaiveDateTime>,
    pub total_techniques: Option<i64>,
    pub red_count: Option<i64>,
    pub amber_count: Option<i64>,
    pub green_count: Option<i64>,
    pub has_unseen_activity: Option<i64>,
    pub latest_student_note_at: Option<NaiveDateTime>,
    pub latest_watch_at: Option<NaiveDateTime>,
    pub latest_watch_video_title: Option<String>,
    pub last_student_activity_at: Option<NaiveDateTime>,
    pub last_coach_activity_at: Option<NaiveDateTime>,
    pub pinned_count: Option<i64>,
    pub recent_activity_count: Option<i64>,
}

#[instrument(skip(pool))]
pub async fn get_students_by_recent_updates(
    pool: &Pool<Sqlite>,
    include_archived: bool,
    // viewer_id retained for signature stability; the unseen rule no longer uses per-coach view state.
    _viewer_id: i64,
) -> Result<Vec<User>, AppError> {
    let dtos = sqlx::query_as!(
        UserWithActivityDto,
        r#"
        SELECT
            u.id, u.username, u.display_name, u.role, u.archived,
            u.graduated_at as "graduated_at?: NaiveDateTime",
            u.email,
            u.claimed_at as "claimed_at?: NaiveDateTime",
            u.approved_at as "approved_at?: NaiveDateTime",
            u.first_name, u.last_name,
            u.reset_requested_at as "reset_requested_at?: NaiveDateTime",
            MAX(sst.updated_at) as "last_update?: NaiveDateTime",
            MAX(sst.last_coach_update_at) as "last_coach_update_at?: NaiveDateTime",
            COUNT(sst.id) as "total_techniques?: i64",
            COALESCE(SUM(CASE WHEN sst.status = 'red'   THEN 1 ELSE 0 END), 0) as "red_count?: i64",
            COALESCE(SUM(CASE WHEN sst.status = 'amber' THEN 1 ELSE 0 END), 0) as "amber_count?: i64",
            COALESCE(SUM(CASE WHEN sst.status = 'green' THEN 1 ELSE 0 END), 0) as "green_count?: i64",
            -- Simple unseen heuristic, no per-coach memory: the student has
            -- student-side activity strictly newer than any coach-side activity.
            -- datetime(...) wrapping normalises mixed timestamp text formats.
            CASE
                WHEN MAX(sst.last_student_update_at) IS NULL THEN 0
                WHEN MAX(sst.last_coach_update_at) IS NULL THEN 1
                WHEN datetime(MAX(sst.last_student_update_at)) > datetime(MAX(sst.last_coach_update_at)) THEN 1
                ELSE 0
            END as "has_unseen_activity?: i64",
            MAX(sst.last_student_update_at) as "latest_student_note_at?: NaiveDateTime",
            (SELECT MAX(last_watched_at)
               FROM video_watch_aggregates
              WHERE user_id = u.id) as "latest_watch_at?: NaiveDateTime",
            (SELECT v.title
               FROM video_watch_aggregates a
               JOIN videos v ON v.id = a.video_id
              WHERE a.user_id = u.id AND v.deleted_at IS NULL
              ORDER BY a.last_watched_at DESC
              LIMIT 1) as "latest_watch_video_title?: String",
            (SELECT MAX(a.occurred_at)
               FROM activity a
              WHERE a.target_student_id = u.id
                AND a.actor_user_id = u.id) as "last_student_activity_at?: NaiveDateTime",
            (SELECT MAX(a.occurred_at)
               FROM activity a
               JOIN users au ON au.id = a.actor_user_id
              WHERE a.target_student_id = u.id
                AND a.actor_user_id <> u.id
                AND au.role IN ('coach', 'admin')) as "last_coach_activity_at?: NaiveDateTime",
            (SELECT COUNT(*)
               FROM student_pinned_techniques spt
              WHERE spt.student_id = u.id) as "pinned_count?: i64",
            -- Student's own activity in the last 7 days. Mirrors the coach
            -- dashboard's student-actor window (datetime('now','-6 days',...)).
            (SELECT COUNT(*)
               FROM activity a
              WHERE a.target_student_id = u.id
                AND a.actor_user_id = u.id
                AND a.occurred_at >= datetime('now', '-6 days', 'start of day')) as "recent_activity_count?: i64"
        FROM users u
        LEFT JOIN syllabus_assignments sa
               ON sa.student_id = u.id AND sa.unassigned_at IS NULL
        LEFT JOIN student_syllabus_techniques sst
               ON sst.assignment_id = sa.id AND sst.hidden_at IS NULL
        WHERE u.role = 'student'
        GROUP BY u.id
        ORDER BY MAX(sst.updated_at) DESC NULLS LAST
        "#,
    )
    .fetch_all(pool)
    .await?;

    let users: Vec<User> = dtos
        .into_iter()
        .map(|dto| {
            // Most-recent timestamp across student-driven signals: their own
            // note edits and any video they watched. Frontend uses this to
            // surface "taking initiative" independently of the per-coach
            // unseen flag.
            let initiative = match (dto.latest_student_note_at, dto.latest_watch_at) {
                (Some(a), Some(b)) => Some(a.max(b)),
                (Some(a), None) => Some(a),
                (None, Some(b)) => Some(b),
                (None, None) => None,
            };
            User {
                id: dto.id.unwrap_or_default(),
                username: dto.username.unwrap_or_default(),
                role: Role::from_str(&dto.role.unwrap_or_default()).unwrap(),
                display_name: dto.display_name.unwrap_or_default(),
                archived: dto.archived.unwrap_or_default(),
                graduated_at: dto.graduated_at.map(|dt| naive_to_utc(dt).to_rfc3339()),
                email: dto.email,
                claimed_at: dto.claimed_at.map(|dt| naive_to_utc(dt).to_rfc3339()),
                approved_at: dto.approved_at.map(|dt| naive_to_utc(dt).to_rfc3339()),
                first_name: dto.first_name,
                last_name: dto.last_name,
                reset_requested_at: dto
                    .reset_requested_at
                    .map(|dt| naive_to_utc(dt).to_rfc3339()),
                last_update: dto.last_update.map(|dt| naive_to_utc(dt).to_rfc3339()),
                last_coach_update_at: dto
                    .last_coach_update_at
                    .map(|dt| naive_to_utc(dt).to_rfc3339()),
                total_techniques: dto.total_techniques,
                red_count: dto.red_count,
                amber_count: dto.amber_count,
                green_count: dto.green_count,
                has_unseen_activity: dto.has_unseen_activity.map(|v| v != 0),
                last_student_initiative_at: initiative.map(|dt| naive_to_utc(dt).to_rfc3339()),
                last_watch_at: dto.latest_watch_at.map(|dt| naive_to_utc(dt).to_rfc3339()),
                last_watch_video_title: dto.latest_watch_video_title,
                last_student_activity_at: dto
                    .last_student_activity_at
                    .map(|dt| naive_to_utc(dt).to_rfc3339()),
                last_coach_activity_at: dto
                    .last_coach_activity_at
                    .map(|dt| naive_to_utc(dt).to_rfc3339()),
                pinned_count: dto.pinned_count,
                recent_activity_count: dto.recent_activity_count,
            }
        })
        .collect();

    if include_archived {
        Ok(users)
    } else {
        Ok(users.into_iter().filter(|user| !user.archived).collect())
    }
}

#[instrument(skip(pool))]
pub async fn get_video_stats(
    pool: &Pool<Sqlite>,
    video_id: i64,
) -> Result<VideoStatsSnapshot, AppError> {
    let row = sqlx::query!(
        "SELECT
            COUNT(*) AS viewer_count,
            COALESCE(SUM(play_count), 0) AS total_plays,
            COALESCE(SUM(completed_count), 0) AS completed_plays,
            COALESCE(SUM(total_seconds_watched), 0) AS total_seconds_watched
         FROM video_watch_aggregates
         WHERE video_id = ?",
        video_id
    )
    .fetch_one(pool)
    .await?;
    let completion_rate = if row.total_plays > 0 {
        row.completed_plays as f64 / row.total_plays as f64
    } else {
        0.0
    };
    Ok(VideoStatsSnapshot {
        video_id,
        unique_viewers: row.viewer_count,
        total_plays: row.total_plays,
        completed_plays: row.completed_plays,
        total_seconds_watched: row.total_seconds_watched,
        completion_rate,
    })
}

#[instrument(skip(pool))]
pub async fn get_student_watch_activity(
    pool: &Pool<Sqlite>,
    student_id: i64,
    since: DateTime<Utc>,
) -> Result<Vec<StudentWatchActivityRow>, AppError> {
    let rows = sqlx::query!(
        r#"SELECT v.id AS "video_id!: i64",
                  v.title AS "video_title!: String",
                  v.technique_id AS "technique_id!: i64",
                  t.name AS "technique_name!: String",
                  a.play_count AS "play_count!: i64",
                  a.completed_count AS "completed_count!: i64",
                  a.total_seconds_watched AS "total_seconds_watched!: i64",
                  a.last_watched_at AS "last_watched_at: NaiveDateTime"
           FROM video_watch_aggregates a
           JOIN videos v ON v.id = a.video_id
           JOIN techniques t ON t.id = v.technique_id
           WHERE a.user_id = ? AND a.last_watched_at >= ? AND v.deleted_at IS NULL
           ORDER BY a.last_watched_at DESC
           LIMIT 50"#,
        student_id,
        since,
    )
    .fetch_all(pool)
    .await?;
    Ok(rows
        .into_iter()
        .map(|r| StudentWatchActivityRow {
            video_id: r.video_id,
            video_title: r.video_title,
            technique_id: r.technique_id,
            technique_name: r.technique_name,
            play_count: r.play_count,
            completed_count: r.completed_count,
            total_seconds_watched: r.total_seconds_watched,
            last_watched_at: r.last_watched_at.map(naive_to_utc),
        })
        .collect())
}

#[instrument(skip(pool))]
pub async fn get_dashboard_video_overview(
    pool: &Pool<Sqlite>,
    since: DateTime<Utc>,
) -> Result<DashboardVideoOverview, AppError> {
    let totals_row = sqlx::query!(
        "SELECT COALESCE(SUM(seconds_watched), 0) AS seconds
         FROM video_watch_events
         WHERE event != 'opened' AND seconds_watched IS NOT NULL AND created_at >= ?",
        since
    )
    .fetch_one(pool)
    .await?;
    let processing_row = sqlx::query!(
        "SELECT COUNT(*) AS count FROM videos
         WHERE processing_status = 'processing' AND deleted_at IS NULL"
    )
    .fetch_one(pool)
    .await?;
    let top_rows = sqlx::query!(
        r#"SELECT v.id AS "video_id!: i64",
                  v.title AS "video_title!: String",
                  v.technique_id AS "technique_id!: i64",
                  t.name AS "technique_name!: String",
                  COUNT(*) AS "plays_this_window!: i64",
                  COUNT(DISTINCT e.user_id) AS "unique_viewers!: i64"
           FROM video_watch_events e
           JOIN videos v ON v.id = e.video_id
           JOIN techniques t ON t.id = v.technique_id
           WHERE e.event = 'started' AND e.created_at >= ? AND v.deleted_at IS NULL
           GROUP BY v.id
           ORDER BY COUNT(*) DESC, v.id DESC
           LIMIT 5"#,
        since,
    )
    .fetch_all(pool)
    .await?;
    Ok(DashboardVideoOverview {
        total_seconds_watched: totals_row.seconds,
        videos_processing: processing_row.count,
        top_videos: top_rows
            .into_iter()
            .map(|r| DashboardVideoRow {
                video_id: r.video_id,
                video_title: r.video_title,
                technique_id: r.technique_id,
                technique_name: r.technique_name,
                plays_this_window: r.plays_this_window,
                unique_viewers: r.unique_viewers,
            })
            .collect(),
    })
}

#[instrument(skip(pool))]
pub async fn get_storage_overview(
    pool: &Pool<Sqlite>,
    top: i64,
) -> Result<StorageOverview, AppError> {
    let total_bytes = super::total_video_storage_bytes(pool).await?;
    let total_objects = super::total_video_objects(pool).await?;
    let top_rows = sqlx::query!(
        r#"SELECT v.id AS "video_id!: i64",
                  v.title AS "title!: String",
                  v.technique_id AS "technique_id!: i64",
                  t.name AS "technique_name!: String",
                  v.bytes AS "bytes!: i64"
           FROM videos v
           JOIN techniques t ON t.id = v.technique_id
           WHERE v.bytes IS NOT NULL AND v.storage_key IS NOT NULL
           ORDER BY v.bytes DESC
           LIMIT ?"#,
        top,
    )
    .fetch_all(pool)
    .await?;
    Ok(StorageOverview {
        total_bytes,
        total_objects,
        top_objects: top_rows
            .into_iter()
            .map(|r| StorageObjectRow {
                video_id: r.video_id,
                title: r.title,
                technique_id: r.technique_id,
                technique_name: r.technique_name,
                bytes: r.bytes,
            })
            .collect(),
    })
}
