//! HTTP routes for the syllabus stack: syllabus CRUD + technique
//! membership, assignment lifecycle, per-student syllabus reads, SST
//! mutation, syllabus attempts, per-syllabus video reads.

use chrono::{DateTime, NaiveDateTime, Utc};
use rocket::State;
use rocket::http::Status;
use rocket::serde::json::Json;
use serde::{Deserialize, Serialize};
use sqlx::{Pool, Sqlite};
use validator::Validate;

use crate::auth::{Permission, User};
use crate::db;
use crate::db::{PropagationMode, SstUpdate, SyllabusAttemptUpdate};

type ApiResult<T> = Result<T, crate::api::ApiError>;

fn parse_iso(value: &str) -> Result<NaiveDateTime, Status> {
    DateTime::parse_from_rfc3339(value)
        .map(|dt| dt.with_timezone(&Utc).naive_utc())
        .map_err(|_| Status::BadRequest)
}

#[derive(Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PropagationParam {
    SyllabusOnly,
    Cascade,
}

impl From<PropagationParam> for PropagationMode {
    fn from(p: PropagationParam) -> Self {
        match p {
            PropagationParam::SyllabusOnly => PropagationMode::SyllabusOnly,
            PropagationParam::Cascade => PropagationMode::Cascade,
        }
    }
}

// ============================================================
// Syllabus CRUD
// ============================================================

#[get("/syllabi")]
pub async fn api_list_syllabi(
    user: User,
    db: &State<Pool<Sqlite>>,
) -> ApiResult<Json<Vec<db::Syllabus>>> {
    user.require_permission(Permission::ManageSyllabi)?;
    let rows = db::list_syllabi(db).await?;
    Ok(Json(rows))
}

#[derive(Deserialize, Validate)]
pub struct CreateSyllabusRequest {
    #[validate(length(min = 1, max = 100, message = "Name must be 1-100 characters"))]
    pub name: String,
    #[validate(length(max = 1000, message = "Description is too long"))]
    pub description: Option<String>,
}

#[derive(Serialize)]
pub struct SyllabusIdResponse {
    pub id: i64,
}

#[post("/syllabi", data = "<body>")]
pub async fn api_create_syllabus(
    user: User,
    body: Json<CreateSyllabusRequest>,
    db: &State<Pool<Sqlite>>,
) -> ApiResult<Json<SyllabusIdResponse>> {
    user.require_permission(Permission::ManageSyllabi)?;
    body.validate()?;
    let id = db::create_syllabus(db, &body.name, body.description.as_deref(), user.id).await?;
    Ok(Json(SyllabusIdResponse { id }))
}

#[derive(Serialize)]
pub struct SyllabusDetailResponse {
    #[serde(flatten)]
    pub syllabus: db::Syllabus,
    pub techniques: Vec<db::SyllabusTechniqueRow>,
}

#[get("/syllabi/<sid>/students")]
pub async fn api_list_syllabus_students(
    sid: i64,
    user: User,
    db: &State<Pool<Sqlite>>,
) -> ApiResult<Json<Vec<i64>>> {
    user.require_permission(Permission::ManageSyllabi)?;
    let ids = db::list_students_assigned_to_syllabus(db, sid).await?;
    Ok(Json(ids))
}

#[get("/syllabi/<sid>")]
pub async fn api_get_syllabus(
    sid: i64,
    user: User,
    db: &State<Pool<Sqlite>>,
) -> ApiResult<Json<SyllabusDetailResponse>> {
    user.require_permission(Permission::ManageSyllabi)?;
    let syllabus = db::get_syllabus(db, sid).await?.ok_or(Status::NotFound)?;
    let techniques = db::list_syllabus_techniques(db, sid).await?;
    Ok(Json(SyllabusDetailResponse {
        syllabus,
        techniques,
    }))
}

#[derive(Deserialize, Validate)]
pub struct UpdateSyllabusRequest {
    #[validate(length(min = 1, max = 100, message = "Name must be 1-100 characters"))]
    pub name: Option<String>,
    pub description: Option<Option<String>>,
}

#[patch("/syllabi/<sid>", data = "<body>")]
pub async fn api_update_syllabus(
    sid: i64,
    user: User,
    body: Json<UpdateSyllabusRequest>,
    db: &State<Pool<Sqlite>>,
) -> ApiResult<Status> {
    user.require_permission(Permission::ManageSyllabi)?;
    body.validate()?;
    db::update_syllabus(
        db,
        sid,
        body.name.as_deref(),
        body.description.as_ref().map(|opt| opt.as_deref()),
    )
    .await?;
    Ok(Status::NoContent)
}

