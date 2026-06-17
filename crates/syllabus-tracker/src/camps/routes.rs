use rocket::State;
use rocket::http::Status;
use rocket::serde::{Deserialize, Serialize, json::Json};
use sqlx::{Pool, Sqlite};
use tracing::instrument;

use crate::auth::{Permission, User};
use crate::db::camps::{
    add_camp_technique, archive_camp, create_camp, create_camp_technique_new, get_camp,
    list_camp_summaries_for_student, list_camp_techniques, remove_camp_technique, update_camp,
    Camp, CampSummary, CampTechnique, NewCamp, TechniqueScope,
};
use crate::db::competitions::{get_competition, registration_for};
use crate::db::{list_videos_for_camp, set_video_camp_visibility};
use crate::models::Video;

/// Guard query: is the given technique pinned for the given student?
async fn is_technique_pinned(
    pool: &Pool<Sqlite>,
    student_id: i64,
    technique_id: i64,
) -> Result<bool, Status> {
    let count = sqlx::query_scalar!(
        r#"SELECT COUNT(*) AS "c!: i64"
           FROM student_pinned_techniques
           WHERE student_id = ? AND technique_id = ?"#,
        student_id,
        technique_id,
    )
    .fetch_one(pool)
    .await
    .map_err(|_| Status::InternalServerError)?;
    Ok(count > 0)
}

fn require_camps(user: &User) -> Result<(), Status> {
    user.require_permission(Permission::ManageCamps)
        .map_err(|_| Status::Forbidden)
}

/// A student may read only their own camps; a coach may read anyone's.
fn can_read(user: &User, camp: &Camp) -> bool {
    user.has_permission(Permission::ViewAllStudents) || camp.student_id == user.id
}

#[derive(Deserialize)]
pub struct CreateCampRequest {
    pub student_id: i64,
    pub name: String,
    pub description: Option<String>,
    /// Optional id of an earlier camp this new camp builds on ("builds-on" lineage).
    pub references_camp_id: Option<i64>,
}

#[derive(Deserialize)]
pub struct UpdateCampRequest {
    pub name: String,
    pub description: Option<String>,
}

#[derive(Deserialize)]
pub struct AddTechniqueRequest {
    pub technique_id: i64,
}

/// Body for `POST /api/camps/<id>/techniques/create` (CC-009/010).
#[derive(Deserialize)]
pub struct CreateCampTechniqueRequest {
    pub name: String,
    pub description: String,
    /// `"global"` → technique is added to the shared library (CC-009).
    /// `"scoped"` → technique is camp-only (CC-010).
    pub scope: String,
}

#[derive(Serialize)]
pub struct CreatedResponse {
    pub id: i64,
}

#[derive(Serialize)]
pub struct CampListResponse {
    pub camps: Vec<CampSummary>,
}

#[derive(Serialize)]
pub struct CampDetailResponse {
    pub id: i64,
    pub student_id: i64,
    pub coach_id: i64,
    pub name: String,
    pub description: Option<String>,
    pub created_at: chrono::NaiveDateTime,
    pub archived_at: Option<chrono::NaiveDateTime>,
    pub techniques: Vec<CampTechnique>,
    /// Id of the competition this camp is linked to, if any.
    pub competition_id: Option<i64>,
    /// Name of the linked competition, resolved eagerly so the frontend does not
    /// need a second round-trip to display it.
    pub competition_name: Option<String>,
    /// Registration id for (camp.student_id, camp.competition_id). Present only
    /// when competition_id is set and the student is registered. The frontend
    /// uses this to key match queries without a separate registration lookup.
    pub registration_id: Option<i64>,
    /// Id of the camp this camp builds on, if any.
    pub references_camp_id: Option<i64>,
    /// Name of the referenced camp, resolved eagerly (mirrors competition_name).
    /// Present only when references_camp_id is set.
    pub references_camp_name: Option<String>,
}

#[instrument(skip(req, pool, user))]
#[post("/camps", data = "<req>")]
pub async fn api_create_camp(
    user: User,
    req: Json<CreateCampRequest>,
    pool: &State<Pool<Sqlite>>,
) -> Result<Json<CreatedResponse>, Status> {
    require_camps(&user)?;
    let id = create_camp(
        pool.inner(),
        NewCamp {
            student_id: req.student_id,
            coach_id: user.id,
            name: req.name.clone(),
            description: req.description.clone(),
            references_camp_id: req.references_camp_id,
        },
    )
    .await
    .map_err(Status::from)?;
    Ok(Json(CreatedResponse { id }))
}

