//! HTTP routes for competitions, registrations, and matches (C-Slice 2).
//!
//! Authorization summary:
//! - Competition create/update: ManageCompetitions (coach+admin).
//! - Competition list/get: any authenticated user.
//! - Student self-register: any authenticated user (registers themselves).
//! - Coach register/unregister other: ManageCompetitions.
//! - Promote camp to competition: ManageCamps.
//! - Match create/read/update/delete: coach OR the registration's own student
//!   (checked via `can_manage_match`).
//! - Match technique link/unlink: ManageCamps (coach analysis, CC-022).

use chrono::Utc;
use rocket::State;
use rocket::http::Status;
use rocket::serde::{Deserialize, Serialize, json::Json};
use sqlx::{Pool, Sqlite};
use tracing::instrument;

use crate::auth::{Permission, User};
use crate::db::competitions::{
    Competition, Registration, RegistrationRosterRow,
    create_competition, get_competition, list_competitions, update_competition,
    register_student, unregister_student, list_registrations_for_competition,
    promote_camp_to_competition,
};
use crate::db::matches::{
    Match, MatchMethod, MatchResult, MatchTechniqueRow,
    can_manage_match, create_match, delete_match,
    link_match_technique, list_match_techniques, list_matches_for_registration,
    student_id_for_match, student_id_for_registration,
    unlink_match_technique, update_match,
};
use crate::db::list_videos_for_match;
use crate::models::Video;

// ---------------------------------------------------------------------------
// Request / response types
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
pub struct CreateCompetitionRequest {
    pub name: String,
    pub date: Option<String>,
}

#[derive(Deserialize)]
pub struct UpdateCompetitionRequest {
    pub name: String,
    pub date: Option<String>,
}

#[derive(Serialize)]
pub struct CreatedResponse {
    pub id: i64,
}

#[derive(Serialize)]
pub struct CompetitionListResponse {
    pub competitions: Vec<Competition>,
}

#[derive(Serialize)]
pub struct CompetitionDetailResponse {
    pub id: i64,
    pub name: String,
    pub date: Option<String>,
    pub created_by_id: i64,
    pub created_at: chrono::NaiveDateTime,
    pub roster: Vec<RegistrationRosterRow>,
}

#[derive(Deserialize)]
pub struct PromoteCampRequest {
    pub competition_id: i64,
}

#[derive(Serialize)]
pub struct RegistrationResponse {
    pub registration: Registration,
}

#[derive(Deserialize)]
pub struct CreateMatchRequest {
    pub result: String,
    pub method: Option<String>,
    pub method_detail: Option<String>,
    pub occurred_at: Option<String>,
}

#[derive(Deserialize)]
pub struct UpdateMatchRequest {
    pub result: String,
    pub method: Option<String>,
    pub method_detail: Option<String>,
    pub occurred_at: Option<String>,
}

#[derive(Serialize)]
pub struct MatchListResponse {
    pub matches: Vec<Match>,
}

#[derive(Serialize)]
pub struct MatchTechniquesResponse {
    pub techniques: Vec<MatchTechniqueRow>,
}

#[derive(Deserialize)]
pub struct LinkTechniqueRequest {
    pub technique_id: i64,
}