#[delete("/syllabi/<sid>")]
pub async fn api_delete_syllabus(
    sid: i64,
    user: User,
    db: &State<Pool<Sqlite>>,
) -> ApiResult<Status> {
    user.require_permission(Permission::ManageSyllabi)?;
    db::delete_syllabus(db, sid).await?;
    Ok(Status::NoContent)
}

#[derive(Deserialize)]
pub struct AddTechniqueToSyllabusRequest {
    pub technique_id: i64,
    pub propagation: PropagationParam,
}

#[post("/syllabi/<sid>/techniques", data = "<body>")]
pub async fn api_add_technique_to_syllabus(
    sid: i64,
    user: User,
    body: Json<AddTechniqueToSyllabusRequest>,
    db: &State<Pool<Sqlite>>,
) -> ApiResult<Status> {
    user.require_permission(Permission::ManageSyllabi)?;
    let payload = body.into_inner();
    let mode: PropagationMode = payload.propagation.into();
    db::add_technique_to_syllabus(db, sid, payload.technique_id, user.id, mode).await?;
    Ok(Status::NoContent)
}

#[delete("/syllabi/<sid>/techniques/<tid>?<propagation>")]
pub async fn api_remove_technique_from_syllabus(
    sid: i64,
    tid: i64,
    propagation: Option<String>,
    user: User,
    db: &State<Pool<Sqlite>>,
) -> ApiResult<Status> {
    user.require_permission(Permission::ManageSyllabi)?;
    let mode = match propagation.as_deref() {
        Some("cascade") => PropagationMode::Cascade,
        Some("syllabus_only") | None => PropagationMode::SyllabusOnly,
        _ => return Err(Status::BadRequest.into()),
    };
    db::remove_technique_from_syllabus(db, sid, tid, user.id, mode).await?;
    Ok(Status::NoContent)
}

// ============================================================
// Assignment lifecycle
// ============================================================

#[post("/student/<sid>/syllabi/<syid>/assignment")]
pub async fn api_assign_syllabus(
    sid: i64,
    syid: i64,
    user: User,
    db: &State<Pool<Sqlite>>,
) -> ApiResult<Json<SyllabusIdResponse>> {
    user.require_permission(Permission::ManageSyllabi)?;
    let id = db::assign(db, user.id, sid, syid).await?;
    Ok(Json(SyllabusIdResponse { id }))
}

#[delete("/student/<sid>/syllabi/<syid>/assignment")]
pub async fn api_unassign_syllabus(
    sid: i64,
    syid: i64,
    user: User,
    db: &State<Pool<Sqlite>>,
) -> ApiResult<Status> {
    user.require_permission(Permission::ManageSyllabi)?;
    let assignment = db::get_assignment(db, sid, syid)
        .await?
        .ok_or(Status::NotFound)?;
    db::unassign(db, user.id, assignment.id).await?;
    Ok(Status::NoContent)
}

#[derive(Deserialize)]
pub struct GraduateAssignmentRequest {
    pub graduated_at: Option<String>,
}

#[patch("/student/<sid>/syllabi/<syid>/assignment", data = "<body>")]
pub async fn api_set_assignment_graduated(
    sid: i64,
    syid: i64,
    user: User,
    body: Json<GraduateAssignmentRequest>,
    db: &State<Pool<Sqlite>>,
) -> ApiResult<Status> {
    user.require_permission(Permission::ManageSyllabi)?;
    let assignment = db::get_assignment(db, sid, syid)
        .await?
        .ok_or(Status::NotFound)?;
    if body.graduated_at.is_some() {
        db::graduate(db, user.id, assignment.id).await?;
    } else {
        db::ungraduate(db, assignment.id).await?;
    }
    Ok(Status::NoContent)
}

// ============================================================
// Diff view + apply
// ============================================================

#[get("/student/<sid>/syllabi/<syid>/assignment/diff")]
pub async fn api_assignment_diff(
    sid: i64,
    syid: i64,
    user: User,
    db: &State<Pool<Sqlite>>,
) -> ApiResult<Json<db::SyllabusAssignmentDiff>> {
    user.require_permission(Permission::ManageSyllabi)?;
    let assignment = db::get_assignment(db, sid, syid)
        .await?
        .ok_or(Status::NotFound)?;
    let diff = db::diff_for_assignment(db, assignment.id).await?;
    Ok(Json(diff))
}

#[derive(Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum GhostAction {
    ReaddGlobally,
    HideLocally,
    Ignore,
}

#[derive(Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MissingAction {
    AddToStudent,
    Ignore,
}

