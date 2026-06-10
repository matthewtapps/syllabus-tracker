use std::collections::HashMap;

use chrono::Utc;
use sqlx::{Pool, Sqlite};
use tracing::instrument;

use crate::db::activity::{NewActivity, Verb, emit, payload};
use crate::error::AppError;
use crate::models::WatchAggregateRow;

#[derive(Debug, Clone)]
pub struct WatchEventInput {
    pub event: String,
    pub seconds_watched: Option<i64>,
}

#[instrument(skip(pool, events))]
pub async fn ingest_watch_events(
    pool: &Pool<Sqlite>,
    video_id: i64,
    user_id: i64,
    play_id: &str,
    events: &[WatchEventInput],
) -> Result<(), AppError> {
    if events.is_empty() {
        return Ok(());
    }
    let mut tx = pool.begin().await?;

    // Compute deltas against state BEFORE inserting this batch so we don't
    // double-count the batch's own events as prior state.
    let prior_started = sqlx::query!(
        "SELECT COUNT(*) AS count
         FROM video_watch_events
         WHERE video_id = ? AND user_id = ? AND play_id = ? AND event = 'started'",
        video_id,
        user_id,
        play_id,
    )
    .fetch_one(&mut *tx)
    .await?
    .count;
    let prior_completed = sqlx::query!(
        "SELECT COUNT(*) AS count
         FROM video_watch_events
         WHERE video_id = ? AND user_id = ? AND play_id = ? AND event = 'completed'",
        video_id,
        user_id,
        play_id,
    )
    .fetch_one(&mut *tx)
    .await?
    .count;
    let prior_max_seconds = sqlx::query!(
        "SELECT COALESCE(MAX(seconds_watched), 0) AS prior_max
         FROM video_watch_events
         WHERE video_id = ? AND user_id = ? AND play_id = ?
           AND seconds_watched IS NOT NULL",
        video_id,
        user_id,
        play_id,
    )
    .fetch_one(&mut *tx)
    .await?
    .prior_max;

    let has_new_play = prior_started == 0 && events.iter().any(|e| e.event == "started");
    let has_new_completed = prior_completed == 0 && events.iter().any(|e| e.event == "completed");
    let batch_max_seconds = events
        .iter()
        .filter_map(|e| e.seconds_watched)
        .max()
        .unwrap_or(0);
    let seconds_delta = if batch_max_seconds > prior_max_seconds {
        batch_max_seconds - prior_max_seconds
    } else {
        0
    };

    let duration_seconds = sqlx::query_scalar!(
        r#"SELECT COALESCE(duration_seconds, 0) AS "d!: i64" FROM videos WHERE id = ?"#,
        video_id
    )
    .fetch_one(&mut *tx)
    .await?;
    let threshold = std::cmp::min(10, (duration_seconds as f64 * 0.2).ceil() as i64).max(1);
    let new_cumulative = prior_max_seconds.max(batch_max_seconds);
    let crossed_now = prior_max_seconds < threshold && new_cumulative >= threshold;

    // Persist raw event rows. Duplicates are allowed; the prior-state checks
    // above already deduped what matters for the aggregate.
    for input in events {
        sqlx::query!(
            "INSERT INTO video_watch_events
                (video_id, user_id, event, seconds_watched, play_id)
             VALUES (?, ?, ?, ?, ?)",
            video_id,
            user_id,
            input.event,
            input.seconds_watched,
            play_id,
        )
        .execute(&mut *tx)
        .await?;
    }

    let now = Utc::now().naive_utc();
    let play_increment: i64 = if has_new_play { 1 } else { 0 };
    let completed_increment: i64 = if has_new_completed { 1 } else { 0 };
    sqlx::query!(
        "INSERT INTO video_watch_aggregates
            (video_id, user_id, play_count, completed_count, total_seconds_watched,
             first_watched_at, last_watched_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (video_id, user_id) DO UPDATE SET
             play_count = play_count + excluded.play_count,
             completed_count = completed_count + excluded.completed_count,
             total_seconds_watched = total_seconds_watched + excluded.total_seconds_watched,
             first_watched_at = COALESCE(first_watched_at, excluded.first_watched_at),
             last_watched_at = excluded.last_watched_at",
        video_id,
        user_id,
        play_increment,
        completed_increment,
        seconds_delta,
        now,
        now,
    )
    .execute(&mut *tx)
    .await?;

    if crossed_now {
        emit(
            &mut tx,
            NewActivity::new(Verb::VideoWatched, user_id)
                .target_student(user_id)
                .video(video_id)
                .payload(payload::video_watched(new_cumulative, duration_seconds)),
        )
        .await?;
    }

    tx.commit().await?;
    Ok(())
}

#[instrument(skip(pool))]
pub async fn get_my_watch_state(
    pool: &Pool<Sqlite>,
    user_id: i64,
    video_ids: &[i64],
) -> Result<HashMap<i64, WatchAggregateRow>, AppError> {
    let mut result = HashMap::new();
    if video_ids.is_empty() {
        return Ok(result);
    }
    let placeholders = vec!["?"; video_ids.len()].join(",");
    let query = format!(
        "SELECT video_id, play_count, completed_count, total_seconds_watched
         FROM video_watch_aggregates
         WHERE user_id = ? AND video_id IN ({})",
        placeholders
    );
    let mut q = sqlx::query_as::<_, (i64, i64, i64, i64)>(&query).bind(user_id);
    for id in video_ids {
        q = q.bind(*id);
    }
    let rows = q.fetch_all(pool).await?;
    for (video_id, play_count, completed_count, total_seconds_watched) in rows {
        result.insert(
            video_id,
            WatchAggregateRow {
                play_count,
                completed_count,
                total_seconds_watched,
            },
        );
    }
    Ok(result)
}

#[instrument(skip(pool))]
pub async fn has_privacy_ack(pool: &Pool<Sqlite>, user_id: i64) -> Result<bool, AppError> {
    let row = sqlx::query!(
        "SELECT user_id FROM video_privacy_acks WHERE user_id = ?",
        user_id
    )
    .fetch_optional(pool)
    .await?;
    Ok(row.is_some())
}

#[instrument(skip(pool))]
pub async fn record_privacy_ack(pool: &Pool<Sqlite>, user_id: i64) -> Result<(), AppError> {
    sqlx::query!(
        "INSERT INTO video_privacy_acks (user_id)
         VALUES (?)
         ON CONFLICT (user_id) DO NOTHING",
        user_id
    )
    .execute(pool)
    .await?;
    Ok(())
}
