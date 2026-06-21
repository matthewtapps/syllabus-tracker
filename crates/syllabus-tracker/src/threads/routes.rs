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
    /// Only for `camp_technique`: the camp the technique discussion belongs to.
    pub camp_id: Option<i64>,
    pub body: String,
    /// Optional video to attach to the root post.
    pub attached_video_id: Option<i64>,
    /// `true` to link an existing video by reference (no reparent). Defaults
    /// to `false` (existing draft-upload behaviour).
    pub attached_video_is_reference: Option<bool>,
    /// Title to backfill onto the referenced video when its title is empty.
    /// Ignored when `attached_video_is_reference` is false.
    pub attached_video_title: Option<String>,
}

#[derive(Serialize)]
pub struct CreatedResponse { pub id: i64 }

#[derive(Serialize)]
pub struct ThreadListResponse { pub threads: Vec<ThreadView> }

#[derive(Deserialize)]
pub struct CreateCommentRequest {
    pub parent_comment_id: Option<i64>,
    pub body: String,
    /// Optional video to attach to this comment.
    pub video_id: Option<i64>,
    /// `true` to link an existing video by reference (no reparent). Defaults
    /// to `false` (existing draft-upload behaviour).
    pub video_is_reference: Option<bool>,
    /// Optional timestamp (seconds) into the thread's attached video that this
    /// comment is pinned to. NULL means a whole-video reply.
    pub video_ts_seconds: Option<i64>,
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
    let requested_visibility = parse_visibility(&req.visibility)?;
    let is_coach = user.has_permission(Permission::ViewAllStudents);

    // Camp and camp_technique anchors are inherently scoped to the camp's
    // student; the route, not the client, owns the "always private, scoped to
    // the camp's student" invariant. A coach OR the camp's own student may start
    // one; any other user is forbidden. These resolve BEFORE the broadcast
    // permission guard so a student sending broadcast on a camp anchor gets the
    // right outcome (forced private), not a misfiring broadcast 403.
    let (visibility, scope_student_id) = match kind {
        AnchorKind::Camp => {
            let camp_student = sqlx::query_scalar!(
                "SELECT student_id FROM camps WHERE id = ?", req.anchor_id
            )
            .fetch_optional(pool).await.map_err(|_| Status::InternalServerError)?
            .ok_or(Status::NotFound)?;
            if !is_coach && user.id != camp_student {
                return Err(Status::Forbidden);
            }
            (ThreadVisibility::Private, Some(camp_student))
        }
        AnchorKind::CampTechnique => {
            let camp_id = req.camp_id.ok_or(Status::BadRequest)?;
            let camp_student = sqlx::query_scalar!(
                "SELECT student_id FROM camps WHERE id = ?", camp_id
            )
            .fetch_optional(pool).await.map_err(|_| Status::InternalServerError)?
            .ok_or(Status::NotFound)?;
            if !is_coach && user.id != camp_student {
                return Err(Status::Forbidden);
            }
            (ThreadVisibility::Private, Some(camp_student))
        }
        _ => {
            // Non-camp anchors honour the requested visibility, so the broadcast
            // permission guard applies to them (and only them).
            if requested_visibility == ThreadVisibility::Broadcast {
                user.require_permission(Permission::BroadcastLibraryComment)
                    .map_err(|_| Status::Forbidden)?;
            }
            (requested_visibility, req.scope_student_id)
        }
    };

    let is_camp_anchor = matches!(kind, AnchorKind::Camp | AnchorKind::CampTechnique);
    if !is_coach && !is_camp_anchor {
        let own_profile = kind == AnchorKind::StudentProfile && req.anchor_id == user.id;
        let own_scope = visibility == ThreadVisibility::Private && scope_student_id == Some(user.id);
        let global_anchor = kind.allows_broadcast();
        if !(own_profile || (global_anchor && own_scope)) {
            return Err(Status::Forbidden);
        }
    }

    // Attaching a video is coach-only, except on a camp surface the student owns
    // (the only surface a student can add videos to at all). The camp's student
    // is `scope_student_id` here.
    if req.attached_video_id.is_some() {
        let can_attach = user.has_permission(Permission::UploadVideos)
            || (is_camp_anchor && scope_student_id == Some(user.id));
        if !can_attach {
            return Err(Status::Forbidden);
        }
    }

    let id = create_thread(pool, NewThread {
        author_id: user.id,
        anchor: Anchor { kind, id: req.anchor_id, video_ts_seconds: req.video_ts_seconds, pinned_student_id: req.pinned_student_id, camp_id: req.camp_id },
        visibility,
        scope_student_id,
        body: req.body.clone(),
        attached_video_id: req.attached_video_id,
        attached_video_is_reference: req.attached_video_is_reference.unwrap_or(false),
        attached_video_title: req.attached_video_title.clone(),
    }).await.map_err(|e| { e.log_and_record("api_create_thread"); Status::BadRequest })?;
    Ok(Json(CreatedResponse { id }))
}

#[instrument(skip(pool, user))]
#[get("/threads?<anchor_kind>&<anchor_id>&<camp_id>")]
pub async fn api_list_threads(
    user: User,
    anchor_kind: String,
    anchor_id: i64,
    camp_id: Option<i64>,
    pool: &State<Pool<Sqlite>>,
) -> Result<Json<ThreadListResponse>, Status> {
    let pool = pool.inner();
    let kind = parse_kind(&anchor_kind)?;
    // `camp_id` only applies to the camp_technique list (camp + technique pair);
    // every other anchor kind ignores it so the global library list stays
    // constrained to anchor_kind='technique'.
    let camp_id = if kind == AnchorKind::CampTechnique { camp_id } else { None };
    let threads = list_threads_for_anchor(
        pool,
        Anchor { kind, id: anchor_id, video_ts_seconds: None, pinned_student_id: None, camp_id },
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
    // Attaching a video is coach-only, except on a camp-scoped thread the student
    // owns (its `scope_student_id` is the camp's student).
    if req.video_id.is_some() && !user.has_permission(Permission::UploadVideos) {
        let trow = sqlx::query!(
            r#"SELECT anchor_kind, scope_student_id AS "ssid?: i64"
               FROM threads WHERE id = ?"#,
            id
        )
        .fetch_optional(pool)
        .await
        .map_err(|_| Status::InternalServerError)?
        .ok_or(Status::NotFound)?;
        let camp_ok = matches!(trow.anchor_kind.as_str(), "camp" | "camp_technique")
            && trow.ssid == Some(user.id);
        if !camp_ok {
            return Err(Status::Forbidden);
        }
    }
    let comment_id = create_comment(
        pool,
        id,
        req.parent_comment_id,
        user.id,
        &req.body,
        req.video_id,
        req.video_ts_seconds,
        req.video_is_reference.unwrap_or(false),
    )
    .await
    .map_err(|_| Status::BadRequest)?;
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