#[derive(Deserialize)]
pub struct GhostActionEntry {
    pub sst_id: i64,
    pub technique_id: i64,
    pub action: GhostAction,
}

#[derive(Deserialize)]
pub struct MissingActionEntry {
    pub technique_id: i64,
    pub action: MissingAction,
}

#[derive(Deserialize)]
pub struct DiffApplyRequest {
    pub ghost_actions: Vec<GhostActionEntry>,
    pub missing_actions: Vec<MissingActionEntry>,
}

#[derive(Serialize)]
pub struct DiffApplyResponse {
    pub applied: i64,
}

#[post("/student/<sid>/syllabi/<syid>/assignment/diff/apply", data = "<body>")]
pub async fn api_apply_assignment_diff(
    sid: i64,
    syid: i64,
    user: User,
    body: Json<DiffApplyRequest>,
    db: &State<Pool<Sqlite>>,
) -> ApiResult<Json<DiffApplyResponse>> {
    user.require_permission(Permission::ManageSyllabi)?;
    let assignment = db::get_assignment(db, sid, syid)
        .await?
        .ok_or(Status::NotFound)?;

    let mut applied = 0i64;
    for entry in &body.ghost_actions {
        match entry.action {
            GhostAction::ReaddGlobally => {
                db::add_technique_to_syllabus(
                    db,
                    syid,
                    entry.technique_id,
                    user.id,
                    db::PropagationMode::SyllabusOnly,
                )
                .await?;
                applied += 1;
            }
            GhostAction::HideLocally => {
                db::set_hidden(db, user.id, entry.sst_id, true).await?;
                applied += 1;
            }
            GhostAction::Ignore => {}
        }
    }
    for entry in &body.missing_actions {
        match entry.action {
            MissingAction::AddToStudent => {
                db::add_technique_to_assignment(db, assignment.id, entry.technique_id).await?;
                applied += 1;
            }
            MissingAction::Ignore => {}
        }
    }
    Ok(Json(DiffApplyResponse { applied }))
}

// ============================================================
// Per-student curation
// ============================================================

#[derive(Deserialize)]
pub struct AddTechniqueToStudentRequest {
    pub technique_id: i64,
}

#[derive(Serialize)]
pub struct SstIdResponse {
    pub id: i64,
}

#[post("/student/<sid>/syllabi/<syid>/techniques", data = "<body>")]
pub async fn api_add_technique_to_student_syllabus(
    sid: i64,
    syid: i64,
    user: User,
    body: Json<AddTechniqueToStudentRequest>,
    db: &State<Pool<Sqlite>>,
) -> ApiResult<Json<SstIdResponse>> {
    user.require_permission(Permission::ManageSyllabi)?;
    let assignment = db::get_assignment(db, sid, syid)
        .await?
        .ok_or(Status::NotFound)?;
    let id = db::add_technique_to_assignment(db, assignment.id, body.technique_id).await?;
    Ok(Json(SstIdResponse { id }))
}

#[derive(Deserialize)]
pub struct SetSstHiddenRequest {
    pub hidden: bool,
}

#[patch("/student_syllabus_techniques/<sst_id>/hidden", data = "<body>")]
pub async fn api_set_sst_hidden(
    sst_id: i64,
    user: User,
    body: Json<SetSstHiddenRequest>,
    db: &State<Pool<Sqlite>>,
) -> ApiResult<Status> {
    user.require_permission(Permission::ManageSyllabi)?;
    let owner = db::get_owner(db, sst_id).await?.ok_or(Status::NotFound)?;
    let _ = owner;
    db::set_hidden(db, user.id, sst_id, body.hidden).await?;
    Ok(Status::NoContent)
}

// ============================================================
// Per-syllabus video visibility override
// ============================================================

#[derive(Deserialize)]
pub struct SetVideoSyllabusVisibilityRequest {
    /// `Some(b)` upserts the override; `None` clears it.
    pub visible: Option<bool>,
}

#[put(
    "/student/<sid>/syllabi/<syid>/videos/<vid>/visibility",
    data = "<body>"
)]
pub async fn api_set_video_syllabus_visibility(
    sid: i64,
    syid: i64,
    vid: i64,
    user: User,
    body: Json<SetVideoSyllabusVisibilityRequest>,
    db: &State<Pool<Sqlite>>,
) -> ApiResult<Status> {
    user.require_permission(Permission::ManageSyllabi)?;
    db::set_video_syllabus_visibility(db, vid, syid, sid, body.visible, user.id).await?;
    Ok(Status::NoContent)
}

// ============================================================
// Student-facing syllabus reads
// ============================================================