#[instrument(skip(pool, user))]
#[get("/camps?<student_id>")]
pub async fn api_list_camps(
    user: User,
    student_id: i64,
    pool: &State<Pool<Sqlite>>,
) -> Result<Json<CampListResponse>, Status> {
    let is_coach = user.has_permission(Permission::ViewAllStudents);
    if !is_coach && student_id != user.id {
        return Err(Status::Forbidden);
    }
    let camps = list_camp_summaries_for_student(pool.inner(), student_id, true)
        .await
        .map_err(Status::from)?;
    Ok(Json(CampListResponse { camps }))
}

#[instrument(skip(pool, user))]
#[get("/camps/<id>")]
pub async fn api_get_camp(
    id: i64,
    user: User,
    pool: &State<Pool<Sqlite>>,
) -> Result<Json<CampDetailResponse>, Status> {
    let pool = pool.inner();
    let camp = get_camp(pool, id)
        .await
        .map_err(Status::from)?
        .ok_or(Status::NotFound)?;
    if !can_read(&user, &camp) {
        return Err(Status::Forbidden);
    }
    let techniques = list_camp_techniques(pool, id)
        .await
        .map_err(Status::from)?;

    // Resolve competition name + registration id when camp is linked to a comp.
    let (competition_name, registration_id) = if let Some(comp_id) = camp.competition_id {
        let comp_name = get_competition(pool, comp_id)
            .await
            .map_err(Status::from)?
            .map(|c| c.name);
        // Only expose the registration_id for an ACTIVE registration: a
        // soft-unregistered student must not get the match-logging surface.
        let reg_id = registration_for(pool, camp.student_id, comp_id)
            .await
            .map_err(Status::from)?
            .filter(|r| r.unregistered_at.is_none())
            .map(|r| r.id);
        (comp_name, reg_id)
    } else {
        (None, None)
    };

    // Resolve the referenced camp name when this camp builds on a prior one.
    let references_camp_name = if let Some(ref_id) = camp.references_camp_id {
        get_camp(pool, ref_id)
            .await
            .map_err(Status::from)?
            .map(|c| c.name)
    } else {
        None
    };

    Ok(Json(CampDetailResponse {
        id: camp.id,
        student_id: camp.student_id,
        coach_id: camp.coach_id,
        name: camp.name,
        description: camp.description,
        created_at: camp.created_at,
        archived_at: camp.archived_at,
        techniques,
        competition_id: camp.competition_id,
        competition_name,
        registration_id,
        references_camp_id: camp.references_camp_id,
        references_camp_name,
    }))
}

#[instrument(skip(req, pool, user))]
#[put("/camps/<id>", data = "<req>")]
pub async fn api_update_camp(
    id: i64,
    user: User,
    req: Json<UpdateCampRequest>,
    pool: &State<Pool<Sqlite>>,
) -> Result<Status, Status> {
    require_camps(&user)?;
    update_camp(pool.inner(), id, &req.name, req.description.as_deref())
        .await
        .map_err(|e| match e {
            crate::error::AppError::NotFound(_) => Status::NotFound,
            other => Status::from(other),
        })?;
    Ok(Status::NoContent)
}

#[instrument(skip(pool, user))]
#[post("/camps/<id>/archive")]
pub async fn api_archive_camp(
    id: i64,
    user: User,
    pool: &State<Pool<Sqlite>>,
) -> Result<Status, Status> {
    require_camps(&user)?;
    archive_camp(pool.inner(), id, user.id)
        .await
        .map_err(|e| match e {
            crate::error::AppError::NotFound(_) => Status::NotFound,
            other => Status::from(other),
        })?;
    Ok(Status::NoContent)
}

#[instrument(skip(req, pool, user))]
#[post("/camps/<id>/techniques", data = "<req>")]
pub async fn api_add_camp_technique(
    id: i64,
    user: User,
    req: Json<AddTechniqueRequest>,
    pool: &State<Pool<Sqlite>>,
) -> Result<Status, Status> {
    require_camps(&user)?;
    add_camp_technique(pool.inner(), id, req.technique_id, user.id)
        .await
        .map_err(|e| match e {
            crate::error::AppError::NotFound(_) => Status::NotFound,
            other => Status::from(other),
        })?;
    Ok(Status::NoContent)
}

