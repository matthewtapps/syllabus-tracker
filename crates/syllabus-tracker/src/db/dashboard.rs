//! Coach dashboard reads off the activity log: the rolling "what happened
//! lately" digest. Gym-wide (coach/admin see all students); counts only
//! student-actor activity, since a coach already knows their own actions.

use chrono::{Duration, Utc};
use serde::Serialize;
use sqlx::{Pool, Sqlite};

use crate::error::AppError;

/// One digest tile: a rolling 7-day count, the previous 7-day count, the
/// signed delta, and a 7-point daily series (oldest first) for the sparkline.
#[derive(Debug, Serialize)]
pub struct DigestMetric {
    pub key: String,
    pub label: String,
    pub count: i64,
    pub prev_count: i64,
    pub delta: i64,
    /// 7-point daily series for the current window, oldest first (for
    /// sparklines). For simple-count metrics (attempts, videos, pins) the
    /// daily sum equals `count`. For `active_students` each element is the
    /// distinct headcount on that day, so the sum may exceed `count`: a
    /// student active on three days appears once in `count` but once per day
    /// in `daily`.
    pub daily: Vec<i64>,
}

#[derive(Debug, Serialize)]
pub struct ActivityDigest {
    pub window_days: i64,
    pub metrics: Vec<DigestMetric>,
}

/// A simple-count metric (attempts/videos/pins): one activity row = one unit.
struct CountSpec {
    key: &'static str,
    label: &'static str,
    verb: &'static str,
}

const COUNT_METRICS: [CountSpec; 3] = [
    CountSpec { key: "attempts_logged", label: "Attempts logged", verb: "attempt_logged" },
    CountSpec { key: "videos_watched", label: "Videos watched", verb: "video_watched" },
    CountSpec { key: "techniques_pinned", label: "Techniques pinned", verb: "technique_pinned" },
];

pub async fn activity_digest(pool: &Pool<Sqlite>) -> Result<ActivityDigest, AppError> {
    // The 14 day-keys we care about, oldest first. day_keys[7..14] is the
    // current window; day_keys[0..7] is the previous window. date() in SQLite
    // yields 'YYYY-MM-DD', which we match against these.
    let today = Utc::now().date_naive();
    let day_keys: Vec<String> = (0..14)
        .rev()
        .map(|back| (today - Duration::days(back)).format("%Y-%m-%d").to_string())
        .collect();

    let count_rows = sqlx::query!(
        r#"SELECT a.verb              AS "verb!: String",
                  date(a.occurred_at) AS "day!: String",
                  COUNT(*)            AS "n!: i64"
           FROM activity a
           JOIN users u ON u.id = a.actor_user_id
           WHERE u.role = 'student'
             AND a.occurred_at >= datetime('now', '-13 days', 'start of day')
             AND a.verb IN ('attempt_logged', 'video_watched', 'technique_pinned')
           GROUP BY a.verb, date(a.occurred_at)"#,
    )
    .fetch_all(pool)
    .await?;

    let active_rows = sqlx::query!(
        r#"SELECT date(a.occurred_at)             AS "day!: String",
                  COUNT(DISTINCT a.actor_user_id) AS "n!: i64"
           FROM activity a
           JOIN users u ON u.id = a.actor_user_id
           WHERE u.role = 'student'
             AND a.occurred_at >= datetime('now', '-13 days', 'start of day')
           GROUP BY date(a.occurred_at)"#,
    )
    .fetch_all(pool)
    .await?;

    let active_windows = sqlx::query!(
        r#"SELECT
             COUNT(DISTINCT CASE WHEN a.occurred_at >= datetime('now', '-6 days', 'start of day')
                                 THEN a.actor_user_id END) AS "cur!: i64",
             COUNT(DISTINCT CASE WHEN a.occurred_at <  datetime('now', '-6 days', 'start of day')
                                 THEN a.actor_user_id END) AS "prev!: i64"
           FROM activity a
           JOIN users u ON u.id = a.actor_user_id
           WHERE u.role = 'student'
             AND a.occurred_at >= datetime('now', '-13 days', 'start of day')"#,
    )
    .fetch_one(pool)
    .await?;

    let mut metrics = Vec::with_capacity(4);

    for spec in &COUNT_METRICS {
        let mut daily14 = vec![0i64; 14];
        for r in count_rows.iter().filter(|r| r.verb == spec.verb) {
            if let Some(idx) = day_keys.iter().position(|d| *d == r.day) {
                daily14[idx] = r.n;
            }
        }
        let prev_count: i64 = daily14[0..7].iter().sum();
        let count: i64 = daily14[7..14].iter().sum();
        metrics.push(DigestMetric {
            key: spec.key.to_string(),
            label: spec.label.to_string(),
            count,
            prev_count,
            delta: count - prev_count,
            daily: daily14[7..14].to_vec(),
        });
    }

    let mut active_daily14 = vec![0i64; 14];
    for r in &active_rows {
        if let Some(idx) = day_keys.iter().position(|d| *d == r.day) {
            active_daily14[idx] = r.n;
        }
    }
    metrics.push(DigestMetric {
        key: "active_students".to_string(),
        label: "Active students".to_string(),
        count: active_windows.cur,
        prev_count: active_windows.prev,
        delta: active_windows.cur - active_windows.prev,
        daily: active_daily14[7..14].to_vec(),
    });

    Ok(ActivityDigest { window_days: 7, metrics })
}