#[derive(Serialize)]
pub struct MatchVideosResponse {
    pub videos: Vec<Video>,
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn require_manage_competitions(user: &User) -> Result<(), Status> {
    user.require_permission(Permission::ManageCompetitions)
        .map_err(|_| Status::Forbidden)
}

fn require_manage_camps(user: &User) -> Result<(), Status> {
    user.require_permission(Permission::ManageCamps)
        .map_err(|_| Status::Forbidden)
}

fn is_coach(user: &User) -> bool {
    user.has_permission(Permission::ViewAllStudents)
}

/// Parse `occurred_at` and validate it is not in the future. Returns 400 on
/// invalid format or future date.
fn validate_occurred_at(occurred_at: Option<&str>) -> Result<(), Status> {
    if let Some(ts) = occurred_at {
        // Parse as NaiveDateTime in ISO-8601 format.
        let parsed = chrono::NaiveDateTime::parse_from_str(ts, "%Y-%m-%dT%H:%M:%S")
            .or_else(|_| chrono::NaiveDateTime::parse_from_str(ts, "%Y-%m-%dT%H:%M:%S%.f"))
            .map_err(|_| Status::BadRequest)?;
        let now = Utc::now().naive_utc();
        if parsed > now {
            return Err(Status::BadRequest);
        }
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Competition routes
// ---------------------------------------------------------------------------

#[instrument(skip(req, pool, user))]
#[post("/competitions", data = "<req>")]
pub async fn api_create_competition(
    user: User,
    req: Json<CreateCompetitionRequest>,
    pool: &State<Pool<Sqlite>>,
) -> Result<Json<CreatedResponse>, Status> {
    require_manage_competitions(&user)?;
    let name = req.name.trim();
    if name.is_empty() {
        return Err(Status::BadRequest);
    }
    let id = create_competition(
        pool.inner(),
        name,
        req.date.as_deref(),
        user.id,
    )
    .await
    .map_err(Status::from)?;
    Ok(Json(CreatedResponse { id }))
}

#[instrument(skip(pool, _user))]
#[get("/competitions")]
pub async fn api_list_competitions(
    _user: User,
    pool: &State<Pool<Sqlite>>,
) -> Result<Json<CompetitionListResponse>, Status> {
    let competitions = list_competitions(pool.inner())
        .await
        .map_err(Status::from)?;
    Ok(Json(CompetitionListResponse { competitions }))
}

#[instrument(skip(pool, _user))]
#[get("/competitions/<id>")]
pub async fn api_get_competition(
    id: i64,
    _user: User,
    pool: &State<Pool<Sqlite>>,
) -> Result<Json<CompetitionDetailResponse>, Status> {
    let pool = pool.inner();
    let comp = get_competition(pool, id)
        .await
        .map_err(Status::from)?
        .ok_or(Status::NotFound)?;
    let roster = list_registrations_for_competition(pool, id)
        .await
        .map_err(Status::from)?;
    Ok(Json(CompetitionDetailResponse {
        id: comp.id,
        name: comp.name,
        date: comp.date,
        created_by_id: comp.created_by_id,
        created_at: comp.created_at,
        roster,
    }))
}

#[instrument(skip(req, pool, user))]
#[put("/competitions/<id>", data = "<req>")]
pub async fn api_update_competition(
    id: i64,
    user: User,
    req: Json<UpdateCompetitionRequest>,
    pool: &State<Pool<Sqlite>>,
) -> Result<Status, Status> {
    require_manage_competitions(&user)?;
    let name = req.name.trim();
    if name.is_empty() {
        return Err(Status::BadRequest);
    }
    update_competition(pool.inner(), id, name, req.date.as_deref())
        .await
        .map_err(|e| match e {
            crate::error::AppError::NotFound(_) => Status::NotFound,
            other => Status::from(other),
        })?;
    Ok(Status::NoContent)
}

// ---------------------------------------------------------------------------
// Registration routes
// ---------------------------------------------------------------------------

/// Student self-registers for a competition (registers user.id).
#[instrument(skip(pool, user))]
#[post("/competitions/<id>/register")]
pub async fn api_self_register_competition(
    id: i64,
    user: User,
    pool: &State<Pool<Sqlite>>,
) -> Result<Json<CreatedResponse>, Status> {
    let reg_id = register_student(pool.inner(), id, user.id, user.id)
        .await
        .map_err(Status::from)?;
    Ok(Json(CreatedResponse { id: reg_id }))
}

/// Coach registers another student for a competition.
#[instrument(skip(pool, user))]
#[post("/competitions/<id>/register/<student_id>")]
pub async fn api_coach_register_student(
    id: i64,
    student_id: i64,
    user: User,
    pool: &State<Pool<Sqlite>>,
) -> Result<Json<CreatedResponse>, Status> {
    require_manage_competitions(&user)?;
    let reg_id = register_student(pool.inner(), id, student_id, user.id)
        .await
        .map_err(Status::from)?;
    Ok(Json(CreatedResponse { id: reg_id }))
}

/// Coach unregisters a student from a competition.
#[instrument(skip(pool, user))]
#[delete("/competitions/<id>/register/<student_id>")]
pub async fn api_unregister_student(
    id: i64,
    student_id: i64,
    user: User,
    pool: &State<Pool<Sqlite>>,
) -> Result<Status, Status> {
    require_manage_competitions(&user)?;
    unregister_student(pool.inner(), id, student_id)
        .await
        .map_err(Status::from)?;
    Ok(Status::NoContent)
}

// ---------------------------------------------------------------------------
// Camp promotion
// ---------------------------------------------------------------------------

/// Set a camp's competition_id (promote it to a competition camp).
#[instrument(skip(req, pool, user))]
#[post("/camps/<camp_id>/promote", data = "<req>")]
pub async fn api_promote_camp_to_competition(
    camp_id: i64,
    user: User,
    req: Json<PromoteCampRequest>,
    pool: &State<Pool<Sqlite>>,
) -> Result<Status, Status> {
    require_manage_camps(&user)?;
    promote_camp_to_competition(pool.inner(), camp_id, req.competition_id, user.id)
        .await
        .map_err(|e| match e {
            crate::error::AppError::NotFound(_) => Status::NotFound,
            other => Status::from(other),
        })?;
    Ok(Status::NoContent)
}

// ---------------------------------------------------------------------------
// Match routes
// ---------------------------------------------------------------------------

/// Create a match for a registration. Allowed by coach or the registration's
/// own student.
#[instrument(skip(req, pool, user))]
#[post("/registrations/<reg_id>/matches", data = "<req>")]
pub async fn api_create_match(
    reg_id: i64,
    user: User,
    req: Json<CreateMatchRequest>,
    pool: &State<Pool<Sqlite>>,
) -> Result<Json<CreatedResponse>, Status> {
    let pool = pool.inner();

    // Resolve registration's student for authz.
    let reg_student_id = student_id_for_registration(pool, reg_id)
        .await
        .map_err(Status::from)?
        .ok_or(Status::NotFound)?;

    if !can_manage_match(is_coach(&user), user.id, reg_student_id) {
        return Err(Status::Forbidden);
    }

    // Validate result.
    let result = MatchResult::from_str_result(&req.result).ok_or(Status::BadRequest)?;

    // Validate method (optional).
    let method = match &req.method {
        Some(m) => Some(MatchMethod::from_str_method(m).ok_or(Status::BadRequest)?),
        None => None,
    };

    // Validate occurred_at not in the future.
    validate_occurred_at(req.occurred_at.as_deref())?;

    let id = create_match(
        pool,
        reg_id,
        result,
        method,
        req.method_detail.as_deref(),
        req.occurred_at.as_deref(),
        user.id,
    )
    .await
    .map_err(Status::from)?;

    Ok(Json(CreatedResponse { id }))
}

/// List matches for a registration. Allowed by coach or the registration's
/// own student.
#[instrument(skip(pool, user))]
#[get("/registrations/<reg_id>/matches")]
pub async fn api_list_registration_matches(
    reg_id: i64,
    user: User,
    pool: &State<Pool<Sqlite>>,
) -> Result<Json<MatchListResponse>, Status> {
    let pool = pool.inner();

    let reg_student_id = student_id_for_registration(pool, reg_id)
        .await
        .map_err(Status::from)?
        .ok_or(Status::NotFound)?;

    if !can_manage_match(is_coach(&user), user.id, reg_student_id) {
        return Err(Status::Forbidden);
    }

    let matches = list_matches_for_registration(pool, reg_id)
        .await
        .map_err(Status::from)?;

    Ok(Json(MatchListResponse { matches }))
}

/// Update a match. Allowed by coach or the match's own student.
#[instrument(skip(req, pool, user))]
#[put("/matches/<id>", data = "<req>")]
pub async fn api_update_match(
    id: i64,
    user: User,
    req: Json<UpdateMatchRequest>,
    pool: &State<Pool<Sqlite>>,
) -> Result<Status, Status> {
    let pool = pool.inner();

    let match_student_id = student_id_for_match(pool, id)
        .await
        .map_err(Status::from)?
        .ok_or(Status::NotFound)?;

    if !can_manage_match(is_coach(&user), user.id, match_student_id) {
        return Err(Status::Forbidden);
    }

    let result = MatchResult::from_str_result(&req.result).ok_or(Status::BadRequest)?;
    let method = match &req.method {
        Some(m) => Some(MatchMethod::from_str_method(m).ok_or(Status::BadRequest)?),
        None => None,
    };

    validate_occurred_at(req.occurred_at.as_deref())?;

    update_match(
        pool,
        id,
        result,
        method,
        req.method_detail.as_deref(),
        req.occurred_at.as_deref(),
    )
    .await
    .map_err(|e| match e {
        crate::error::AppError::NotFound(_) => Status::NotFound,
        other => Status::from(other),
    })?;

    Ok(Status::NoContent)
}

/// Delete a match. Allowed by coach or the match's own student.
#[instrument(skip(pool, user))]
#[delete("/matches/<id>")]
pub async fn api_delete_match(
    id: i64,
    user: User,
    pool: &State<Pool<Sqlite>>,
) -> Result<Status, Status> {
    let pool = pool.inner();

    let match_student_id = student_id_for_match(pool, id)
        .await
        .map_err(Status::from)?
        .ok_or(Status::NotFound)?;

    if !can_manage_match(is_coach(&user), user.id, match_student_id) {
        return Err(Status::Forbidden);
    }

    delete_match(pool, id).await.map_err(Status::from)?;
    Ok(Status::NoContent)
}

// ---------------------------------------------------------------------------
// Match technique routes (coach-only analysis, CC-022)
// ---------------------------------------------------------------------------

/// Link a technique to a match for post-competition analysis. Coach-only.
#[instrument(skip(req, pool, user))]
#[post("/matches/<id>/techniques", data = "<req>")]
pub async fn api_link_match_technique(
    id: i64,
    user: User,
    req: Json<LinkTechniqueRequest>,
    pool: &State<Pool<Sqlite>>,
) -> Result<Status, Status> {
    require_manage_camps(&user)?;
    link_match_technique(pool.inner(), id, req.technique_id, user.id)
        .await
        .map_err(|e| match e {
            crate::error::AppError::NotFound(_) => Status::NotFound,
            other => Status::from(other),
        })?;
    Ok(Status::NoContent)
}

/// Unlink a technique from a match. Coach-only.
#[instrument(skip(pool, user))]
#[delete("/matches/<id>/techniques/<technique_id>")]
pub async fn api_unlink_match_technique(
    id: i64,
    technique_id: i64,
    user: User,
    pool: &State<Pool<Sqlite>>,
) -> Result<Status, Status> {
    require_manage_camps(&user)?;
    unlink_match_technique(pool.inner(), id, technique_id)
        .await
        .map_err(Status::from)?;
    Ok(Status::NoContent)
}

/// List techniques linked to a match.
#[instrument(skip(pool, user))]
#[get("/matches/<id>/techniques")]
pub async fn api_list_match_techniques(
    id: i64,
    user: User,
    pool: &State<Pool<Sqlite>>,
) -> Result<Json<MatchTechniquesResponse>, Status> {
    let pool = pool.inner();

    let match_student_id = student_id_for_match(pool, id)
        .await
        .map_err(Status::from)?
        .ok_or(Status::NotFound)?;

    if !can_manage_match(is_coach(&user), user.id, match_student_id) {
        return Err(Status::Forbidden);
    }

    let techniques = list_match_techniques(pool, id)
        .await
        .map_err(Status::from)?;

    Ok(Json(MatchTechniquesResponse { techniques }))
}

// ---------------------------------------------------------------------------
// Match videos route
// ---------------------------------------------------------------------------

/// List alive, non-hidden videos owned by a match.
/// Accessible to the match's own student and any coach.
#[instrument(skip(pool, user))]
#[get("/matches/<id>/videos")]
pub async fn api_list_match_videos(
    id: i64,
    user: User,
    pool: &State<Pool<Sqlite>>,
) -> Result<Json<MatchVideosResponse>, Status> {
    let pool = pool.inner();

    let match_student_id = student_id_for_match(pool, id)
        .await
        .map_err(Status::from)?
        .ok_or(Status::NotFound)?;

    if !can_manage_match(is_coach(&user), user.id, match_student_id) {
        return Err(Status::Forbidden);
    }

    let videos = list_videos_for_match(pool, id)
        .await
        .map_err(Status::from)?;

    Ok(Json(MatchVideosResponse { videos }))
}

