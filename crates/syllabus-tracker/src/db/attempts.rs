use chrono::{NaiveDateTime, Utc};
use sqlx::{Pool, Sqlite};
use tracing::{info, instrument};

use crate::auth::{Role, User};
use crate::error::AppError;
use crate::models::{
    Attempt, AttemptBucket, AttemptCreateResult, AttemptListItem, AttemptSuggestion,
    AttemptSummary, naive_to_utc,
};

#[allow(clippy::too_many_arguments)]
fn hydrate_attempt_row(
    id: i64,
    student_technique_id: i64,
    recorded_by_id: i64,
    recorded_by_name: Option<String>,
    attempted_at: NaiveDateTime,
    coach_note: Option<String>,
    coach_note_by_id: Option<i64>,
    coach_note_by_name: Option<String>,
    coach_note_at: Option<NaiveDateTime>,
    student_note: Option<String>,
    student_note_at: Option<NaiveDateTime>,
    created_at: NaiveDateTime,
) -> Attempt {
    Attempt {
        id,
        student_technique_id,
        recorded_by_id,
        recorded_by_name,
        attempted_at: naive_to_utc(attempted_at),
        coach_note,
        coach_note_by_id,
        coach_note_by_name,
        coach_note_at: coach_note_at.map(naive_to_utc),
        student_note,
        student_note_at: student_note_at.map(naive_to_utc),
        created_at: naive_to_utc(created_at),
    }
}

fn prefer_display_name(display: Option<String>, username: Option<String>) -> Option<String> {
    display.filter(|s| !s.is_empty()).or(username)
}

/// Bump the parent student_technique's activity timestamps to "now" using
/// the actor's role to pick the right slot. Mirrors how note edits via
/// `update_student_technique` track activity.
async fn bump_student_technique_activity(
    tx: &mut sqlx::Transaction<'_, Sqlite>,
    student_technique_id: i64,
    actor: &User,
) -> Result<(), AppError> {
    let now = Utc::now().naive_utc();
    let actor_id = actor.id;
    match actor.role {
        Role::Coach | Role::Admin => {
            sqlx::query!(
                "UPDATE student_techniques
                 SET updated_at = ?,
                     last_coach_update_at = ?,
                     last_coach_update_by_id = ?
                 WHERE id = ?",
                now,
                now,
                actor_id,
                student_technique_id,
            )
            .execute(&mut **tx)
            .await?;
        }
        Role::Student | Role::FootageSubmitterStudent => {
            sqlx::query!(
                "UPDATE student_techniques
                 SET updated_at = ?,
                     last_student_update_at = ?,
                     last_student_update_by_id = ?
                 WHERE id = ?",
                now,
                now,
                actor_id,
                student_technique_id,
            )
            .execute(&mut **tx)
            .await?;
        }
    }
    Ok(())
}

/// Authorise an actor to read/append attempts for a given student technique.
/// Coach/admin can act on anyone; a student can only act on their own.
async fn ensure_can_access_student_technique(
    pool: &Pool<Sqlite>,
    actor: &User,
    student_technique_id: i64,
) -> Result<i64, AppError> {
    let row = sqlx::query!(
        "SELECT student_id FROM student_techniques WHERE id = ?",
        student_technique_id
    )
    .fetch_optional(pool)
    .await?;

    let student_id = row
        .and_then(|r| r.student_id)
        .ok_or_else(|| AppError::NotFound(format!("student_technique {}", student_technique_id)))?;

    match actor.role {
        Role::Coach | Role::Admin => Ok(student_id),
        Role::Student | Role::FootageSubmitterStudent => {
            if actor.id == student_id {
                Ok(student_id)
            } else {
                Err(AppError::Authorization(
                    "Cannot access this student technique".into(),
                ))
            }
        }
    }
}