/// CC-009/010: Create a brand-new technique and immediately add it to the camp.
///
/// `scope = "global"` → technique joins the global library (CC-009).
/// `scope = "scoped"` → technique is visible only inside this camp (CC-010).
///
/// Returns `{id: <technique_id>}` on success. Requires `ManageCamps`.
#[instrument(skip(req, pool, user))]
#[post("/camps/<id>/techniques/create", data = "<req>")]
pub async fn api_create_camp_technique(
    id: i64,
    user: User,
    req: Json<CreateCampTechniqueRequest>,
    pool: &State<Pool<Sqlite>>,
) -> Result<Json<CreatedResponse>, Status> {
    require_camps(&user)?;

    let name = req.name.trim();
    let description = req.description.trim();
    if name.is_empty() {
        return Err(Status::UnprocessableEntity);
    }

    let scope = match req.scope.as_str() {
        "global" => TechniqueScope::Global,
        "scoped" => TechniqueScope::Scoped,
        _ => return Err(Status::UnprocessableEntity),
    };

    let technique_id =
        create_camp_technique_new(pool.inner(), id, name, description, scope, user.id)
            .await
            .map_err(|e| match e {
                crate::error::AppError::NotFound(_) => Status::NotFound,
                other => Status::from(other),
            })?;

    Ok(Json(CreatedResponse { id: technique_id }))
}

#[instrument(skip(pool, user))]
#[delete("/camps/<id>/techniques/<technique_id>")]
pub async fn api_remove_camp_technique(
    id: i64,
    technique_id: i64,
    user: User,
    pool: &State<Pool<Sqlite>>,
) -> Result<Status, Status> {
    require_camps(&user)?;
    remove_camp_technique(pool.inner(), id, technique_id)
        .await
        .map_err(Status::from)?;
    Ok(Status::NoContent)
}

#[derive(Serialize)]
pub struct CampVideosResponse {
    pub videos: Vec<Video>,
}

/// Lists alive, non-hidden videos owned by a camp.
/// Accessible to the camp's student and to any coach.
#[instrument(skip(pool, user))]
#[get("/camps/<id>/videos")]
pub async fn api_list_camp_videos(
    id: i64,
    user: User,
    pool: &State<Pool<Sqlite>>,
) -> Result<Json<CampVideosResponse>, Status> {
    let pool = pool.inner();
    let camp = get_camp(pool, id)
        .await
        .map_err(Status::from)?
        .ok_or(Status::NotFound)?;
    if !can_read(&user, &camp) {
        return Err(Status::Forbidden);
    }
    let videos = list_videos_for_camp(pool, id)
        .await
        .map_err(Status::from)?;
    Ok(Json(CampVideosResponse { videos }))
}

/// CC-015: Set a per-camp visibility override for a video.
///
/// `PUT /api/camps/<camp_id>/videos/<video_id>/visibility`
/// Body: `{"visible": bool}`
///
/// `visible=false` hides the video from the camp list for students without
/// affecting its visibility in any other context (library, technique list,
/// other camps). `visible=true` force-shows a globally-hidden video in this
/// camp's list. Requires `ManageCamps`.
#[derive(Deserialize)]
pub struct SetCampVideoVisibilityRequest {
    pub visible: bool,
}

#[instrument(skip(pool, body, user))]
#[put("/camps/<camp_id>/videos/<video_id>/visibility", data = "<body>")]
pub async fn api_set_camp_video_visibility(
    camp_id: i64,
    video_id: i64,
    body: Json<SetCampVideoVisibilityRequest>,
    user: User,
    pool: &State<Pool<Sqlite>>,
) -> Result<Status, Status> {
    require_camps(&user)?;
    set_video_camp_visibility(pool.inner(), video_id, camp_id, body.visible, user.id)
        .await
        .map_err(Status::from)?;
    Ok(Status::NoContent)
}

#[derive(Deserialize)]
pub struct PromotePinnedToCampRequest {
    pub camp_id: i64,
}

/// Coach-only: promote a pinned technique into one of the student's camps.
/// Verifies:
///   - the technique is actually pinned for `student_id` (404 if not)
///   - the camp belongs to `student_id` (400 if not)
/// Then calls `add_camp_technique` (idempotent) and returns 204.
/// Notes are already shared by (student, technique) so they surface in the
/// camp automatically; no thread/comment relinking is needed for Slice 3.
#[instrument(skip(req, pool, user))]
#[post("/students/<student_id>/pinned/<technique_id>/promote", data = "<req>")]
pub async fn api_promote_pinned_to_camp(
    student_id: i64,
    technique_id: i64,
    user: User,
    req: Json<PromotePinnedToCampRequest>,
    pool: &State<Pool<Sqlite>>,
) -> Result<Status, Status> {
    require_camps(&user)?;
    let pool = pool.inner();

    // Guard 1: technique must be pinned for this student.
    if !is_technique_pinned(pool, student_id, technique_id).await? {
        return Err(Status::NotFound);
    }

    // Guard 2: the target camp must belong to this student.
    let camp = get_camp(pool, req.camp_id)
        .await
        .map_err(Status::from)?
        .ok_or(Status::NotFound)?;
    if camp.student_id != student_id {
        return Err(Status::BadRequest);
    }

    add_camp_technique(pool, req.camp_id, technique_id, user.id)
        .await
        .map_err(Status::from)?;

    Ok(Status::NoContent)
}
