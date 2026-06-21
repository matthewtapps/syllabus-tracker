use rocket::FromForm;
use rocket::State;
use rocket::http::Status;
use rocket::serde::{Deserialize, Serialize, json::Json};
use sqlx::{Pool, Sqlite};
use tracing::{instrument, warn};

use crate::api::{ActivityFeedQuery, ACTIVITY_FEED_DEFAULT_LIMIT, ACTIVITY_FEED_MAX_LIMIT, parse_before_ts};
use crate::auth::{Permission, User};
use crate::db::ActivityRow;
use crate::db::camps::{
    archive_camp, create_camp, create_camp_technique_new, get_camp, list_camp_summaries_for_student,
    search_camp_techniques, search_camp_threads, search_camp_videos,
    update_camp, Camp, CampSummary, CampTechniqueHit, CampThreadHit, CampVideoHit, NewCamp, TechniqueScope,
};
use crate::db::{feed, list_videos_for_camp, set_video_camp_visibility};
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

    Ok(Json(CampDetailResponse {
        id: camp.id,
        student_id: camp.student_id,
        coach_id: camp.coach_id,
        name: camp.name,
        description: camp.description,
        created_at: camp.created_at,
        archived_at: camp.archived_at,
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

/// CC-009/010: Create a brand-new technique and return its id.
///
/// `scope = "global"` → technique joins the global library (CC-009).
/// `scope = "scoped"` → technique is visible only inside this camp (CC-010).
///
/// Returns `{id: <technique_id>}` on success. The caller must separately post
/// a camp_technique THREAD so the technique appears in the camp feed.
/// Requires `ManageCamps`.
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

// ---------------------------------------------------------------------------
// Camp search (Phase 4)
// ---------------------------------------------------------------------------

#[derive(FromForm)]
pub struct CampSearchParams {
    pub q: Option<String>,
    /// Narrow to one group: `technique` | `video` | `thread`.
    pub kind: Option<String>,
}

#[derive(Serialize)]
pub struct CampSearchResponse {
    pub techniques: Vec<CampTechniqueHit>,
    pub videos: Vec<CampVideoHit>,
    pub threads: Vec<CampThreadHit>,
}

/// `GET /api/camps/<camp_id>/search?q=<str>&kind=<optional>`
///
/// Searches within a single camp across three surfaces:
/// - `techniques`: camp_technique threads whose anchored technique name matches.
/// - `videos`: camp-owned footage or thread-attached videos whose title matches.
/// - `threads`: root-post and comment bodies that match.
///
/// Authorization: coach (`ManageCamps`) OR the camp's own student.
/// Empty `q` → returns empty groups.
#[instrument(skip(params, pool, user))]
#[get("/camps/<camp_id>/search?<params..>")]
pub async fn api_camp_search(
    camp_id: i64,
    params: CampSearchParams,
    user: User,
    pool: &State<Pool<Sqlite>>,
) -> Result<Json<CampSearchResponse>, Status> {
    let pool = pool.inner();
    let camp = get_camp(pool, camp_id)
        .await
        .map_err(Status::from)?
        .ok_or(Status::NotFound)?;
    let is_coach = user.has_permission(Permission::ManageCamps);
    if !is_coach && user.id != camp.student_id {
        return Err(Status::Forbidden);
    }

    let q = params.q.as_deref().unwrap_or("").trim().to_lowercase();

    // Empty query — return empty groups immediately.
    if q.is_empty() {
        return Ok(Json(CampSearchResponse {
            techniques: vec![],
            videos: vec![],
            threads: vec![],
        }));
    }

    let kind = params.kind.as_deref();

    let techniques = if kind.is_none() || kind == Some("technique") {
        search_camp_techniques(pool, camp_id, &q)
            .await
            .map_err(Status::from)?
    } else {
        vec![]
    };

    let videos = if kind.is_none() || kind == Some("video") {
        search_camp_videos(pool, camp_id, &q)
            .await
            .map_err(Status::from)?
    } else {
        vec![]
    };

    let threads = if kind.is_none() || kind == Some("thread") {
        search_camp_threads(pool, camp_id, &q)
            .await
            .map_err(Status::from)?
    } else {
        vec![]
    };

    Ok(Json(CampSearchResponse {
        techniques,
        videos,
        threads,
    }))
}
