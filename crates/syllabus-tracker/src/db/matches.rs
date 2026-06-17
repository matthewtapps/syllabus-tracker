//! Matches: individual bouts logged against a competition registration.
//! A registration may have many matches (multiple rounds / same-day events).
//! Techniques can be linked to a match for post-competition analysis.
//! All writes are gated at the route layer by `can_manage_match`.

use chrono::NaiveDateTime;
use serde::Serialize;
use sqlx::{Pool, Sqlite};
use tracing::instrument;

use crate::db::activity::{emit, NewActivity, Verb};
use crate::error::AppError;

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

/// Outcome of a match bout.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum MatchResult {
    Win,
    Loss,
    Draw,
}

impl MatchResult {
    pub fn as_str(self) -> &'static str {
        match self {
            MatchResult::Win => "win",
            MatchResult::Loss => "loss",
            MatchResult::Draw => "draw",
        }
    }

    pub fn from_str_result(s: &str) -> Option<MatchResult> {
        match s {
            "win" => Some(MatchResult::Win),
            "loss" => Some(MatchResult::Loss),
            "draw" => Some(MatchResult::Draw),
            _ => None,
        }
    }
}

/// How the match ended. Optional: a result can be recorded without specifying
/// the finishing method.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum MatchMethod {
    Submission,
    Points,
    Decision,
    Dq,
    Other,
}

impl MatchMethod {
    pub fn as_str(self) -> &'static str {
        match self {
            MatchMethod::Submission => "submission",
            MatchMethod::Points => "points",
            MatchMethod::Decision => "decision",
            MatchMethod::Dq => "dq",
            MatchMethod::Other => "other",
        }
    }

    pub fn from_str_method(s: &str) -> Option<MatchMethod> {
        match s {
            "submission" => Some(MatchMethod::Submission),
            "points" => Some(MatchMethod::Points),
            "decision" => Some(MatchMethod::Decision),
            "dq" => Some(MatchMethod::Dq),
            "other" => Some(MatchMethod::Other),
            _ => None,
        }
    }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize)]
pub struct Match {
    pub id: i64,
    pub registration_id: i64,
    pub result: MatchResult,
    pub method: Option<MatchMethod>,
    /// Free-text detail, e.g. "kimura from north-south".
    pub method_detail: Option<String>,
    /// Client-supplied event timestamp. Stored as TEXT (ISO-8601) in SQLite.
    pub occurred_at: Option<String>,
    pub created_by_id: i64,
    pub created_at: NaiveDateTime,
}

/// Aggregate view of a match with competition context, used for the
/// student's cross-registration match history (CC-031).
#[derive(Debug, Clone, Serialize)]
pub struct StudentMatch {
    pub id: i64,
    pub registration_id: i64,
    pub result: MatchResult,
    pub method: Option<MatchMethod>,
    pub method_detail: Option<String>,
    pub occurred_at: Option<String>,
    pub created_by_id: i64,
    pub created_at: NaiveDateTime,
    /// The competition this match belongs to (via registration).
    pub competition_id: i64,
    pub competition_name: String,
    /// The student's camp linked to that competition, if any.
    pub camp_id: Option<i64>,
}