#[instrument(skip(actor))]
pub async fn create_attempt(
    pool: &Pool<Sqlite>,
    actor: &User,
    student_technique_id: i64,
    attempted_at: chrono::DateTime<Utc>,
    note: Option<&str>,
) -> Result<AttemptCreateResult, AppError> {
    info!("Creating attempt");

    ensure_can_access_student_technique(pool, actor, student_technique_id).await?;

    let mut tx = pool.begin().await?;

    // Read current status + existing attempt count for the suggestion.
    let pre = sqlx::query!(
        r#"SELECT st.status, COUNT(a.id) as "attempt_count!: i64"
           FROM student_techniques st
           LEFT JOIN attempts a ON a.student_technique_id = st.id
           WHERE st.id = ?
           GROUP BY st.id"#,
        student_technique_id
    )
    .fetch_optional(&mut *tx)
    .await?;

    let (status, prior_count) = match pre {
        Some(row) => (row.status.unwrap_or_default(), row.attempt_count),
        None => {
            return Err(AppError::NotFound(format!(
                "student_technique {}",
                student_technique_id
            )));
        }
    };

    let actor_id = actor.id;
    let attempted_naive = attempted_at.naive_utc();
    let note_owned = note.map(|n| n.to_string());

    let (coach_note, coach_note_by, coach_note_at, student_note, student_note_at) =
        match actor.role {
            Role::Coach | Role::Admin => (
                note_owned.clone(),
                note_owned.as_ref().map(|_| actor_id),
                note_owned.as_ref().map(|_| attempted_naive),
                None,
                None,
            ),
            Role::Student | Role::FootageSubmitterStudent => (
                None,
                None,
                None,
                note_owned.clone(),
                note_owned.as_ref().map(|_| attempted_naive),
            ),
        };

    let res = sqlx::query!(
        "INSERT INTO attempts (
            student_technique_id, recorded_by_id, attempted_at,
            coach_note, coach_note_by_id, coach_note_at,
            student_note, student_note_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        student_technique_id,
        actor_id,
        attempted_naive,
        coach_note,
        coach_note_by,
        coach_note_at,
        student_note,
        student_note_at,
    )
    .execute(&mut *tx)
    .await?;

    let id = res.last_insert_rowid();

    // Bump the parent student_technique's activity timestamps so this attempt
    // surfaces in the "recently updated" dashboard sections. The bump reflects
    // when the attempt was logged (now), not the (possibly backdated)
    // attempted_at value.
    bump_student_technique_activity(&mut tx, student_technique_id, actor).await?;

    tx.commit().await?;

    let attempt = get_attempt(pool, id).await?;

    let suggestion = if prior_count == 0 && status == "red" {
        AttemptSuggestion::Amber
    } else {
        AttemptSuggestion::None
    };

    Ok(AttemptCreateResult {
        attempt,
        suggestion,
    })
}

#[instrument]
pub async fn get_attempt(pool: &Pool<Sqlite>, attempt_id: i64) -> Result<Attempt, AppError> {
    let row = sqlx::query!(
        r#"SELECT a.id as "id!: i64", a.student_technique_id as "student_technique_id!: i64",
                  a.recorded_by_id as "recorded_by_id!: i64",
                  rec.display_name as "rec_display?: String", rec.username as "rec_username?: String",
                  a.attempted_at as "attempted_at!: NaiveDateTime",
                  a.coach_note, a.coach_note_by_id,
                  cnb.display_name as "cn_display?: String", cnb.username as "cn_username?: String",
                  a.coach_note_at as "coach_note_at?: NaiveDateTime",
                  a.student_note, a.student_note_at as "student_note_at?: NaiveDateTime",
                  a.created_at as "created_at!: NaiveDateTime"
           FROM attempts a
           LEFT JOIN users rec ON rec.id = a.recorded_by_id
           LEFT JOIN users cnb ON cnb.id = a.coach_note_by_id
           WHERE a.id = ?"#,
        attempt_id
    )
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("attempt {}", attempt_id)))?;

    Ok(hydrate_attempt_row(
        row.id,
        row.student_technique_id,
        row.recorded_by_id,
        prefer_display_name(row.rec_display, row.rec_username),
        row.attempted_at,
        row.coach_note,
        row.coach_note_by_id,
        prefer_display_name(row.cn_display, row.cn_username),
        row.coach_note_at,
        row.student_note,
        row.student_note_at,
        row.created_at,
    ))
}

#[instrument]
pub async fn list_attempts(
    pool: &Pool<Sqlite>,
    student_technique_id: i64,
) -> Result<Vec<Attempt>, AppError> {
    let rows = sqlx::query!(
        r#"SELECT a.id as "id!: i64", a.student_technique_id as "student_technique_id!: i64",
                  a.recorded_by_id as "recorded_by_id!: i64",
                  rec.display_name as "rec_display?: String", rec.username as "rec_username?: String",
                  a.attempted_at as "attempted_at!: NaiveDateTime",
                  a.coach_note, a.coach_note_by_id,
                  cnb.display_name as "cn_display?: String", cnb.username as "cn_username?: String",
                  a.coach_note_at as "coach_note_at?: NaiveDateTime",
                  a.student_note, a.student_note_at as "student_note_at?: NaiveDateTime",
                  a.created_at as "created_at!: NaiveDateTime"
           FROM attempts a
           LEFT JOIN users rec ON rec.id = a.recorded_by_id
           LEFT JOIN users cnb ON cnb.id = a.coach_note_by_id
           WHERE a.student_technique_id = ?
           ORDER BY a.attempted_at DESC, a.id DESC"#,
        student_technique_id,
    )
    .fetch_all(pool)
    .await?;

    Ok(rows
        .into_iter()
        .map(|row| {
            hydrate_attempt_row(
                row.id,
                row.student_technique_id,
                row.recorded_by_id,
                prefer_display_name(row.rec_display, row.rec_username),
                row.attempted_at,
                row.coach_note,
                row.coach_note_by_id,
                prefer_display_name(row.cn_display, row.cn_username),
                row.coach_note_at,
                row.student_note,
                row.student_note_at,
                row.created_at,
            )
        })
        .collect())
}

