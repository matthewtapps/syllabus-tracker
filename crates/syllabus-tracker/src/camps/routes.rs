use rocket::State;
use rocket::http::Status;
use rocket::serde::{Deserialize, Serialize, json::Json};
use sqlx::{Pool, Sqlite};
use tracing::instrument;

use crate::auth::{Permission, User};
use crate::db::camps::{
    add_camp_technique, archive_camp, create_camp, get_camp, list_camp_techniques,
    list_camps_for_student, remove_camp_technique, update_camp, Camp, CampTechnique, NewCamp,
};
use crate::db::list_videos_for_camp;
use crate::models::Video;

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

#[derive(Serialize)]
pub struct CreatedResponse {
    pub id: i64,
}

#[derive(Serialize)]
pub struct CampListResponse {
    pub camps: Vec<Camp>,
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
    let camps = list_camps_for_student(pool.inner(), student_id, true)
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
    Ok(Json(CampDetailResponse {
        id: camp.id,
        student_id: camp.student_id,
        coach_id: camp.coach_id,
        name: camp.name,
        description: camp.description,
        created_at: camp.created_at,
        archived_at: camp.archived_at,
        techniques,
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