/// A technique row as returned from `list_match_techniques`.
#[derive(Debug, Clone, Serialize)]
pub struct MatchTechniqueRow {
    pub technique_id: i64,
    pub name: String,
    pub description: Option<String>,
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Authorization helper: returns true if the actor may create/edit/delete a
/// match belonging to a registration whose student is `registration_student_id`.
/// A coach always can; a student only for their own registration.
pub fn can_manage_match(is_coach: bool, actor_id: i64, registration_student_id: i64) -> bool {
    is_coach || actor_id == registration_student_id
}

/// Resolve the student_id who owns a given registration. Used by the route
/// layer to check authz before touching a match.
#[instrument(skip(pool))]
pub async fn student_id_for_registration(
    pool: &Pool<Sqlite>,
    registration_id: i64,
) -> Result<Option<i64>, AppError> {
    let id = sqlx::query_scalar!(
        r#"SELECT student_id AS "id!: i64"
           FROM competition_registrations WHERE id = ?"#,
        registration_id
    )
    .fetch_optional(pool)
    .await?;
    Ok(id)
}

/// Resolve the student_id who owns the registration of a given match.
#[instrument(skip(pool))]
pub async fn student_id_for_match(
    pool: &Pool<Sqlite>,
    match_id: i64,
) -> Result<Option<i64>, AppError> {
    let id = sqlx::query_scalar!(
        r#"SELECT cr.student_id AS "id!: i64"
           FROM matches m
           JOIN competition_registrations cr ON cr.id = m.registration_id
           WHERE m.id = ?"#,
        match_id
    )
    .fetch_optional(pool)
    .await?;
    Ok(id)
}

// ---------------------------------------------------------------------------
// Match CRUD
// ---------------------------------------------------------------------------

/// Create a match for a registration and emit `MatchLogged`. The
/// `occurred_at` not-future validation is the responsibility of the route
/// layer (S2-5).
#[instrument(skip(pool))]
pub async fn create_match(
    pool: &Pool<Sqlite>,
    registration_id: i64,
    result: MatchResult,
    method: Option<MatchMethod>,
    method_detail: Option<&str>,
    occurred_at: Option<&str>,
    created_by_id: i64,
) -> Result<i64, AppError> {
    let result_str = result.as_str();
    let method_str = method.map(|m| m.as_str());

    let mut tx = pool.begin().await?;

    // Resolve the registration's student for activity target + deep-link.
    let reg = sqlx::query!(
        r#"SELECT student_id AS "student_id!: i64",
                  competition_id AS "competition_id!: i64"
           FROM competition_registrations WHERE id = ?"#,
        registration_id
    )
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("registration #{registration_id} not found")))?;

    let id = sqlx::query_scalar!(
        r#"INSERT INTO matches
               (registration_id, result, method, method_detail, occurred_at, created_by_id)
           VALUES (?, ?, ?, ?, ?, ?)
           RETURNING id AS "id!: i64""#,
        registration_id,
        result_str,
        method_str,
        method_detail,
        occurred_at,
        created_by_id,
    )
    .fetch_one(&mut *tx)
    .await?;

    // Resolve the student's camp for this competition (if any) so the match's
    // activity deep-links to the owning camp.
    let camp_id = sqlx::query_scalar!(
        r#"SELECT id AS "id!: i64" FROM camps
           WHERE student_id = ? AND competition_id = ? LIMIT 1"#,
        reg.student_id,
        reg.competition_id,
    )
    .fetch_optional(&mut *tx)
    .await?;

    let mut activity = NewActivity::new(Verb::MatchLogged, created_by_id)
        .target_student(reg.student_id)
        .match_ref(id)
        .competition(reg.competition_id)
        .context_kind("competition");
    if let Some(cid) = camp_id {
        activity = activity.camp(cid);
    }
    emit(&mut tx, activity).await?;

    tx.commit().await?;
    Ok(id)
}

/// Fetch a single match by id.
#[instrument(skip(pool))]
pub async fn get_match(
    pool: &Pool<Sqlite>,
    id: i64,
) -> Result<Option<Match>, AppError> {
    let row = sqlx::query!(
        r#"SELECT
               id AS "id!: i64",
               registration_id AS "registration_id!: i64",
               result AS "result!: String",
               method AS "method?: String",
               method_detail AS "method_detail?: String",
               occurred_at AS "occurred_at?: String",
               created_by_id AS "created_by_id!: i64",
               created_at AS "created_at!: NaiveDateTime"
           FROM matches WHERE id = ?"#,
        id
    )
    .fetch_optional(pool)
    .await?;

    Ok(row.map(|r| Match {
        id: r.id,
        registration_id: r.registration_id,
        result: MatchResult::from_str_result(&r.result).unwrap_or(MatchResult::Draw),
        method: r.method.as_deref().and_then(MatchMethod::from_str_method),
        method_detail: r.method_detail,
        occurred_at: r.occurred_at,
        created_by_id: r.created_by_id,
        created_at: r.created_at,
    }))
}

