//! HTTP routes for the technique-suggestion queue (C-Slice 3, CC-033/034).
//!
//! Authorization summary:
//! - POST /suggestions: any authenticated student (creates for themselves;
//!   student_id = user.id, any body-supplied student_id is ignored).
//! - GET /suggestions/pending: ManageCamps (coach queue).
//! - GET /students/<id>/suggestions: the student themselves OR any coach.
//! - POST /suggestions/<id>/decide: ManageCamps.

use rocket::State;
use rocket::http::Status;
use rocket::serde::{Deserialize, Serialize, json::Json};
use sqlx::{Pool, Sqlite};
use tracing::instrument;

use crate::auth::{Permission, User};
use crate::db::suggestions::{
    PendingSuggestion, TechniqueSuggestion, SuggestionDecision,
    create_suggestion, decide_suggestion, list_pending_suggestions,
    list_suggestions_for_student,
};
use crate::error::AppError;

// ---------------------------------------------------------------------------
// Request / response types
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
pub struct CreateSuggestionRequest {
    pub technique_id: i64,
    pub anchor_video_id: Option<i64>,
    pub anchor_seconds: Option<i64>,
}

#[derive(Serialize)]
pub struct CreatedResponse {
    pub id: i64,
}

#[derive(Serialize)]
pub struct PendingSuggestionsResponse {
    pub suggestions: Vec<PendingSuggestion>,
}

#[derive(Serialize)]
pub struct StudentSuggestionsResponse {
    pub suggestions: Vec<TechniqueSuggestion>,
}

/// Body for `POST /suggestions/<id>/decide`.
#[derive(Deserialize)]
pub struct DecisionRequest {
    /// "approve" | "replace" | "dismiss"
    pub decision: String,
    /// Required for "approve" and "replace".
    pub camp_id: Option<i64>,
    /// Required for "replace".
    pub replacement_technique_id: Option<i64>,
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn require_manage_camps(user: &User) -> Result<(), Status> {
    user.require_permission(Permission::ManageCamps)
        .map_err(|_| Status::Forbidden)
}

fn is_coach(user: &User) -> bool {
    user.has_permission(Permission::ViewAllStudents)
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

/// Student creates a suggestion for themselves. `student_id` is always taken
/// from the authenticated user, never from the request body.
#[instrument(skip(req, pool, user))]
#[post("/suggestions", data = "<req>")]
pub async fn api_create_suggestion(
    user: User,
    req: Json<CreateSuggestionRequest>,
    pool: &State<Pool<Sqlite>>,
) -> Result<Json<CreatedResponse>, Status> {
    let id = create_suggestion(
        pool.inner(),
        user.id,
        req.technique_id,
        req.anchor_video_id,
        req.anchor_seconds,
    )
    .await
    .map_err(Status::from)?;
    Ok(Json(CreatedResponse { id }))
}

/// Coach queue: all pending suggestions, enriched with student/technique names.
#[instrument(skip(pool, user))]
#[get("/suggestions/pending")]
pub async fn api_list_pending_suggestions(
    user: User,
    pool: &State<Pool<Sqlite>>,
) -> Result<Json<PendingSuggestionsResponse>, Status> {
    require_manage_camps(&user)?;
    let suggestions = list_pending_suggestions(pool.inner())
        .await
        .map_err(Status::from)?;
    Ok(Json(PendingSuggestionsResponse { suggestions }))
}

/// Student's own suggestions (all statuses). Accessible by the student
/// themselves or any coach.
#[instrument(skip(pool, user))]
#[get("/students/<student_id>/suggestions")]
pub async fn api_student_suggestions(
    student_id: i64,
    user: User,
    pool: &State<Pool<Sqlite>>,
) -> Result<Json<StudentSuggestionsResponse>, Status> {
    if !is_coach(&user) && user.id != student_id {
        return Err(Status::Forbidden);
    }
    let suggestions = list_suggestions_for_student(pool.inner(), student_id)
        .await
        .map_err(Status::from)?;
    Ok(Json(StudentSuggestionsResponse { suggestions }))
}

/// Coach decides a pending suggestion (approve / replace / dismiss).
#[instrument(skip(req, pool, user))]
#[post("/suggestions/<id>/decide", data = "<req>")]
pub async fn api_decide_suggestion(
    id: i64,
    user: User,
    req: Json<DecisionRequest>,
    pool: &State<Pool<Sqlite>>,
) -> Result<Status, Status> {
    require_manage_camps(&user)?;

    let decision = match req.decision.as_str() {
        "approve" => {
            let camp_id = req.camp_id.ok_or(Status::BadRequest)?;
            SuggestionDecision::Approve { camp_id }
        }
        "replace" => {
            let camp_id = req.camp_id.ok_or(Status::BadRequest)?;
            let replacement_technique_id =
                req.replacement_technique_id.ok_or(Status::BadRequest)?;
            SuggestionDecision::Replace { replacement_technique_id, camp_id }
        }
        "dismiss" => SuggestionDecision::Dismiss,
        _ => return Err(Status::BadRequest),
    };

    decide_suggestion(pool.inner(), id, user.id, decision)
        .await
        .map_err(|e| match e {
            AppError::NotFound(_) => Status::NotFound,
            other => Status::from(other),
        })?;

    Ok(Status::NoContent)
}