#[get("/student/<sid>/syllabi")]
pub async fn api_list_student_syllabi(
    sid: i64,
    user: User,
    db: &State<Pool<Sqlite>>,
) -> ApiResult<Json<Vec<db::SyllabusAssignment>>> {
    if user.id != sid && !user.has_permission(Permission::ViewAllStudents) {
        return Err(Status::Forbidden.into());
    }
    let rows = db::list_assignments_for_student(db, sid, false).await?;
    Ok(Json(rows))
}

#[derive(Serialize)]
pub struct StudentSyllabusDetailResponse {
    pub assignment: db::SyllabusAssignment,
    pub techniques: Vec<db::SstRow>,
}

#[get("/student/<sid>/syllabi/<syid>/techniques")]
pub async fn api_list_student_syllabus_techniques(
    sid: i64,
    syid: i64,
    user: User,
    db: &State<Pool<Sqlite>>,
) -> ApiResult<Json<StudentSyllabusDetailResponse>> {
    if user.id != sid && !user.has_permission(Permission::ViewAllStudents) {
        return Err(Status::Forbidden.into());
    }
    let assignment = db::get_assignment(db, sid, syid)
        .await?
        .ok_or(Status::NotFound)?;
    if assignment.unassigned_at.is_some() && !user.has_permission(Permission::ManageSyllabi) {
        return Err(Status::NotFound.into());
    }
    let techniques = db::list_for_assignment(db, assignment.id, &user).await?;
    Ok(Json(StudentSyllabusDetailResponse {
        assignment,
        techniques,
    }))
}

// ============================================================
// SST mutation
// ============================================================

#[derive(Deserialize, Validate)]
pub struct UpdateSstRequest {
    #[validate(length(min = 3, max = 5, message = "Status must be red, amber, or green"))]
    pub status: Option<String>,
    pub student_notes: Option<String>,
    pub coach_notes: Option<String>,
}

#[patch("/student_syllabus_techniques/<sst_id>", data = "<body>")]
pub async fn api_update_sst(
    sst_id: i64,
    user: User,
    body: Json<UpdateSstRequest>,
    db: &State<Pool<Sqlite>>,
) -> ApiResult<Status> {
    body.validate()?;
    if let Some(ref s) = body.status {
        if !matches!(s.as_str(), "red" | "amber" | "green") {
            return Err(Status::BadRequest.into());
        }
    }
    let owner = db::get_owner(db, sst_id).await?.ok_or(Status::NotFound)?;

    let viewer_is_owning_student = user.id == owner.student_id;
    let viewer_is_coach = user.has_permission(Permission::ViewAllStudents);
    if !viewer_is_owning_student && !viewer_is_coach {
        return Err(Status::Forbidden.into());
    }

    // Graduated assignments are read-only for students; coach writes
    // proceed (frontend prompts for confirmation per mutation).
    if !viewer_is_coach {
        if let Some(flags) = db::get_assignment_lifecycle(db, owner.assignment_id).await? {
            if flags.graduated_at.is_some() {
                return Err(Status::Forbidden.into());
            }
        }
    }

    // Per-field permission policy. Any disallowed field present in the
    // request fails the whole request with 403; no silent field drops.
    // Students cannot self-assess: status is coach-controlled, matching
    // the legacy semantics where progression is the coach's call.
    if body.coach_notes.is_some() && !viewer_is_coach {
        return Err(Status::Forbidden.into());
    }
    if body.status.is_some() && !viewer_is_coach {
        return Err(Status::Forbidden.into());
    }

    let update = SstUpdate {
        status: body.status.clone(),
        student_notes: body.student_notes.clone(),
        coach_notes: body.coach_notes.clone(),
    };
    db::update_sst(db, sst_id, &user, &update).await?;
    Ok(Status::NoContent)
}

// ============================================================
// Syllabus attempts
// ============================================================

#[derive(Deserialize, Validate)]
pub struct CreateSyllabusAttemptRequest {
    pub attempted_at: String,
    pub coach_note: Option<String>,
    pub student_note: Option<String>,
}

#[derive(Serialize)]
pub struct AttemptIdResponse {
    pub id: i64,
}