/// List all matches for a registration, newest first.
#[instrument(skip(pool))]
pub async fn list_matches_for_registration(
    pool: &Pool<Sqlite>,
    registration_id: i64,
) -> Result<Vec<Match>, AppError> {
    let rows = sqlx::query!(
        r#"SELECT
               id AS "id!: i64",
               registration_id AS "registration_id!: i64",
               result AS "result!: String",
               method AS "method?: String",
               method_detail AS "method_detail?: String",
               occurred_at AS "occurred_at?: String",
               created_by_id AS "created_by_id!: i64",
               created_at AS "created_at!: NaiveDateTime"
           FROM matches
           WHERE registration_id = ?
           ORDER BY created_at DESC, id DESC"#,
        registration_id
    )
    .fetch_all(pool)
    .await?;

    Ok(rows
        .into_iter()
        .map(|r| Match {
            id: r.id,
            registration_id: r.registration_id,
            result: MatchResult::from_str_result(&r.result).unwrap_or(MatchResult::Draw),
            method: r.method.as_deref().and_then(MatchMethod::from_str_method),
            method_detail: r.method_detail,
            occurred_at: r.occurred_at,
            created_by_id: r.created_by_id,
            created_at: r.created_at,
        })
        .collect())
}

/// Update an existing match. Returns `AppError::NotFound` when no row is
/// affected (id does not exist).
#[instrument(skip(pool))]
pub async fn update_match(
    pool: &Pool<Sqlite>,
    id: i64,
    result: MatchResult,
    method: Option<MatchMethod>,
    method_detail: Option<&str>,
    occurred_at: Option<&str>,
) -> Result<(), AppError> {
    let result_str = result.as_str();
    let method_str = method.map(|m| m.as_str());

    let affected = sqlx::query!(
        "UPDATE matches
         SET result = ?, method = ?, method_detail = ?, occurred_at = ?
         WHERE id = ?",
        result_str,
        method_str,
        method_detail,
        occurred_at,
        id,
    )
    .execute(pool)
    .await?
    .rows_affected();

    if affected == 0 {
        return Err(AppError::NotFound(format!("match #{id} not found")));
    }
    Ok(())
}

/// Delete a match by id. Cascades to match_techniques rows.
#[instrument(skip(pool))]
pub async fn delete_match(pool: &Pool<Sqlite>, id: i64) -> Result<(), AppError> {
    sqlx::query!("DELETE FROM matches WHERE id = ?", id)
        .execute(pool)
        .await?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Technique links
// ---------------------------------------------------------------------------

/// Link a technique to a match for post-competition analysis. Uses
/// `INSERT OR IGNORE` so duplicate links are silently dropped. Emits
/// `MatchTechniqueLinked` only when the row was actually inserted
/// (rows_affected > 0).
#[instrument(skip(pool))]
pub async fn link_match_technique(
    pool: &Pool<Sqlite>,
    match_id: i64,
    technique_id: i64,
    by_id: i64,
) -> Result<(), AppError> {
    let mut tx = pool.begin().await?;

    // Resolve the student who owns this match for the activity target.
    let reg = sqlx::query!(
        r#"SELECT cr.student_id AS "student_id!: i64",
                  cr.competition_id AS "competition_id!: i64"
           FROM matches m
           JOIN competition_registrations cr ON cr.id = m.registration_id
           WHERE m.id = ?"#,
        match_id
    )
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("match #{match_id} not found")))?;

    let affected = sqlx::query!(
        "INSERT OR IGNORE INTO match_techniques (match_id, technique_id, added_by_id)
         VALUES (?, ?, ?)",
        match_id,
        technique_id,
        by_id,
    )
    .execute(&mut *tx)
    .await?
    .rows_affected();

    if affected > 0 {
        // Resolve the student's camp for this competition (if any) so the
        // match-technique activity deep-links to the owning camp.
        let camp_id = sqlx::query_scalar!(
            r#"SELECT id AS "id!: i64" FROM camps
               WHERE student_id = ? AND competition_id = ? LIMIT 1"#,
            reg.student_id,
            reg.competition_id,
        )
        .fetch_optional(&mut *tx)
        .await?;

        let mut activity = NewActivity::new(Verb::MatchTechniqueLinked, by_id)
            .target_student(reg.student_id)
            .match_ref(match_id)
            .technique(technique_id)
            .competition(reg.competition_id)
            .context_kind("competition");
        if let Some(cid) = camp_id {
            activity = activity.camp(cid);
        }
        emit(&mut tx, activity).await?;
    }

    tx.commit().await?;
    Ok(())
}

