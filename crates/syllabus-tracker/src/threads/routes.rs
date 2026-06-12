use rocket::State;
use rocket::http::Status;
use rocket::serde::{Deserialize, Serialize, json::Json};
use sqlx::{Pool, Sqlite};
use tracing::instrument;

use crate::auth::{Permission, User};
use crate::db::threads::{
    Anchor, AnchorKind, NewThread, ThreadView, ThreadVisibility, create_comment, create_thread,
    get_thread, list_threads_for_anchor, soft_delete_comment, soft_delete_thread, Viewer,
};

fn viewer_for(user: &User) -> Viewer {
    Viewer { user_id: user.id, is_coach: user.has_permission(Permission::ViewAllStudents) }
}

#[derive(Deserialize)]
pub struct CreateThreadRequest {
    pub anchor_kind: String,
    pub anchor_id: i64,
    pub video_ts_seconds: Option<i64>,
    pub pinned_student_id: Option<i64>,
    pub visibility: String,
    pub scope_student_id: Option<i64>,
    pub body: String,
}

#[derive(Serialize)]
pub struct CreatedResponse { pub id: i64 }

#[derive(Serialize)]
pub struct ThreadListResponse { pub threads: Vec<ThreadView> }

#[derive(Deserialize)]
pub struct CreateCommentRequest {
    pub parent_comment_id: Option<i64>,
    pub body: String,
}

fn parse_kind(s: &str) -> Result<AnchorKind, Status> {
    AnchorKind::from_str_kind(s).ok_or(Status::BadRequest)
}
fn parse_visibility(s: &str) -> Result<ThreadVisibility, Status> {
    match s {
        "private" => Ok(ThreadVisibility::Private),
        "broadcast" => Ok(ThreadVisibility::Broadcast),
        _ => Err(Status::BadRequest),
    }
}

#[instrument(skip(req, pool, user))]
#[post("/threads", data = "<req>")]
pub async fn api_create_thread(
    user: User,
    req: Json<CreateThreadRequest>,
    pool: &State<Pool<Sqlite>>,
) -> Result<Json<CreatedResponse>, Status> {
    let pool = pool.inner();
    let kind = parse_kind(&req.anchor_kind)?;
    let visibility = parse_visibility(&req.visibility)?;

    if visibility == ThreadVisibility::Broadcast {
        user.require_permission(Permission::BroadcastLibraryComment).map_err(|_| Status::Forbidden)?;
    }

    let is_coach = user.has_permission(Permission::ViewAllStudents);
    if !is_coach {
        let own_profile = kind == AnchorKind::StudentProfile && req.anchor_id == user.id;
        let own_scope = visibility == ThreadVisibility::Private && req.scope_student_id == Some(user.id);
        let global_anchor = kind.allows_broadcast();
        if !(own_profile || (global_anchor && own_scope)) {
            return Err(Status::Forbidden);
        }
    }

    let id = create_thread(pool, NewThread {
        author_id: user.id,
        anchor: Anchor { kind, id: req.anchor_id, video_ts_seconds: req.video_ts_seconds, pinned_student_id: req.pinned_student_id },
        visibility,
        scope_student_id: req.scope_student_id,
        body: req.body.clone(),
    }).await.map_err(|_| Status::BadRequest)?;
    Ok(Json(CreatedResponse { id }))
}

#[instrument(skip(pool, user))]
#[get("/threads?<anchor_kind>&<anchor_id>")]
pub async fn api_list_threads(
    user: User,
    anchor_kind: String,
    anchor_id: i64,
    pool: &State<Pool<Sqlite>>,
) -> Result<Json<ThreadListResponse>, Status> {
    let pool = pool.inner();
    let kind = parse_kind(&anchor_kind)?;
    let threads = list_threads_for_anchor(
        pool,
        Anchor { kind, id: anchor_id, video_ts_seconds: None, pinned_student_id: None },
        viewer_for(&user),
    ).await.map_err(|_| Status::BadRequest)?;
    Ok(Json(ThreadListResponse { threads }))
}

#[instrument(skip(req, pool, user))]
#[post("/threads/<id>/comments", data = "<req>")]
pub async fn api_create_comment(
    id: i64,
    user: User,
    req: Json<CreateCommentRequest>,
    pool: &State<Pool<Sqlite>>,
) -> Result<Json<CreatedResponse>, Status> {
    let pool = pool.inner();
    let visible = get_thread(pool, id, viewer_for(&user)).await.map_err(|_| Status::InternalServerError)?;
    if visible.is_none() {
        return Err(Status::NotFound);
    }
    let comment_id = create_comment(pool, id, req.parent_comment_id, user.id, &req.body)
        .await.map_err(|_| Status::BadRequest)?;
    Ok(Json(CreatedResponse { id: comment_id }))
}

#[instrument(skip(pool, user))]
#[delete("/threads/<id>")]
pub async fn api_delete_thread(
    id: i64,
    user: User,
    pool: &State<Pool<Sqlite>>,
) -> Result<Status, Status> {
    let pool = pool.inner();
    let thread = get_thread(pool, id, viewer_for(&user)).await
        .map_err(|_| Status::InternalServerError)?
        .ok_or(Status::NotFound)?;
    let is_author = thread.author_id == user.id;
    let can_moderate = user.has_permission(Permission::ManageThreads);
    if !is_author && !can_moderate {
        return Err(Status::Forbidden);
    }
    soft_delete_thread(pool, id, user.id).await.map_err(|_| Status::InternalServerError)?;
    Ok(Status::NoContent)
}

#[instrument(skip(pool, user))]
#[delete("/comments/<id>")]
pub async fn api_delete_comment(
    id: i64,
    user: User,
    pool: &State<Pool<Sqlite>>,
) -> Result<Status, Status> {
    let pool = pool.inner();
    let row = sqlx::query!(
        r#"SELECT author_id AS "author_id!: i64", thread_id AS "thread_id!: i64"
           FROM thread_comments WHERE id = ?"#,
        id
    )
    .fetch_optional(pool)
    .await
    .map_err(|_| Status::InternalServerError)?
    .ok_or(Status::NotFound)?;

    let is_author = row.author_id == user.id;
    let can_moderate = user.has_permission(Permission::ManageThreads);
    if !is_author && !can_moderate {
        return Err(Status::Forbidden);
    }
    soft_delete_comment(pool, id, user.id).await.map_err(|_| Status::InternalServerError)?;
    Ok(Status::NoContent)
}