#[instrument]
pub async fn list_recent_attempts_for_student(
    pool: &Pool<Sqlite>,
    student_id: i64,
    limit: i64,
) -> Result<Vec<AttemptListItem>, AppError> {
    let rows = sqlx::query!(
        r#"SELECT a.id as "id!: i64",
                  a.student_technique_id as "student_technique_id!: i64",
                  st.technique_id as "technique_id!: i64",
                  st.technique_name as "technique_name: String",
                  a.attempted_at as "attempted_at!: NaiveDateTime",
                  a.coach_note, a.student_note
           FROM attempts a
           JOIN student_techniques st ON st.id = a.student_technique_id
           WHERE st.student_id = ?
           ORDER BY a.attempted_at DESC, a.id DESC
           LIMIT ?"#,
        student_id,
        limit,
    )
    .fetch_all(pool)
    .await?;

    Ok(rows
        .into_iter()
        .map(|row| AttemptListItem {
            id: row.id,
            student_technique_id: row.student_technique_id,
            technique_id: row.technique_id,
            technique_name: row.technique_name.unwrap_or_default(),
            attempted_at: naive_to_utc(row.attempted_at),
            coach_note: row.coach_note,
            student_note: row.student_note,
        })
        .collect())
}

#[instrument(skip(actor))]
pub async fn delete_attempt(
    pool: &Pool<Sqlite>,
    actor: &User,
    attempt_id: i64,
) -> Result<(), AppError> {
    let row = sqlx::query!(
        "SELECT recorded_by_id, student_technique_id FROM attempts WHERE id = ?",
        attempt_id
    )
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("attempt {}", attempt_id)))?;

    // Coach/admin can delete any attempt on a student technique they can access.
    // Student can only delete attempts they recorded themselves.
    match actor.role {
        Role::Coach | Role::Admin => {
            ensure_can_access_student_technique(pool, actor, row.student_technique_id).await?;
        }
        Role::Student | Role::FootageSubmitterStudent => {
            ensure_can_access_student_technique(pool, actor, row.student_technique_id).await?;
            if row.recorded_by_id != actor.id {
                return Err(AppError::Authorization(
                    "Students can only remove their own attempts".into(),
                ));
            }
        }
    }

    sqlx::query!("DELETE FROM attempts WHERE id = ?", attempt_id)
        .execute(pool)
        .await?;

    Ok(())
}

#[instrument(skip(actor))]
pub async fn update_attempt_note(
    pool: &Pool<Sqlite>,
    actor: &User,
    attempt_id: i64,
    note: Option<&str>,
) -> Result<(), AppError> {
    let row = sqlx::query!(
        "SELECT student_technique_id FROM attempts WHERE id = ?",
        attempt_id
    )
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("attempt {}", attempt_id)))?;

    ensure_can_access_student_technique(pool, actor, row.student_technique_id).await?;

    let now = Utc::now().naive_utc();
    let actor_id = actor.id;
    // Empty string clears the note.
    let normalised: Option<String> = note
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());

    let mut tx = pool.begin().await?;
    match actor.role {
        Role::Coach | Role::Admin => {
            let stamp = normalised.as_ref().map(|_| now);
            let by_id = normalised.as_ref().map(|_| actor_id);
            sqlx::query!(
                "UPDATE attempts
                 SET coach_note = ?, coach_note_by_id = ?, coach_note_at = ?
                 WHERE id = ?",
                normalised,
                by_id,
                stamp,
                attempt_id
            )
            .execute(&mut *tx)
            .await?;
        }
        Role::Student | Role::FootageSubmitterStudent => {
            let stamp = normalised.as_ref().map(|_| now);
            sqlx::query!(
                "UPDATE attempts
                 SET student_note = ?, student_note_at = ?
                 WHERE id = ?",
                normalised,
                stamp,
                attempt_id
            )
            .execute(&mut *tx)
            .await?;
        }
    }

    // Editing or adding a note is meaningful activity on the technique, so
    // surface it in the dashboard's "recently updated" view too.
    bump_student_technique_activity(&mut tx, row.student_technique_id, actor).await?;
    tx.commit().await?;

    Ok(())
}