/// Remove a technique link from a match. No-op when the link does not exist.
#[instrument(skip(pool))]
pub async fn unlink_match_technique(
    pool: &Pool<Sqlite>,
    match_id: i64,
    technique_id: i64,
) -> Result<(), AppError> {
    sqlx::query!(
        "DELETE FROM match_techniques WHERE match_id = ? AND technique_id = ?",
        match_id,
        technique_id,
    )
    .execute(pool)
    .await?;
    Ok(())
}

/// List techniques linked to a match, joined for name and description.
#[instrument(skip(pool))]
pub async fn list_match_techniques(
    pool: &Pool<Sqlite>,
    match_id: i64,
) -> Result<Vec<MatchTechniqueRow>, AppError> {
    let rows = sqlx::query!(
        r#"SELECT t.id AS "technique_id!: i64", t.name, t.description AS "description?: String"
           FROM match_techniques mt
           JOIN techniques t ON t.id = mt.technique_id
           WHERE mt.match_id = ?
           ORDER BY t.name"#,
        match_id
    )
    .fetch_all(pool)
    .await?;

    Ok(rows
        .into_iter()
        .map(|r| MatchTechniqueRow {
            technique_id: r.technique_id,
            name: r.name,
            description: r.description,
        })
        .collect())
}

// ---------------------------------------------------------------------------
// Student aggregate
// ---------------------------------------------------------------------------

/// All matches across a student's registrations (active or not; historical
/// footage persists). Joins competition name and the student's camp linked to
/// that competition, if any. Sorted reverse-chronologically by `occurred_at`
/// (NULLs last) then `created_at`. Implements CC-031.
#[instrument(skip(pool))]
pub async fn list_matches_for_student(
    pool: &Pool<Sqlite>,
    student_id: i64,
) -> Result<Vec<StudentMatch>, AppError> {
    let rows = sqlx::query!(
        r#"SELECT
               m.id AS "id!: i64",
               m.registration_id AS "registration_id!: i64",
               m.result AS "result!: String",
               m.method AS "method?: String",
               m.method_detail AS "method_detail?: String",
               m.occurred_at AS "occurred_at?: String",
               m.created_by_id AS "created_by_id!: i64",
               m.created_at AS "created_at!: NaiveDateTime",
               cr.competition_id AS "competition_id!: i64",
               c.name AS "competition_name!: String",
               camp.id AS "camp_id?: i64"
           FROM matches m
           JOIN competition_registrations cr ON cr.id = m.registration_id
           JOIN competitions c ON c.id = cr.competition_id
           LEFT JOIN camps camp
               ON camp.student_id = cr.student_id
              AND camp.competition_id = cr.competition_id
           WHERE cr.student_id = ?
           ORDER BY
               CASE WHEN m.occurred_at IS NULL THEN 1 ELSE 0 END,
               m.occurred_at DESC,
               m.created_at DESC"#,
        student_id
    )
    .fetch_all(pool)
    .await?;

    Ok(rows
        .into_iter()
        .map(|r| StudentMatch {
            id: r.id,
            registration_id: r.registration_id,
            result: MatchResult::from_str_result(&r.result).unwrap_or(MatchResult::Draw),
            method: r.method.as_deref().and_then(MatchMethod::from_str_method),
            method_detail: r.method_detail,
            occurred_at: r.occurred_at,
            created_by_id: r.created_by_id,
            created_at: r.created_at,
            competition_id: r.competition_id,
            competition_name: r.competition_name,
            camp_id: r.camp_id,
        })
        .collect())
}
