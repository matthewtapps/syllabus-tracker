//! Technique-suggestion queue. Students suggest techniques (optionally anchored
//! to a video timestamp) for a coach to review. Coaches approve (adding the
//! technique to a named camp), replace (adding a different technique), or
//! dismiss. Every write emits an activity row so the feed and unread badge
//! reflect the decision.

use chrono::NaiveDateTime;
use serde::Serialize;
use sqlx::{Pool, Sqlite};
use tracing::instrument;

use crate::db::activity::{emit, payload, NewActivity, Verb};
use crate::db::camps::add_camp_technique;
use crate::error::AppError;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/// A raw suggestion row, mirroring the `technique_suggestions` table.
#[derive(Debug, Clone, Serialize)]
pub struct TechniqueSuggestion {
    pub id: i64,
    pub student_id: i64,
    pub technique_id: i64,
    pub anchor_video_id: Option<i64>,
    pub anchor_seconds: Option<i64>,
    pub status: String,
    pub created_at: NaiveDateTime,
    pub decided_by_id: Option<i64>,
    pub decided_at: Option<NaiveDateTime>,
    pub replacement_technique_id: Option<i64>,
    pub decided_camp_id: Option<i64>,
}

/// A suggestion enriched with student/technique/video display names, used for
/// the coach pending-queue view.
#[derive(Debug, Clone, Serialize)]
pub struct PendingSuggestion {
    pub id: i64,
    pub student_id: i64,
    pub student_name: Option<String>,
    pub technique_id: i64,
    pub technique_name: String,
    pub anchor_video_id: Option<i64>,
    pub anchor_video_title: Option<String>,
    pub anchor_seconds: Option<i64>,
    pub created_at: NaiveDateTime,
}

/// Coach decision for a pending suggestion.
#[derive(Debug)]
pub enum SuggestionDecision {
    /// Add the suggested technique to `camp_id`.
    Approve { camp_id: i64 },
    /// Add `replacement_technique_id` to `camp_id` instead of the suggested one.
    Replace { replacement_technique_id: i64, camp_id: i64 },
    /// Dismiss without adding anything.
    Dismiss,
}

// ---------------------------------------------------------------------------
// Write functions
// ---------------------------------------------------------------------------

/// Create a new pending suggestion from a student. Returns the new suggestion
/// id. Emits `technique_suggested` activity targeting the student.
#[instrument(skip(pool))]
pub async fn create_suggestion(
    pool: &Pool<Sqlite>,
    student_id: i64,
    technique_id: i64,
    anchor_video_id: Option<i64>,
    anchor_seconds: Option<i64>,
) -> Result<i64, AppError> {
    let mut tx = pool.begin().await?;

    let id = sqlx::query_scalar!(
        r#"INSERT INTO technique_suggestions
               (student_id, technique_id, anchor_video_id, anchor_seconds)
           VALUES (?, ?, ?, ?)
           RETURNING id AS "id!: i64""#,
        student_id,
        technique_id,
        anchor_video_id,
        anchor_seconds,
    )
    .fetch_one(&mut *tx)
    .await?;

    emit(
        &mut tx,
        NewActivity::new(Verb::TechniqueSuggested, student_id)
            .target_student(student_id)
            .technique(technique_id)
            .payload(payload::suggestion(id, "pending")),
    )
    .await?;

    tx.commit().await?;
    Ok(id)
}