#[instrument(skip(actor))]
pub async fn update_attempt_timestamp(
    pool: &Pool<Sqlite>,
    actor: &User,
    attempt_id: i64,
    attempted_at: chrono::DateTime<Utc>,
) -> Result<(), AppError> {
    let row = sqlx::query!(
        "SELECT recorded_by_id, student_technique_id FROM attempts WHERE id = ?",
        attempt_id
    )
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("attempt {}", attempt_id)))?;

    match actor.role {
        Role::Coach | Role::Admin => {
            ensure_can_access_student_technique(pool, actor, row.student_technique_id).await?;
        }
        Role::Student | Role::FootageSubmitterStudent => {
            ensure_can_access_student_technique(pool, actor, row.student_technique_id).await?;
            if row.recorded_by_id != actor.id {
                return Err(AppError::Authorization(
                    "Students can only edit their own attempts".into(),
                ));
            }
        }
    }

    let stamp = attempted_at.naive_utc();
    sqlx::query!(
        "UPDATE attempts SET attempted_at = ? WHERE id = ?",
        stamp,
        attempt_id
    )
    .execute(pool)
    .await?;

    Ok(())
}

#[instrument]
pub async fn attempt_summary_for_student(
    pool: &Pool<Sqlite>,
    student_id: i64,
) -> Result<AttemptSummary, AppError> {
    // Use SQLite's date arithmetic so "this week" / "this month" line up with
    // the server clock without juggling timezones in Rust.
    let row = sqlx::query!(
        r#"SELECT
            COUNT(*) as "total!: i64",
            SUM(CASE WHEN a.attempted_at >= datetime('now', '-7 days') THEN 1 ELSE 0 END) as "this_week!: i64",
            SUM(CASE WHEN a.attempted_at >= datetime('now', '-30 days') THEN 1 ELSE 0 END) as "this_month!: i64"
           FROM attempts a
           JOIN student_techniques st ON st.id = a.student_technique_id
           WHERE st.student_id = ?"#,
        student_id
    )
    .fetch_one(pool)
    .await?;

    Ok(AttemptSummary {
        this_week: row.this_week,
        this_month: row.this_month,
        total: row.total,
    })
}

#[instrument]
pub async fn attempt_buckets_for_student(
    pool: &Pool<Sqlite>,
    student_id: i64,
    from: chrono::NaiveDate,
    to: chrono::NaiveDate,
) -> Result<Vec<AttemptBucket>, AppError> {
    let from_str = from.format("%Y-%m-%d").to_string();
    let to_str = to.format("%Y-%m-%d").to_string();
    let rows = sqlx::query!(
        r#"SELECT date(a.attempted_at) as "date!: String",
                  COUNT(*) as "count!: i64"
           FROM attempts a
           JOIN student_techniques st ON st.id = a.student_technique_id
           WHERE st.student_id = ?
             AND date(a.attempted_at) >= ?
             AND date(a.attempted_at) <= ?
           GROUP BY date(a.attempted_at)
           ORDER BY 1"#,
        student_id,
        from_str,
        to_str,
    )
    .fetch_all(pool)
    .await?;

    Ok(rows
        .into_iter()
        .filter_map(|r| {
            chrono::NaiveDate::parse_from_str(&r.date, "%Y-%m-%d")
                .ok()
                .map(|date| AttemptBucket {
                    date,
                    count: r.count,
                })
        })
        .collect())
}

#[instrument]
pub async fn attempt_weekly_buckets_for_technique(
    pool: &Pool<Sqlite>,
    student_technique_id: i64,
    weeks: i64,
) -> Result<Vec<AttemptBucket>, AppError> {
    // Bucket by ISO week (year-week). We resolve buckets to the Monday of each
    // week so the frontend can lay them out on a timeline.
    let start_clause = format!("-{} days", weeks * 7);
    let rows = sqlx::query!(
        r#"SELECT date(a.attempted_at, 'weekday 0', '-6 days') as "week_start!: String",
                  COUNT(*) as "count!: i64"
           FROM attempts a
           WHERE a.student_technique_id = ?
             AND a.attempted_at >= datetime('now', ?)
           GROUP BY date(a.attempted_at, 'weekday 0', '-6 days')
           ORDER BY 1"#,
        student_technique_id,
        start_clause,
    )
    .fetch_all(pool)
    .await?;

    Ok(rows
        .into_iter()
        .filter_map(|r| {
            chrono::NaiveDate::parse_from_str(&r.week_start, "%Y-%m-%d")
                .ok()
                .map(|date| AttemptBucket {
                    date,
                    count: r.count,
                })
        })
        .collect())
}