#[post("/student_syllabus_techniques/<sst_id>/attempts", data = "<body>")]
pub async fn api_create_syllabus_attempt(
    sst_id: i64,
    user: User,
    body: Json<CreateSyllabusAttemptRequest>,
    db: &State<Pool<Sqlite>>,
) -> ApiResult<Json<AttemptIdResponse>> {
    db::ensure_can_access_syllabus_sst(db, &user, sst_id).await?;
    let attempted_at = parse_iso(&body.attempted_at)?;
    if attempted_at > chrono::Utc::now().naive_utc() {
        return Err(Status::BadRequest.into());
    }
    let viewer_is_coach = user.has_permission(Permission::ViewAllStudents);
    if body.coach_note.is_some() && !viewer_is_coach {
        return Err(Status::Forbidden.into());
    }
    // Students can't log attempts against a graduated assignment.
    if !viewer_is_coach {
        let owner = db::get_owner(db, sst_id).await?.ok_or(Status::NotFound)?;
        if let Some(flags) = db::get_assignment_lifecycle(db, owner.assignment_id).await? {
            if flags.graduated_at.is_some() {
                return Err(Status::Forbidden.into());
            }
        }
    }
    let input = db::CreateSyllabusAttempt {
        attempted_at,
        coach_note: body.coach_note.clone(),
        student_note: body.student_note.clone(),
    };
    let id = db::create_syllabus_attempt(db, &user, sst_id, &input).await?;
    Ok(Json(AttemptIdResponse { id }))
}

#[derive(Deserialize)]
pub struct UpdateSyllabusAttemptRequest {
    pub attempted_at: Option<String>,
    pub coach_note: Option<Option<String>>,
    pub student_note: Option<Option<String>>,
}

#[patch("/syllabus_attempts/<aid>", data = "<body>")]
pub async fn api_update_syllabus_attempt(
    aid: i64,
    user: User,
    body: Json<UpdateSyllabusAttemptRequest>,
    db: &State<Pool<Sqlite>>,
) -> ApiResult<Status> {
    let sst_id = db::get_syllabus_attempt_sst_id(db, aid)
        .await?
        .ok_or(Status::NotFound)?;
    db::ensure_can_access_syllabus_sst(db, &user, sst_id).await?;
    let viewer_is_coach = user.has_permission(Permission::ViewAllStudents);
    if body.coach_note.is_some() && !viewer_is_coach {
        return Err(Status::Forbidden.into());
    }
    let mut update = SyllabusAttemptUpdate::default();
    if let Some(ref ts) = body.attempted_at {
        update.attempted_at = Some(parse_iso(ts)?);
    }
    update.coach_note = body.coach_note.clone();
    update.student_note = body.student_note.clone();
    db::update_syllabus_attempt(db, aid, &user, &update).await?;
    Ok(Status::NoContent)
}

#[delete("/syllabus_attempts/<aid>")]
pub async fn api_delete_syllabus_attempt(
    aid: i64,
    user: User,
    db: &State<Pool<Sqlite>>,
) -> ApiResult<Status> {
    let sst_id = db::get_syllabus_attempt_sst_id(db, aid)
        .await?
        .ok_or(Status::NotFound)?;
    db::ensure_can_access_syllabus_sst(db, &user, sst_id).await?;
    db::delete_syllabus_attempt(db, &user, aid).await?;
    Ok(Status::NoContent)
}

#[get("/student_syllabus_techniques/<sst_id>/attempts")]
pub async fn api_list_syllabus_attempts(
    sst_id: i64,
    user: User,
    db: &State<Pool<Sqlite>>,
) -> ApiResult<Json<Vec<db::SyllabusAttempt>>> {
    db::ensure_can_access_syllabus_sst(db, &user, sst_id).await?;
    let rows = db::list_syllabus_attempts_for_sst(db, sst_id).await?;
    Ok(Json(rows))
}

// ============================================================
// Per-syllabus video read
// ============================================================

#[derive(Serialize)]
pub struct SyllabusVideoListResponse {
    pub videos: Vec<crate::models::Video>,
}

#[get("/student/<sid>/syllabi/<syid>/techniques/<tid>/videos")]
pub async fn api_list_syllabus_technique_videos(
    sid: i64,
    syid: i64,
    tid: i64,
    user: User,
    db: &State<Pool<Sqlite>>,
) -> ApiResult<Json<SyllabusVideoListResponse>> {
    if user.id != sid && !user.has_permission(Permission::ViewAllStudents) {
        return Err(Status::Forbidden.into());
    }
    let assignment = db::get_assignment(db, sid, syid)
        .await?
        .ok_or(Status::NotFound)?;
    // Confirm this technique is in the assignment's SST (otherwise the
    // student has no business reading its videos).
    let sst_id = db::get_sst_id(db, assignment.id, tid).await?;
    if sst_id.is_none() {
        return Err(Status::NotFound.into());
    }
    let videos = if user.has_permission(Permission::ViewAllStudents) {
        db::list_videos_for_technique(db, tid).await?
    } else {
        db::list_videos_for_technique_in_syllabus_visible_to(db, tid, syid, sid).await?
    };
    Ok(Json(SyllabusVideoListResponse { videos }))
}
