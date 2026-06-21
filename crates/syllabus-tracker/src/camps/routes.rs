use rocket::State;
use rocket::http::Status;
use rocket::serde::{Deserialize, Serialize, json::Json};
use sqlx::{Pool, Sqlite};
use tracing::{instrument, warn};

use crate::api::{ActivityFeedQuery, ACTIVITY_FEED_DEFAULT_LIMIT, ACTIVITY_FEED_MAX_LIMIT, parse_before_ts};
use crate::auth::{Permission, User};
use crate::db::ActivityRow;
use crate::db::camps::{
    add_camp_technique, add_camp_technique_video, archive_camp, attach_video_to_technique,
    create_camp, create_camp_technique_new, get_camp, list_camp_summaries_for_student,
    list_camp_technique_videos, list_camp_techniques, remove_camp_technique, update_camp, Camp,
    CampSummary, CampTechnique, NewCamp, TechniqueScope,
};
use crate::db::{feed, list_videos_for_camp, set_video_camp_visibility};
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

/// Body for `POST /api/camps/<camp_id>/techniques/<technique_id>/videos`.
#[derive(Deserialize)]
pub struct AddCampTechniqueVideoRequest {
    pub video_id: i64,
    /// `"camp_only"` → reference footage surfaced only inside this camp's view
    /// of the technique (does not leak to the global technique list).
    /// `"global"`    → attach as a normal technique video, visible everywhere
    /// the technique appears.
    pub scope: String,
}

/// Coach-only: add a video to a technique WITHIN a camp.
///
/// `scope = "camp_only"` → pin the (existing) video as camp-only reference
///   footage via `camp_technique_referenced_videos` (idempotent). The video is
///   NOT added to the global technique-video list.
/// `scope = "global"`    → attach the video to the technique as a normal
///   technique video (parent_kind='technique'); it then appears everywhere the
///   technique appears. No camp_technique_referenced_videos row is written.
///
/// Requires `ManageCamps` (technique authoring is coach-only; students upload
/// to the camp itself via the separate camp-upload route). The technique must
/// be attached to the camp.
#[instrument(skip(req, pool, user))]
#[post("/camps/<camp_id>/techniques/<technique_id>/videos", data = "<req>")]
pub async fn api_add_camp_technique_video(
    camp_id: i64,
    technique_id: i64,
    user: User,
    req: Json<AddCampTechniqueVideoRequest>,
    pool: &State<Pool<Sqlite>>,
) -> Result<Status, Status> {
    require_camps(&user)?;
    let pool = pool.inner();

    // The technique must be a member of this camp. This also implicitly
    // confirms the camp exists (no membership row otherwise).
    let is_member = sqlx::query_scalar!(
        r#"SELECT EXISTS(
              SELECT 1 FROM camp_techniques
              WHERE camp_id = ? AND technique_id = ?
           ) AS "e!: i64""#,
        camp_id,
        technique_id,
    )
    .fetch_one(pool)
    .await
    .map_err(|_| Status::InternalServerError)?;
    if is_member == 0 {
        return Err(Status::NotFound);
    }

    match req.scope.as_str() {
        "camp_only" => {
            add_camp_technique_video(pool, camp_id, technique_id, req.video_id)
                .await
                .map_err(Status::from)?;
        }
        "global" => {
            attach_video_to_technique(pool, camp_id, req.video_id, technique_id)
                .await
                .map_err(Status::from)?;
        }
        _ => return Err(Status::UnprocessableEntity),
    }

    Ok(Status::NoContent)
}

/// Lists the camp-only reference videos pinned to a technique within a camp:
/// the `videos` rows joined via `camp_technique_referenced_videos`. This returns
/// ONLY the camp-only refs (NOT the global technique videos, which the frontend
/// fetches separately). Soft-deleted videos are excluded.
///
/// Readable by a coach OR the camp's own student (same `can_read` rule as the
/// other camp reads). The technique need not be a member: a non-member simply
/// has no referenced-video rows and yields an empty list.
#[instrument(skip(pool, user))]
#[get("/camps/<camp_id>/techniques/<technique_id>/videos")]
pub async fn api_list_camp_technique_videos(
    camp_id: i64,
    technique_id: i64,
    user: User,
    pool: &State<Pool<Sqlite>>,
) -> Result<Json<CampVideosResponse>, Status> {
    let pool = pool.inner();
    let camp = get_camp(pool, camp_id)
        .await
        .map_err(Status::from)?
        .ok_or(Status::NotFound)?;
    if !can_read(&user, &camp) {
        return Err(Status::Forbidden);
    }
    let videos = list_camp_technique_videos(pool, camp_id, technique_id)
        .await
        .map_err(Status::from)?;
    Ok(Json(CampVideosResponse { videos }))
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

/// `GET /api/camps/<camp_id>/feed?before_ts=&before_id=&limit=`
///
/// Returns the activity feed sliced to the given camp. Authorized for the
/// camp's own student OR any coach (ManageCamps). Does NOT advance the
/// viewer's activity cursor (read-only scoped view; the student's global
/// cursor is advanced by the main `/api/activity/feed` endpoint).
#[instrument(skip(params, pool, user))]
#[get("/camps/<camp_id>/feed?<params..>")]
pub async fn api_camp_feed(
    camp_id: i64,
    params: ActivityFeedQuery,
    user: User,
    pool: &State<Pool<Sqlite>>,
) -> Result<Json<Vec<ActivityRow>>, Status> {
    let pool = pool.inner();
    let camp = get_camp(pool, camp_id)
        .await
        .map_err(Status::from)?
        .ok_or(Status::NotFound)?;
    let is_coach = user.has_permission(Permission::ManageCamps);
    if !is_coach && user.id != camp.student_id {
        return Err(Status::Forbidden);
    }

    let limit = params
        .limit
        .unwrap_or(ACTIVITY_FEED_DEFAULT_LIMIT)
        .clamp(1, ACTIVITY_FEED_MAX_LIMIT);

    let before = match (&params.before_ts, params.before_id) {
        (Some(ts_str), Some(id)) => {
            let ts = parse_before_ts(ts_str).ok_or_else(|| {
                warn!(
                    raw = ts_str,
                    "rejected camps/feed: unparseable before_ts"
                );
                Status::BadRequest
            })?;
            Some((ts, id))
        }
        (None, None) => None,
        _ => {
            warn!(
                "rejected camps/feed: partial cursor (before_ts and before_id must both be present or both absent)"
            );
            return Err(Status::BadRequest);
        }
    };

    // Use the student role so the feed query is scoped to the camp's student
    // (target_student_id = camp.student_id). The camp_id filter then narrows
    // it further to only rows for this specific camp.
    let rows = feed(
        pool,
        camp.student_id,
        crate::auth::Role::Student,
        before,
        limit,
        Some(camp_id),
    )
    .await
    .map_err(Status::from)?;

    Ok(Json(rows))
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