/// Coach decision on a pending suggestion. Sets status, decided_by_id,
/// decided_at and (where applicable) replacement_technique_id and
/// decided_camp_id. For Approve/Replace, calls
/// `add_camp_technique` so the chosen technique lands in the camp. Emits
/// `suggestion_decided`. Returns NotFound if the suggestion does not exist
/// or is already decided.
#[instrument(skip(pool))]
pub async fn decide_suggestion(
    pool: &Pool<Sqlite>,
    id: i64,
    decider_id: i64,
    decision: SuggestionDecision,
) -> Result<(), AppError> {
    // Fetch the suggestion and guard that it is still pending. We do this
    // before opening the transaction so the guard error is cheap.
    let suggestion = sqlx::query!(
        r#"SELECT student_id AS "student_id!: i64",
                  technique_id AS "technique_id!: i64",
                  status
           FROM technique_suggestions
           WHERE id = ?"#,
        id
    )
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("suggestion #{id} not found")))?;

    if suggestion.status != "pending" {
        return Err(AppError::NotFound(format!(
            "suggestion #{id} is already decided (status = {})",
            suggestion.status
        )));
    }

    let student_id = suggestion.student_id;
    let technique_id = suggestion.technique_id;

    // Resolve outcome fields.
    let (status, replacement_id, camp_id_opt): (&str, Option<i64>, Option<i64>) = match &decision {
        SuggestionDecision::Approve { camp_id } => ("approved", None, Some(*camp_id)),
        SuggestionDecision::Replace { replacement_technique_id, camp_id } => {
            ("replaced", Some(*replacement_technique_id), Some(*camp_id))
        }
        SuggestionDecision::Dismiss => ("dismissed", None, None),
    };

    // For approve/replace, the target camp must belong to the suggestion's
    // student (mirrors the pinned-promote guard) so a coach can't route one
    // student's suggestion into a different student's camp.
    if let Some(camp_id) = camp_id_opt {
        let camp_student = sqlx::query_scalar!(
            r#"SELECT student_id AS "student_id!: i64" FROM camps WHERE id = ?"#,
            camp_id
        )
        .fetch_optional(pool)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("camp #{camp_id} not found")))?;
        if camp_student != student_id {
            return Err(AppError::Validation(
                "camp does not belong to the suggestion's student".to_string(),
            ));
        }
    }

    // For approve/replace, add the technique to the camp first (inside its own
    // tx). If that fails we abort before touching the suggestion row.
    match &decision {
        SuggestionDecision::Approve { camp_id } => {
            add_camp_technique(pool, *camp_id, technique_id, decider_id).await?;
        }
        SuggestionDecision::Replace { replacement_technique_id, camp_id } => {
            add_camp_technique(pool, *camp_id, *replacement_technique_id, decider_id).await?;
        }
        SuggestionDecision::Dismiss => {}
    }

    // Now update the suggestion row and emit.
    let mut tx = pool.begin().await?;

    let affected = sqlx::query!(
        "UPDATE technique_suggestions
         SET status = ?,
             decided_by_id = ?,
             decided_at = CURRENT_TIMESTAMP,
             replacement_technique_id = ?,
             decided_camp_id = ?
         WHERE id = ? AND status = 'pending'",
        status,
        decider_id,
        replacement_id,
        camp_id_opt,
        id,
    )
    .execute(&mut *tx)
    .await?
    .rows_affected();

    if affected == 0 {
        // Race: another writer decided it between our guard read and this update.
        return Err(AppError::NotFound(format!(
            "suggestion #{id} was already decided by a concurrent request"
        )));
    }

    emit(
        &mut tx,
        NewActivity::new(Verb::SuggestionDecided, decider_id)
            .target_student(student_id)
            .technique(technique_id)
            .payload(payload::suggestion(id, status)),
    )
    .await?;

    tx.commit().await?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Read functions
// ---------------------------------------------------------------------------

/// All pending suggestions, joined with student/technique/anchor-video names,
/// ordered by `created_at` ascending (oldest first so coaches process in order).
#[instrument(skip(pool))]
pub async fn list_pending_suggestions(
    pool: &Pool<Sqlite>,
) -> Result<Vec<PendingSuggestion>, AppError> {
    let rows = sqlx::query!(
        r#"SELECT
               ts.id           AS "id!: i64",
               ts.student_id   AS "student_id!: i64",
               u.display_name  AS student_name,
               ts.technique_id AS "technique_id!: i64",
               t.name          AS "technique_name!: String",
               ts.anchor_video_id AS "anchor_video_id?: i64",
               v.title         AS anchor_video_title,
               ts.anchor_seconds AS "anchor_seconds?: i64",
               ts.created_at   AS "created_at!: NaiveDateTime"
           FROM technique_suggestions ts
           JOIN techniques t ON t.id = ts.technique_id
           JOIN users u ON u.id = ts.student_id
           LEFT JOIN videos v ON v.id = ts.anchor_video_id
           WHERE ts.status = 'pending'
           ORDER BY ts.created_at ASC"#
    )
    .fetch_all(pool)
    .await?;

    Ok(rows
        .into_iter()
        .map(|r| PendingSuggestion {
            id: r.id,
            student_id: r.student_id,
            student_name: r.student_name,
            technique_id: r.technique_id,
            technique_name: r.technique_name,
            anchor_video_id: r.anchor_video_id,
            anchor_video_title: r.anchor_video_title,
            anchor_seconds: r.anchor_seconds,
            created_at: r.created_at,
        })
        .collect())
}

/// All suggestions for a given student, any status, ordered newest first.
#[instrument(skip(pool))]
pub async fn list_suggestions_for_student(
    pool: &Pool<Sqlite>,
    student_id: i64,
) -> Result<Vec<TechniqueSuggestion>, AppError> {
    let rows = sqlx::query!(
        r#"SELECT
               id                       AS "id!: i64",
               student_id               AS "student_id!: i64",
               technique_id             AS "technique_id!: i64",
               anchor_video_id          AS "anchor_video_id?: i64",
               anchor_seconds           AS "anchor_seconds?: i64",
               status                   AS "status!: String",
               created_at               AS "created_at!: NaiveDateTime",
               decided_by_id            AS "decided_by_id?: i64",
               decided_at               AS "decided_at?: NaiveDateTime",
               replacement_technique_id AS "replacement_technique_id?: i64",
               decided_camp_id          AS "decided_camp_id?: i64"
           FROM technique_suggestions
           WHERE student_id = ?
           ORDER BY created_at DESC, id DESC"#,
        student_id
    )
    .fetch_all(pool)
    .await?;

    Ok(rows
        .into_iter()
        .map(|r| TechniqueSuggestion {
            id: r.id,
            student_id: r.student_id,
            technique_id: r.technique_id,
            anchor_video_id: r.anchor_video_id,
            anchor_seconds: r.anchor_seconds,
            status: r.status,
            created_at: r.created_at,
            decided_by_id: r.decided_by_id,
            decided_at: r.decided_at,
            replacement_technique_id: r.replacement_technique_id,
            decided_camp_id: r.decided_camp_id,
        })
        .collect())
}

