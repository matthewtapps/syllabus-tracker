use std::collections::HashMap;

use rocket::FromForm;
use rocket::Request;
use rocket::State;
use rocket::http::CookieJar;
use rocket::http::Status;
use rocket::response::Redirect;
use rocket::response::Responder;
use rocket::response::status::Custom;
use rocket::serde::{Deserialize, Serialize, json::Json};
use sqlx::{Pool, Sqlite};
use tracing::warn;
use validator::Validate;
use validator::ValidationErrors;

use crate::auth::UserSession;
use crate::auth::{Permission, User};
use crate::db::{
    ActivityRow, AttemptSuggestion, Collection, add_tag_to_technique, add_techniques_to_collection,
    add_techniques_to_student, advance_cursor_to, approve_user, assign_collection_to_student,
    attempt_buckets_for_student, attempt_summary_for_student, attempt_weekly_buckets_for_technique,
    authenticate_user, claim_invite, count_techniques, create_and_assign_technique, create_attempt,
    create_collection, create_invite_token, create_self_registered_user, create_tag,
    create_technique_in_collection, create_user, create_user_session, create_user_stub,
    delete_attempt, delete_collection, delete_tag, feed, feed_max_id, find_user_by_username,
    find_valid_invite_token, get_all_collections, get_all_tags, get_all_users, get_collection,
    get_student_technique, get_student_techniques, get_students_by_recent_updates,
    get_students_with_collection, get_tags_for_technique, get_unassigned_techniques, get_user,
    invalidate_session, list_attempts, list_recent_attempts_for_student, mark_all_read,
    mark_one_read, mark_one_unread, mark_student_technique_seen, recently_active_students,
    remove_tag_from_technique, remove_technique_from_collection, request_password_reset,
    reset_user_claim, set_user_archived, set_user_graduated, unread_count, update_attempt_note,
    update_attempt_timestamp, update_collection, update_student_notes, update_student_technique,
    update_technique, update_user_display_name, update_user_password, update_user_role,
    update_username,
};
use crate::error::AppError;
use crate::models::Tag;
use crate::models::Technique;
use crate::validation::ToValidationResponse;
use crate::validation::ValidationResponse;

#[derive(Debug)]
pub enum ApiError {
    Validation(ValidationErrors),
    AppError(AppError),
    Status(Status),
}

impl From<ValidationErrors> for ApiError {
    fn from(errors: ValidationErrors) -> Self {
        ApiError::Validation(errors)
    }
}

impl From<AppError> for ApiError {
    fn from(error: AppError) -> Self {
        ApiError::AppError(error)
    }
}

impl From<Status> for ApiError {
    fn from(status: Status) -> Self {
        ApiError::Status(status)
    }
}

impl From<ApiError> for Status {
    fn from(error: ApiError) -> Self {
        match error {
            ApiError::Validation(_) => Status::UnprocessableEntity,
            ApiError::AppError(ref app_error) => app_error.status_code(),
            ApiError::Status(status) => status,
        }
    }
}

impl From<ApiError> for Custom<Json<ValidationResponse>> {
    fn from(error: ApiError) -> Self {
        match error {
            ApiError::Validation(errors) => {
                let mut error_map = HashMap::new();
                for (field, field_errors) in errors.field_errors() {
                    let error_messages: Vec<String> = field_errors
                        .iter()
                        .map(|error| {
                            error
                                .message
                                .clone()
                                .unwrap_or_else(|| "Invalid value".into())
                                .to_string()
                        })
                        .collect();
                    error_map.insert(field.to_string(), error_messages);
                }
                Custom(
                    Status::UnprocessableEntity,
                    Json(ValidationResponse::new(error_map)),
                )
            }
            ApiError::AppError(app_error) => app_error.to_validation_response(),
            ApiError::Status(status) => status.to_validation_response(),
        }
    }
}

pub type ApiResult<T> = Result<T, ApiError>;

impl<'r> Responder<'r, 'static> for ApiError {
    fn respond_to(self, req: &'r Request<'_>) -> rocket::response::Result<'static> {
        let custom_response: Custom<Json<ValidationResponse>> = self.into();
        custom_response.respond_to(req)
    }
}

#[derive(Serialize, Deserialize, Debug)]
pub struct UserData {
    pub id: i64,
    pub username: String,
    pub display_name: String,
    pub role: String,
    pub last_update: Option<String>,
    pub archived: bool,
    pub graduated_at: Option<String>,
    pub email: Option<String>,
    pub claimed_at: Option<String>,
    pub approved_at: Option<String>,
    pub first_name: Option<String>,
    pub last_name: Option<String>,
    pub reset_requested_at: Option<String>,
    pub last_coach_update_at: Option<String>,
    pub total_techniques: Option<i64>,
    pub red_count: Option<i64>,
    pub amber_count: Option<i64>,
    pub green_count: Option<i64>,
    pub has_unseen_activity: Option<bool>,
    pub last_student_initiative_at: Option<String>,
    pub last_watch_at: Option<String>,
    pub last_watch_video_title: Option<String>,
}

impl From<User> for UserData {
    fn from(user: User) -> Self {
        Self {
            id: user.id,
            username: user.username.clone(),
            display_name: user.display_name.clone(),
            role: user.role.to_string(),
            last_update: user.last_update.clone(),
            archived: user.archived,
            graduated_at: user.graduated_at.clone(),
            email: user.email.clone(),
            claimed_at: user.claimed_at.clone(),
            approved_at: user.approved_at.clone(),
            first_name: user.first_name.clone(),
            last_name: user.last_name.clone(),
            reset_requested_at: user.reset_requested_at.clone(),
            last_coach_update_at: user.last_coach_update_at.clone(),
            total_techniques: user.total_techniques,
            red_count: user.red_count,
            amber_count: user.amber_count,
            green_count: user.green_count,
            has_unseen_activity: user.has_unseen_activity,
            last_student_initiative_at: user.last_student_initiative_at.clone(),
            last_watch_at: user.last_watch_at.clone(),
            last_watch_video_title: user.last_watch_video_title.clone(),
        }
    }
}

#[derive(Serialize, Deserialize)]
pub struct LoginResponse {
    pub success: bool,
    pub user: Option<UserData>,
    pub error: Option<String>,
    pub redirect_url: Option<String>,
}

#[derive(Deserialize, Validate)]
pub struct LoginRequest {
    #[validate(length(min = 1, message = "Username cannot be empty"))]
    username: String,
    #[validate(length(min = 1, message = "Password cannot be empty"))]
    password: String,
}

/// Establishes the session cookies for a user. Shared by login and invite-claim.
async fn establish_session(
    cookies: &rocket::http::CookieJar<'_>,
    db: &State<Pool<Sqlite>>,
    user: &User,
) -> Result<(), AppError> {
    use chrono::Utc;
    use rocket::http::{Cookie, SameSite};

    let token = UserSession::generate_token();
    let lifetime = chrono::Duration::days(UserSession::LIFETIME_DAYS);
    let cookie_max_age = rocket::time::Duration::days(UserSession::LIFETIME_DAYS);
    let expires_at = Utc::now() + lifetime;
    create_user_session(db, user.id, &token, expires_at.naive_utc()).await?;

    cookies.add_private(
        Cookie::build(("session_token", token))
            .same_site(SameSite::Lax)
            .http_only(true)
            .max_age(cookie_max_age),
    );
    cookies.add_private(
        Cookie::build(("user_id", user.id.to_string()))
            .same_site(SameSite::Lax)
            .http_only(true)
            .max_age(cookie_max_age),
    );
    cookies.add_private(
        Cookie::build(("logged_in", user.username.clone()))
            .same_site(SameSite::Lax)
            .max_age(cookie_max_age),
    );
    let current_timestamp = rocket::time::OffsetDateTime::now_utc()
        .unix_timestamp()
        .to_string();
    cookies.add_private(
        Cookie::build(("session_timestamp", current_timestamp))
            .same_site(SameSite::Lax)
            .max_age(cookie_max_age),
    );
    cookies.add_private(
        Cookie::build(("user_role", user.role.to_string()))
            .same_site(SameSite::Lax)
            .max_age(cookie_max_age),
    );
    Ok(())
}

#[post("/login", data = "<login>")]
pub async fn api_login(
    login: Json<LoginRequest>,
    cookies: &rocket::http::CookieJar<'_>,
    db: &State<Pool<Sqlite>>,
) -> ApiResult<Json<LoginResponse>> {
    login.validate()?;

    match authenticate_user(db, &login.username, &login.password).await? {
        Some(user) => {
            establish_session(cookies, db, &user).await?;

            let redirect_url = match user.role.as_str() {
                "student" => format!("/ui/student/{}", user.id),
                _ => "/ui/dashboard".to_string(),
            };

            Ok(Json(LoginResponse {
                success: true,
                user: Some(UserData::from(user)),
                error: None,
                redirect_url: Some(redirect_url),
            }))
        }
        None => Ok(Json(LoginResponse {
            success: false,
            user: None,
            error: Some("Invalid username or password".to_string()),
            redirect_url: None,
        })),
    }
}

/// Viewer-relative "the other party has done something since I last looked"
/// flag. If `viewer_is_owner` is true the viewer is the owning student and we
/// look at coach activity; otherwise the viewer is a coach/admin and we look
/// at student activity. A null `viewer_seen_at` means the viewer has never
/// opened this row, so any activity counts.
pub fn compute_has_unseen_activity(
    viewer_is_owner: bool,
    last_coach_update_at: Option<chrono::DateTime<chrono::Utc>>,
    last_student_update_at: Option<chrono::DateTime<chrono::Utc>>,
    viewer_seen_at: Option<chrono::DateTime<chrono::Utc>>,
) -> bool {
    let other_party_update = if viewer_is_owner {
        last_coach_update_at
    } else {
        last_student_update_at
    };
    match (other_party_update, viewer_seen_at) {
        (Some(_), None) => true,
        (Some(update), Some(seen)) => update > seen,
        _ => false,
    }
}

#[derive(Serialize, Deserialize)]
pub struct TechniqueResponse {
    pub id: i64,
    pub technique_id: i64,
    pub technique_name: String,
    pub technique_description: String,
    pub status: String,
    pub student_notes: String,
    pub coach_notes: String,
    pub created_at: String,
    pub updated_at: String,
    pub last_coach_update_at: Option<String>,
    pub last_coach_update_by_name: Option<String>,
    pub last_student_update_at: Option<String>,
    pub last_student_update_by_name: Option<String>,
    pub has_unseen_activity: bool,
    pub collection_id: Option<i64>,
    pub collection_name: Option<String>,
    pub tags: Vec<TagResponse>,
    pub attempt_count: i64,
    pub last_attempt_at: Option<String>,
}

#[derive(Serialize, Deserialize)]
pub struct StudentResponse {
    pub id: i64,
    pub username: String,
    pub display_name: String,
    pub archived: bool,
    pub graduated_at: Option<String>,
}

#[derive(Serialize, Deserialize)]
pub struct StudentTechniquesResponse {
    pub student: StudentResponse,
    pub techniques: Vec<TechniqueResponse>,
    pub can_edit_all_techniques: bool,
    pub can_assign_techniques: bool,
    pub can_create_techniques: bool,
    pub can_manage_tags: bool,
}

#[get("/student/<id>/techniques")]
pub async fn api_get_student_techniques(
    id: i64,
    user: User,
    db: &State<Pool<Sqlite>>,
) -> ApiResult<Json<StudentTechniquesResponse>> {
    if user.id != id && !user.has_permission(Permission::ViewAllStudents) {
        return Err(Status::Forbidden.into());
    }

    let student = get_user(db, id).await?;

    let techniques = get_student_techniques(db, id, user.id).await?;

    let viewer_is_owner = user.id == id;
    let technique_responses: Vec<TechniqueResponse> = techniques
        .into_iter()
        .map(|t| {
            let has_unseen_activity = compute_has_unseen_activity(
                viewer_is_owner,
                t.last_coach_update_at,
                t.last_student_update_at,
                t.viewer_seen_at,
            );
            TechniqueResponse {
                id: t.id,
                technique_id: t.technique_id,
                technique_name: t.technique_name,
                technique_description: t.technique_description,
                status: t.status,
                student_notes: t.student_notes,
                coach_notes: t.coach_notes,
                created_at: t.created_at.to_rfc3339(),
                updated_at: t.updated_at.to_rfc3339(),
                last_coach_update_at: t.last_coach_update_at.map(|d| d.to_rfc3339()),
                last_coach_update_by_name: t.last_coach_update_by_name,
                last_student_update_at: t.last_student_update_at.map(|d| d.to_rfc3339()),
                last_student_update_by_name: t.last_student_update_by_name,
                has_unseen_activity,
                collection_id: t.collection_id,
                collection_name: t.collection_name,
                tags: t.tags.into_iter().map(TagResponse::from).collect(),
                attempt_count: t.attempt_count,
                last_attempt_at: t.last_attempt_at.map(|d| d.to_rfc3339()),
            }
        })
        .collect();

    Ok(Json(StudentTechniquesResponse {
        student: StudentResponse {
            id: student.id,
            username: student.username,
            display_name: student.display_name,
            archived: student.archived,
            graduated_at: student.graduated_at,
        },
        techniques: technique_responses,
        can_edit_all_techniques: user.has_permission(Permission::EditAllTechniques),
        can_assign_techniques: user.has_permission(Permission::AssignTechniques),
        can_create_techniques: user.has_permission(Permission::CreateTechniques),
        can_manage_tags: user.has_permission(Permission::ManageTags),
    }))
}

#[derive(Deserialize, Validate, Clone)]
pub struct TechniqueUpdateRequest {
    status: Option<String>,
    student_notes: Option<String>,
    coach_notes: Option<String>,
    #[validate(length(
        min = 1,
        max = 100,
        message = "Technique name must be between 1 and 100 characters"
    ))]
    technique_name: Option<String>,
    technique_description: Option<String>,
}

#[put("/student_technique/<id>", data = "<technique>")]
pub async fn api_update_student_technique(
    id: i64,
    technique: Json<TechniqueUpdateRequest>,
    user: User,
    db: &State<Pool<Sqlite>>,
) -> ApiResult<Status> {
    technique.validate()?;

    let student_technique = get_student_technique(db, id, user.id).await?;

    let is_own_technique = user.id == student_technique.student_id;
    let can_edit_all = user.has_permission(Permission::EditAllTechniques);

    if !is_own_technique && !can_edit_all {
        return Err(Status::Forbidden.into());
    }

    if is_own_technique && !can_edit_all {
        if let Some(notes) = &technique.student_notes {
            update_student_notes(db, id, &user, notes).await?;
        }

        return Ok(Status::Ok);
    } else if can_edit_all {
        let status = technique.status.clone().unwrap_or(student_technique.status);
        let student_notes = technique
            .student_notes
            .clone()
            .unwrap_or(student_technique.student_notes);
        let coach_notes = technique
            .coach_notes
            .clone()
            .unwrap_or(student_technique.coach_notes);

        update_student_technique(db, id, &user, &status, &student_notes, &coach_notes).await?;

        if technique.technique_name.is_some() || technique.technique_description.is_some() {
            let technique_name = technique
                .technique_name
                .clone()
                .unwrap_or(student_technique.technique_name);
            let technique_description = technique
                .technique_description
                .clone()
                .unwrap_or(student_technique.technique_description);

            update_technique(
                db,
                student_technique.technique_id,
                &technique_name,
                &technique_description,
                user.id,
            )
            .await?;
        }

        return Ok(Status::Ok);
    }

    Err(Status::BadRequest.into())
}

#[derive(FromForm)]
pub struct StudentsQueryParams {
    sort_by: Option<String>,
    include_archived: Option<bool>,
}

#[get("/students?<params..>")]
pub async fn api_get_students(
    params: StudentsQueryParams,
    user: User,
    db: &State<Pool<Sqlite>>,
) -> ApiResult<Json<Vec<UserData>>> {
    user.require_permission(Permission::ViewAllStudents)?;

    let include_archived = params.include_archived.unwrap_or(false);

    // Always use the aggregating query so the response carries per-student
    // counts and activity flags. Sort order is handled client-side.
    let _ = params.sort_by;
    let students = get_students_by_recent_updates(db, include_archived, user.id).await?;

    let student_responses: Vec<UserData> = students.into_iter().map(UserData::from).collect();

    Ok(Json(student_responses))
}

#[get("/student/<id>/unassigned_techniques")]
pub async fn api_get_unassigned_techniques(
    id: i64,
    user: User,
    db: &State<Pool<Sqlite>>,
) -> ApiResult<Json<Vec<Technique>>> {
    user.require_permission(Permission::AssignTechniques)?;

    let techniques = get_unassigned_techniques(db, id).await?;

    Ok(Json(techniques))
}

#[derive(Deserialize, Validate, Clone)]
pub struct AssignTechniquesRequest {
    #[validate(length(min = 1, message = "At least one technique must be selected"))]
    technique_ids: Vec<i64>,
    collection_id: Option<i64>,
}

#[post("/student/<student_id>/add_techniques", data = "<request>")]
pub async fn api_assign_techniques(
    student_id: i64,
    request: Json<AssignTechniquesRequest>,
    user: User,
    db: &State<Pool<Sqlite>>,
) -> ApiResult<Status> {
    request.validate()?;

    user.require_permission(Permission::AssignTechniques)?;

    add_techniques_to_student(
        db,
        student_id,
        request.technique_ids.clone(),
        request.collection_id,
        user.id,
    )
    .await?;

    Ok(Status::Ok)
}

#[derive(Deserialize, Validate, Clone)]
pub struct CreateTechniqueRequest {
    #[validate(length(
        min = 1,
        max = 100,
        message = "Technique name must be between 1 and 100 characters"
    ))]
    name: String,
    #[validate(length(min = 1, message = "Description cannot be empty"))]
    description: String,
    collection_id: Option<i64>,
}

#[post("/student/<student_id>/create_technique", data = "<request>")]
pub async fn api_create_and_assign_technique(
    student_id: i64,
    request: Json<CreateTechniqueRequest>,
    user: User,
    db: &State<Pool<Sqlite>>,
) -> ApiResult<Status> {
    request.validate()?;
    user.require_all_permissions(&[Permission::CreateTechniques, Permission::AssignTechniques])?;

    create_and_assign_technique(
        db,
        user.id,
        student_id,
        &request.name,
        &request.description,
        request.collection_id,
    )
    .await?;

    Ok(Status::Ok)
}

#[get("/me")]
pub async fn api_me(user: User) -> Json<UserData> {
    Json(UserData::from(user))
}

#[derive(Serialize, Deserialize)]
pub struct LibraryStatsResponse {
    pub total_techniques: i64,
}

#[get("/library/stats")]
pub async fn api_library_stats(
    user: User,
    db: &State<Pool<Sqlite>>,
) -> ApiResult<Json<LibraryStatsResponse>> {
    user.require_permission(Permission::ViewAllStudents)?;

    let total_techniques = count_techniques(db).await?;

    Ok(Json(LibraryStatsResponse { total_techniques }))
}

#[get("/techniques")]
pub async fn api_list_library_techniques(
    user: User,
    db: &State<Pool<Sqlite>>,
) -> ApiResult<Json<Vec<crate::db::LibraryTechniqueRow>>> {
    user.require_permission(Permission::ViewLibrary)?;
    let rows = crate::db::list_library_techniques(db).await?;
    Ok(Json(rows))
}

#[get("/student/<id>/library")]
pub async fn api_get_student_library(
    id: i64,
    user: User,
    db: &State<Pool<Sqlite>>,
) -> ApiResult<Json<Vec<crate::db::LibraryTechniqueRow>>> {
    if user.id != id && !user.has_permission(Permission::ViewAllStudents) {
        return Err(Status::Forbidden.into());
    }

    let mut rows = crate::db::list_library_techniques(db).await?;
    let pinned_ids = crate::db::pinned_technique_ids_for_student(db, id).await?;
    for row in rows.iter_mut() {
        row.is_pinned = pinned_ids.contains(&row.id);
    }
    Ok(Json(rows))
}

#[get("/student/<id>/pinned_techniques")]
pub async fn api_get_pinned_techniques(
    id: i64,
    user: User,
    db: &State<Pool<Sqlite>>,
) -> ApiResult<Json<Vec<crate::db::LibraryTechniqueRow>>> {
    if user.id != id && !user.has_permission(Permission::ViewAllStudents) {
        return Err(Status::Forbidden.into());
    }
    let rows = crate::db::list_pinned_for_student(db, id).await?;
    Ok(Json(rows))
}

#[derive(Deserialize)]
pub struct PinTechniqueRequest {
    pub technique_id: i64,
}

#[post("/student/<id>/pinned_techniques", data = "<body>")]
pub async fn api_pin_technique(
    id: i64,
    body: Json<PinTechniqueRequest>,
    user: User,
    db: &State<Pool<Sqlite>>,
) -> ApiResult<Status> {
    // Coaches do not pin on a student's behalf; the viewer must be the
    // owning student. Flip to allow coach-pinning is trivial later.
    if user.id != id {
        return Err(Status::Forbidden.into());
    }
    crate::db::pin_technique(db, id, body.technique_id).await?;
    Ok(Status::NoContent)
}

#[delete("/student/<id>/pinned_techniques/<technique_id>")]
pub async fn api_unpin_technique(
    id: i64,
    technique_id: i64,
    user: User,
    db: &State<Pool<Sqlite>>,
) -> ApiResult<Status> {
    if user.id != id {
        return Err(Status::Forbidden.into());
    }
    crate::db::unpin_technique(db, id, technique_id).await?;
    Ok(Status::NoContent)
}

#[get("/techniques/<id>/stats")]
pub async fn api_library_technique_stats(
    id: i64,
    user: User,
    db: &State<Pool<Sqlite>>,
) -> ApiResult<Json<crate::db::LibraryTechniqueStats>> {
    user.require_permission(Permission::ViewAllStudents)?;
    let stats = crate::db::library_technique_stats(db, id).await?;
    Ok(Json(stats))
}

#[get("/me", rank = 2)]
pub async fn api_me_unauthorized() -> Status {
    Status::Unauthorized
}

#[post("/logout")]
pub async fn api_logout(cookies: &CookieJar<'_>, db: &State<Pool<Sqlite>>) -> Redirect {
    let token = cookies
        .get_private("session_token")
        .map(|cookie| cookie.value().to_string());

    if let Some(token) = token {
        let _ = invalidate_session(db, &token).await;
    }

    cookies.remove_private(rocket::http::Cookie::build("session_token"));
    cookies.remove_private(rocket::http::Cookie::build("user_id"));
    cookies.remove_private(rocket::http::Cookie::build("logged_in"));
    cookies.remove_private(rocket::http::Cookie::build("session_timestamp"));
    cookies.remove_private(rocket::http::Cookie::build("user_role"));

    Redirect::to("/")
}

#[derive(Deserialize, Validate, Clone)]
pub struct ProfileUpdateRequest {
    #[validate(length(max = 100, message = "Display name must be under 100 characters"))]
    display_name: String,
    #[validate(length(min = 1, max = 50, message = "Username must be 1-50 characters"))]
    username: Option<String>,
}

#[put("/profile", data = "<profile>")]
pub async fn api_update_profile(
    profile: Json<ProfileUpdateRequest>,
    user: User,
    db: &State<Pool<Sqlite>>,
) -> ApiResult<Status> {
    profile.validate()?;

    if let Some(new_username) = profile.username.as_deref() {
        let trimmed = new_username.trim();
        if trimmed != user.username {
            // Field-level uniqueness check so the frontend can highlight the
            // username input. `update_username` does its own check, but its
            // error type collapses to a generic 500 here.
            if let Some(other) = find_user_by_username(db, trimmed).await? {
                if other.id != user.id {
                    let mut errors = validator::ValidationErrors::new();
                    let mut err = validator::ValidationError::new("unique");
                    err.message = Some("That username is already taken".into());
                    errors.add("username", err);
                    return Err(errors.into());
                }
            }
            update_username(db, user.id, trimmed).await?;
        }
    }

    update_user_display_name(db, user.id, &profile.display_name).await?;

    Ok(Status::Ok)
}

#[derive(Deserialize, Validate)]
pub struct PasswordChangeRequest {
    #[validate(length(min = 1, message = "Current password cannot be empty"))]
    current_password: String,
    #[validate(length(min = 5, message = "New password must be at least 5 characters long"))]
    new_password: String,
}

#[post("/change-password", data = "<password>")]
pub async fn api_change_password(
    password: Json<PasswordChangeRequest>,
    user: User,
    db: &State<Pool<Sqlite>>,
) -> ApiResult<Status> {
    password.validate()?;

    let is_valid = authenticate_user(db, &user.username, &password.current_password).await?;

    match is_valid {
        Some(_) => {
            update_user_password(db, user.id, &password.new_password).await?;

            Ok(Status::Ok)
        }
        _ => Err(ApiError::AppError(AppError::Authentication(
            "Current password is incorrect".to_string(),
        ))),
    }
}

#[derive(Deserialize, Validate, Clone)]
pub struct UserRegistrationRequest {
    #[validate(
        length(
            min = 3,
            max = 50,
            message = "Username must be between 3 and 50 characters"
        ),
        does_not_contain(pattern = " ", message = "Username cannot contain spaces")
    )]
    username: String,
    #[validate(length(max = 100, message = "Display name must be under 100 characters"))]
    display_name: String,
    #[validate(length(min = 5, message = "Password must be at least 5 characters long"))]
    password: String,
    #[validate(must_match(other = "password", message = "Passwords must match"))]
    confirm_password: String,
    role: String,
}

#[post("/register", data = "<registration>")]
pub async fn api_register_user(
    registration: Json<UserRegistrationRequest>,
    user: User,
    db: &State<Pool<Sqlite>>,
) -> ApiResult<Status> {
    registration.validate()?;

    let existing_user = find_user_by_username(db, &registration.username).await?;

    if existing_user.is_some() {
        return Err(ApiError::AppError(AppError::Internal(
            "Username already exists".to_string(),
        )));
    }

    match registration.role.as_str() {
        "admin" => {
            user.require_all_permissions(&[Permission::EditUserRoles, Permission::RegisterUsers])?
        }
        _ => user.require_permission(Permission::RegisterUsers)?,
    };

    create_user(
        db,
        &registration.username,
        &registration.password,
        &registration.role,
        Some(&registration.display_name),
    )
    .await?;

    Ok(Status::Created)
}

#[derive(Deserialize, Validate, Clone)]
pub struct UserUpdateRequest {
    #[validate(
        length(
            min = 3,
            max = 50,
            message = "Username must be between 3 and 50 characters"
        ),
        does_not_contain(pattern = " ", message = "Username cannot contain spaces")
    )]
    username: Option<String>,
    #[validate(length(max = 100, message = "Display name must be under 100 characters"))]
    display_name: Option<String>,
    #[validate(length(min = 5, message = "Password must be at least 5 characters long"))]
    password: Option<String>,
    archived: Option<bool>,
    graduated: Option<bool>,
    role: Option<String>,
}

#[put("/admin/users/<id>", data = "<update>")]
pub async fn api_update_user(
    id: i64,
    update: Json<UserUpdateRequest>,
    user: User,
    db: &State<Pool<Sqlite>>,
) -> ApiResult<Status> {
    update.clone().validate()?;
    user.require_permission(Permission::EditUserCredentials)?;

    if update.role.is_some() {
        user.require_permission(Permission::EditUserRoles)?;
    }

    if let Some(username) = &update.username {
        update_username(db, id, username).await?;
    }

    if let Some(display_name) = &update.display_name {
        update_user_display_name(db, id, display_name).await?;
    }

    if let Some(password) = &update.password {
        update_user_password(db, id, password).await?;
    }

    if let Some(archived) = update.archived {
        set_user_archived(db, id, archived).await?;
    }

    if let Some(graduated) = update.graduated {
        set_user_graduated(db, id, graduated, Some(user.id)).await?;
    }

    if let Some(role) = &update.role {
        update_user_role(db, id, role).await?;
    }

    Ok(Status::Ok)
}

/// Mark a student_technique row as seen by the current viewer, clearing the
/// "unseen activity" dot for them. Used by the row-expand interaction.
#[post("/student_technique/<id>/mark_seen")]
pub async fn api_mark_student_technique_seen(
    id: i64,
    user: User,
    db: &State<Pool<Sqlite>>,
) -> ApiResult<Status> {
    let st = get_student_technique(db, id, user.id).await?;
    if user.id != st.student_id && !user.has_permission(Permission::ViewAllStudents) {
        return Err(Status::Forbidden.into());
    }
    mark_student_technique_seen(db, id, user.id).await?;
    Ok(Status::NoContent)
}

#[derive(Deserialize, Clone)]
pub struct GraduateRequest {
    graduated: bool,
}

/// Coach-accessible endpoint to graduate / un-graduate a student.
/// Distinct from `/admin/users/<id>` which is admin-only.
#[post("/student/<id>/graduate", data = "<body>")]
pub async fn api_set_student_graduated(
    id: i64,
    body: Json<GraduateRequest>,
    user: User,
    db: &State<Pool<Sqlite>>,
) -> ApiResult<Status> {
    user.require_permission(Permission::ViewAllStudents)?;

    let target = get_user(db, id).await?;
    if !matches!(target.role, crate::auth::Role::Student) {
        return Err(Status::BadRequest.into());
    }

    set_user_graduated(db, id, body.graduated, Some(user.id)).await?;
    Ok(Status::Ok)
}

#[get("/health")]
pub fn health() -> &'static str {
    "OK"
}
#[derive(Serialize, Deserialize)]
pub struct TagsResponse {
    pub tags: Vec<Tag>,
}

#[derive(Serialize, Deserialize)]
pub struct TagResponse {
    pub id: i64,
    pub name: String,
}

impl From<Tag> for TagResponse {
    fn from(tag: Tag) -> Self {
        Self {
            id: tag.id,
            name: tag.name,
        }
    }
}

#[get("/tags")]
pub async fn api_get_all_tags(
    _user: User,
    db: &State<Pool<Sqlite>>,
) -> ApiResult<Json<TagsResponse>> {
    let tags = get_all_tags(db).await?;
    Ok(Json(TagsResponse { tags }))
}

#[get("/technique/<id>/tags")]
pub async fn api_get_technique_tags(
    id: i64,
    _user: User,
    db: &State<Pool<Sqlite>>,
) -> ApiResult<Json<TagsResponse>> {
    let tags = get_tags_for_technique(db, id).await?;
    Ok(Json(TagsResponse { tags }))
}

#[derive(Deserialize, Validate)]
pub struct CreateTagRequest {
    #[validate(length(
        min = 1,
        max = 50,
        message = "Tag name must be between 1 and 50 characters"
    ))]
    name: String,
}

#[post("/tags", data = "<tag>")]
pub async fn api_create_tag(
    tag: Json<CreateTagRequest>,
    user: User,
    db: &State<Pool<Sqlite>>,
) -> ApiResult<Status> {
    user.require_permission(Permission::ManageTags)?;

    create_tag(db, &tag.name).await?;

    Ok(Status::Ok)
}

#[delete("/tags/<id>")]
pub async fn api_delete_tag(id: i64, user: User, db: &State<Pool<Sqlite>>) -> ApiResult<Status> {
    user.require_permission(Permission::ManageTags)?;
    delete_tag(db, id).await?;
    Ok(Status::Ok)
}

#[derive(Deserialize)]
pub struct TagTechniqueRequest {
    technique_id: i64,
    tag_id: i64,
}

#[post("/technique/tag", data = "<request>")]
pub async fn api_add_tag_to_technique(
    request: Json<TagTechniqueRequest>,
    user: User,
    db: &State<Pool<Sqlite>>,
) -> ApiResult<Status> {
    user.require_permission(Permission::ManageTags)?;
    add_tag_to_technique(db, request.technique_id, request.tag_id, user.id).await?;
    Ok(Status::Ok)
}

#[delete("/technique/<technique_id>/tag/<tag_id>")]
pub async fn api_remove_tag_from_technique(
    technique_id: i64,
    tag_id: i64,
    user: User,
    db: &State<Pool<Sqlite>>,
) -> ApiResult<Status> {
    user.require_permission(Permission::ManageTags)?;
    remove_tag_from_technique(db, technique_id, tag_id, user.id).await?;
    Ok(Status::Ok)
}

#[get("/admin/users")]
pub async fn api_get_all_users(
    user: User,
    db: &State<Pool<Sqlite>>,
) -> ApiResult<Json<Vec<UserData>>> {
    user.require_permission(Permission::EditUserRoles)?;

    let users = get_all_users(db).await?;

    let user_responses: Vec<UserData> = users.into_iter().map(UserData::from).collect();

    Ok(Json(user_responses))
}

// ---- Invite / claim flow ----

#[derive(Deserialize, Validate, Clone)]
pub struct InviteUserRequest {
    #[validate(length(min = 1, max = 100, message = "Display name is required"))]
    display_name: String,
    role: String,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct InviteResponse {
    pub user_id: i64,
    pub token: String,
    pub claim_path: String,
}

/// Create a stub user and an invite token. Coach copies the claim URL and
/// shares it with the student.
#[post("/admin/invite_user", data = "<body>")]
pub async fn api_invite_user(
    body: Json<InviteUserRequest>,
    user: User,
    db: &State<Pool<Sqlite>>,
) -> ApiResult<Json<InviteResponse>> {
    body.validate()?;
    user.require_permission(Permission::RegisterUsers)?;

    if matches!(body.role.as_str(), "admin") {
        user.require_permission(Permission::EditUserRoles)?;
    } else if !matches!(body.role.as_str(), "student" | "coach") {
        return Err(Status::BadRequest.into());
    }

    let user_id = create_user_stub(db, &body.display_name, None, &body.role).await?;
    let token = create_invite_token(db, user_id).await?;
    let claim_path = format!("/invite/{}", token);

    Ok(Json(InviteResponse {
        user_id,
        token,
        claim_path,
    }))
}

#[derive(Serialize, Deserialize, Debug)]
pub struct InviteInfoResponse {
    pub display_name: String,
    pub email: Option<String>,
    pub role: String,
}

/// Public (no auth) endpoint to fetch info about an invite. Returns 410 Gone
/// if the token has been used, expired, or doesn't exist.
#[get("/invite/<token>")]
pub async fn api_get_invite(
    token: String,
    db: &State<Pool<Sqlite>>,
) -> ApiResult<Json<InviteInfoResponse>> {
    let invite = find_valid_invite_token(db, &token)
        .await?
        .ok_or_else(|| ApiError::from(Status { code: 410 }))?;
    let stub = get_user(db, invite.user_id).await?;

    Ok(Json(InviteInfoResponse {
        display_name: stub.display_name,
        email: stub.email,
        role: stub.role.to_string(),
    }))
}

#[derive(Deserialize, Validate, Clone)]
pub struct ClaimInviteRequest {
    #[validate(
        length(
            min = 3,
            max = 50,
            message = "Username must be between 3 and 50 characters"
        ),
        does_not_contain(pattern = " ", message = "Username cannot contain spaces")
    )]
    username: String,
    #[validate(length(min = 5, message = "Password must be at least 5 characters"))]
    password: String,
}

/// Public endpoint to claim an invite. On success, establishes a session
/// cookie so the user lands logged in.
#[post("/invite/<token>/claim", data = "<body>")]
pub async fn api_claim_invite(
    token: String,
    body: Json<ClaimInviteRequest>,
    cookies: &rocket::http::CookieJar<'_>,
    db: &State<Pool<Sqlite>>,
) -> ApiResult<Json<UserData>> {
    body.validate()?;

    let user_id = claim_invite(db, &token, &body.username, &body.password).await?;
    let user = get_user(db, user_id).await?;

    establish_session(cookies, db, &user).await?;

    Ok(Json(UserData::from(user)))
}

// ---- Forgot password ----

#[derive(Deserialize, Validate, Clone)]
pub struct ForgotPasswordRequest {
    #[validate(length(min = 1, message = "Username cannot be empty"))]
    username: String,
}

/// Public endpoint. Flags the matching user's account so coaches see a
/// reset request on their dashboard. Always returns 200 regardless of whether
/// the username exists, so we don't leak account existence.
#[post("/forgot_password", data = "<body>")]
pub async fn api_request_password_reset(
    body: Json<ForgotPasswordRequest>,
    db: &State<Pool<Sqlite>>,
) -> ApiResult<Status> {
    body.validate()?;
    request_password_reset(db, &body.username).await?;
    Ok(Status::Ok)
}

// ---- Self-register + approval ----

#[derive(Deserialize, Validate, Clone)]
pub struct SelfRegisterRequest {
    #[validate(
        length(
            min = 3,
            max = 50,
            message = "Username must be between 3 and 50 characters"
        ),
        does_not_contain(pattern = " ", message = "Username cannot contain spaces")
    )]
    username: String,
    #[validate(length(min = 5, message = "Password must be at least 5 characters"))]
    password: String,
    #[validate(length(max = 50, message = "First name is too long"))]
    first_name: Option<String>,
    #[validate(length(max = 50, message = "Last name is too long"))]
    last_name: Option<String>,
}

/// Public endpoint for students to self-register. Account is created in
/// pending state (`approved_at IS NULL`) until a coach approves it.
#[post("/register/self", data = "<body>")]
pub async fn api_self_register(
    body: Json<SelfRegisterRequest>,
    cookies: &rocket::http::CookieJar<'_>,
    db: &State<Pool<Sqlite>>,
) -> ApiResult<Json<UserData>> {
    body.validate()?;

    let user_id = create_self_registered_user(
        db,
        &body.username,
        &body.password,
        body.first_name.as_deref(),
        body.last_name.as_deref(),
    )
    .await?;
    let user = get_user(db, user_id).await?;

    // Log them in immediately. The frontend will route them to the
    // pending-approval screen since `approved_at` is None.
    establish_session(cookies, db, &user).await?;

    Ok(Json(UserData::from(user)))
}

#[post("/admin/users/<id>/approve")]
pub async fn api_approve_user(id: i64, user: User, db: &State<Pool<Sqlite>>) -> ApiResult<Status> {
    user.require_permission(Permission::RegisterUsers)?;
    approve_user(db, id).await?;
    Ok(Status::Ok)
}

/// Admin endpoint to invalidate a user's password and generate a fresh invite
/// token. Existing sessions for the user are terminated.
#[post("/admin/users/<id>/reset_claim")]
pub async fn api_reset_user_claim(
    id: i64,
    user: User,
    db: &State<Pool<Sqlite>>,
) -> ApiResult<Json<InviteResponse>> {
    user.require_permission(Permission::EditUserCredentials)?;

    let token = reset_user_claim(db, id).await?;
    let claim_path = format!("/invite/{}", token);

    Ok(Json(InviteResponse {
        user_id: id,
        token,
        claim_path,
    }))
}

// ---- Collections / syllabi ----

#[derive(Serialize, Deserialize, Debug)]
pub struct CollectionResponse {
    pub id: i64,
    pub name: String,
    pub description: String,
    pub coach_id: Option<i64>,
    pub created_at: String,
    pub technique_count: i64,
    pub student_count: i64,
    pub techniques: Vec<TechniqueLibraryResponse>,
    pub can_create_techniques: bool,
    pub can_edit_all_techniques: bool,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct TechniqueLibraryResponse {
    pub id: i64,
    pub name: String,
    pub description: String,
    pub coach_id: i64,
    pub coach_name: String,
}

fn collection_to_response(c: Collection, user: &User) -> CollectionResponse {
    CollectionResponse {
        id: c.id,
        name: c.name,
        description: c.description,
        coach_id: c.coach_id,
        created_at: c.created_at.to_rfc3339(),
        technique_count: c.technique_count,
        student_count: c.student_count,
        techniques: c
            .techniques
            .into_iter()
            .map(|t| TechniqueLibraryResponse {
                id: t.id,
                name: t.name,
                description: t.description,
                coach_id: t.coach_id,
                coach_name: t.coach_name,
            })
            .collect(),
        can_create_techniques: user.has_permission(Permission::CreateTechniques),
        can_edit_all_techniques: user.has_permission(Permission::EditAllTechniques),
    }
}

#[get("/collections")]
pub async fn api_get_collections(
    user: User,
    db: &State<Pool<Sqlite>>,
) -> ApiResult<Json<Vec<CollectionResponse>>> {
    user.require_permission(Permission::AssignTechniques)?;
    let collections = get_all_collections(db).await?;
    Ok(Json(
        collections
            .into_iter()
            .map(|c| collection_to_response(c, &user))
            .collect(),
    ))
}

#[get("/collections/<id>")]
pub async fn api_get_collection(
    id: i64,
    user: User,
    db: &State<Pool<Sqlite>>,
) -> ApiResult<Json<CollectionResponse>> {
    user.require_permission(Permission::AssignTechniques)?;
    let collection = get_collection(db, id).await?;
    Ok(Json(collection_to_response(collection, &user)))
}

#[derive(Deserialize, Validate, Clone)]
pub struct CollectionUpsertRequest {
    #[validate(length(min = 1, max = 100, message = "Name is required"))]
    name: String,
    description: Option<String>,
}

#[post("/collections", data = "<body>")]
pub async fn api_create_collection(
    body: Json<CollectionUpsertRequest>,
    user: User,
    db: &State<Pool<Sqlite>>,
) -> ApiResult<Json<CollectionResponse>> {
    body.validate()?;
    user.require_permission(Permission::CreateTechniques)?;
    let id = create_collection(
        db,
        &body.name,
        body.description.as_deref().unwrap_or(""),
        user.id,
    )
    .await?;
    let collection = get_collection(db, id).await?;
    Ok(Json(collection_to_response(collection, &user)))
}

#[put("/collections/<id>", data = "<body>")]
pub async fn api_update_collection(
    id: i64,
    body: Json<CollectionUpsertRequest>,
    user: User,
    db: &State<Pool<Sqlite>>,
) -> ApiResult<Status> {
    body.validate()?;
    user.require_permission(Permission::CreateTechniques)?;
    update_collection(
        db,
        id,
        &body.name,
        body.description.as_deref().unwrap_or(""),
    )
    .await?;
    Ok(Status::Ok)
}

#[delete("/collections/<id>")]
pub async fn api_delete_collection(
    id: i64,
    user: User,
    db: &State<Pool<Sqlite>>,
) -> ApiResult<Status> {
    user.require_permission(Permission::CreateTechniques)?;
    delete_collection(db, id).await?;
    Ok(Status::Ok)
}

#[derive(Deserialize, Clone)]
pub struct AddTechniquesToCollectionRequest {
    technique_ids: Vec<i64>,
}

#[post("/collections/<id>/techniques", data = "<body>")]
pub async fn api_add_techniques_to_collection(
    id: i64,
    body: Json<AddTechniquesToCollectionRequest>,
    user: User,
    db: &State<Pool<Sqlite>>,
) -> ApiResult<Status> {
    user.require_permission(Permission::CreateTechniques)?;
    add_techniques_to_collection(db, id, body.technique_ids.clone()).await?;
    Ok(Status::Ok)
}

#[derive(Deserialize, Validate, Clone)]
pub struct CreateTechniqueInCollectionRequest {
    #[validate(length(
        min = 1,
        max = 100,
        message = "Technique name must be between 1 and 100 characters"
    ))]
    name: String,
    #[validate(length(min = 1, message = "Description cannot be empty"))]
    description: String,
}

#[post("/collections/<id>/create_technique", data = "<body>")]
pub async fn api_create_technique_in_collection(
    id: i64,
    body: Json<CreateTechniqueInCollectionRequest>,
    user: User,
    db: &State<Pool<Sqlite>>,
) -> ApiResult<Json<TechniqueLibraryResponse>> {
    body.validate()?;
    user.require_permission(Permission::CreateTechniques)?;
    let technique_id =
        create_technique_in_collection(db, user.id, id, &body.name, &body.description).await?;
    let coach_name = if user.display_name.is_empty() {
        user.username.clone()
    } else {
        user.display_name.clone()
    };
    Ok(Json(TechniqueLibraryResponse {
        id: technique_id,
        name: body.name.clone(),
        description: body.description.clone(),
        coach_id: user.id,
        coach_name,
    }))
}

#[delete("/collections/<id>/techniques/<technique_id>")]
pub async fn api_remove_technique_from_collection(
    id: i64,
    technique_id: i64,
    user: User,
    db: &State<Pool<Sqlite>>,
) -> ApiResult<Status> {
    user.require_permission(Permission::CreateTechniques)?;
    remove_technique_from_collection(db, id, technique_id).await?;
    Ok(Status::Ok)
}

#[derive(Deserialize, Validate, Clone)]
pub struct UpdateLibraryTechniqueRequest {
    #[validate(length(
        min = 1,
        max = 100,
        message = "Technique name must be between 1 and 100 characters"
    ))]
    name: String,
    #[validate(length(min = 1, message = "Description cannot be empty"))]
    description: String,
}

#[put("/techniques/<id>", data = "<body>")]
pub async fn api_update_library_technique(
    id: i64,
    body: Json<UpdateLibraryTechniqueRequest>,
    user: User,
    db: &State<Pool<Sqlite>>,
) -> ApiResult<Status> {
    body.validate()?;
    user.require_permission(Permission::EditAllTechniques)?;
    update_technique(db, id, &body.name, &body.description, user.id).await?;
    Ok(Status::Ok)
}

#[get("/collections/<id>/students")]
pub async fn api_get_collection_students(
    id: i64,
    user: User,
    db: &State<Pool<Sqlite>>,
) -> ApiResult<Json<Vec<UserData>>> {
    user.require_permission(Permission::ViewAllStudents)?;
    let students = get_students_with_collection(db, id).await?;
    Ok(Json(students.into_iter().map(UserData::from).collect()))
}

#[post("/student/<student_id>/assign_collection/<collection_id>")]
pub async fn api_assign_collection(
    student_id: i64,
    collection_id: i64,
    user: User,
    db: &State<Pool<Sqlite>>,
) -> ApiResult<Status> {
    user.require_permission(Permission::AssignTechniques)?;
    assign_collection_to_student(db, student_id, collection_id, user.id).await?;
    Ok(Status::Ok)
}

// ---- Attempts ----

#[derive(Serialize, Deserialize, Debug)]
pub struct AttemptResponse {
    pub id: i64,
    pub student_technique_id: i64,
    pub recorded_by_id: i64,
    pub recorded_by_name: Option<String>,
    pub attempted_at: String,
    pub coach_note: Option<String>,
    pub coach_note_by_id: Option<i64>,
    pub coach_note_by_name: Option<String>,
    pub coach_note_at: Option<String>,
    pub student_note: Option<String>,
    pub student_note_at: Option<String>,
    pub created_at: String,
}

impl From<crate::models::Attempt> for AttemptResponse {
    fn from(a: crate::models::Attempt) -> Self {
        Self {
            id: a.id,
            student_technique_id: a.student_technique_id,
            recorded_by_id: a.recorded_by_id,
            recorded_by_name: a.recorded_by_name,
            attempted_at: a.attempted_at.to_rfc3339(),
            coach_note: a.coach_note,
            coach_note_by_id: a.coach_note_by_id,
            coach_note_by_name: a.coach_note_by_name,
            coach_note_at: a.coach_note_at.map(|d| d.to_rfc3339()),
            student_note: a.student_note,
            student_note_at: a.student_note_at.map(|d| d.to_rfc3339()),
            created_at: a.created_at.to_rfc3339(),
        }
    }
}

#[derive(Serialize, Deserialize)]
pub struct AttemptListResponse {
    pub attempts: Vec<AttemptResponse>,
}

#[derive(Deserialize, Validate, Clone)]
pub struct CreateAttemptRequest {
    pub attempted_at: Option<String>,
    #[validate(length(max = 2000, message = "Note must be under 2000 characters"))]
    pub note: Option<String>,
}

#[derive(Serialize, Deserialize)]
pub struct CreateAttemptResponse {
    pub attempt: AttemptResponse,
    pub status_suggestion: Option<String>,
}

fn parse_optional_datetime(
    raw: Option<&str>,
) -> Result<Option<chrono::DateTime<chrono::Utc>>, ApiError> {
    match raw {
        None => Ok(None),
        Some(s) => match chrono::DateTime::parse_from_rfc3339(s) {
            Ok(dt) => Ok(Some(dt.with_timezone(&chrono::Utc))),
            Err(_) => Err(Status::BadRequest.into()),
        },
    }
}

#[derive(Serialize, Deserialize)]
pub struct SingleStudentTechniqueResponse {
    pub technique: TechniqueResponse,
    pub student: StudentResponse,
    pub can_edit_all_techniques: bool,
    pub can_manage_tags: bool,
}

#[get("/student_technique/<id>")]
pub async fn api_get_single_student_technique(
    id: i64,
    user: User,
    db: &State<Pool<Sqlite>>,
) -> ApiResult<Json<SingleStudentTechniqueResponse>> {
    let st = get_student_technique(db, id, user.id).await?;
    if user.id != st.student_id && !user.has_permission(Permission::ViewAllStudents) {
        return Err(Status::Forbidden.into());
    }
    let student = get_user(db, st.student_id).await?;

    let has_unseen_activity = compute_has_unseen_activity(
        user.id == st.student_id,
        st.last_coach_update_at,
        st.last_student_update_at,
        st.viewer_seen_at,
    );

    let technique_response = TechniqueResponse {
        id: st.id,
        technique_id: st.technique_id,
        technique_name: st.technique_name,
        technique_description: st.technique_description,
        status: st.status,
        student_notes: st.student_notes,
        coach_notes: st.coach_notes,
        created_at: st.created_at.to_rfc3339(),
        updated_at: st.updated_at.to_rfc3339(),
        last_coach_update_at: st.last_coach_update_at.map(|d| d.to_rfc3339()),
        last_coach_update_by_name: st.last_coach_update_by_name,
        last_student_update_at: st.last_student_update_at.map(|d| d.to_rfc3339()),
        last_student_update_by_name: st.last_student_update_by_name,
        has_unseen_activity,
        collection_id: st.collection_id,
        collection_name: st.collection_name,
        tags: st.tags.into_iter().map(TagResponse::from).collect(),
        attempt_count: st.attempt_count,
        last_attempt_at: st.last_attempt_at.map(|d| d.to_rfc3339()),
    };

    Ok(Json(SingleStudentTechniqueResponse {
        technique: technique_response,
        student: StudentResponse {
            id: student.id,
            username: student.username,
            display_name: student.display_name,
            archived: student.archived,
            graduated_at: student.graduated_at,
        },
        can_edit_all_techniques: user.has_permission(Permission::EditAllTechniques),
        can_manage_tags: user.has_permission(Permission::ManageTags),
    }))
}

#[get("/student_technique/<id>/attempts")]
pub async fn api_list_attempts(
    id: i64,
    user: User,
    db: &State<Pool<Sqlite>>,
) -> ApiResult<Json<AttemptListResponse>> {
    let st = get_student_technique(db, id, user.id).await?;
    if user.id != st.student_id && !user.has_permission(Permission::ViewAllStudents) {
        return Err(Status::Forbidden.into());
    }
    let attempts = list_attempts(db, id).await?;
    Ok(Json(AttemptListResponse {
        attempts: attempts.into_iter().map(AttemptResponse::from).collect(),
    }))
}

#[post("/student_technique/<id>/attempts", data = "<body>")]
pub async fn api_create_attempt(
    id: i64,
    body: Json<CreateAttemptRequest>,
    user: User,
    db: &State<Pool<Sqlite>>,
) -> ApiResult<Json<CreateAttemptResponse>> {
    body.validate()?;
    let attempted_at =
        parse_optional_datetime(body.attempted_at.as_deref())?.unwrap_or_else(chrono::Utc::now);
    let result = create_attempt(db, &user, id, attempted_at, body.note.as_deref()).await?;
    let suggestion = match result.suggestion {
        AttemptSuggestion::Amber => Some("amber".to_string()),
        AttemptSuggestion::None => None,
    };
    Ok(Json(CreateAttemptResponse {
        attempt: AttemptResponse::from(result.attempt),
        status_suggestion: suggestion,
    }))
}

#[derive(Deserialize, Validate, Clone)]
pub struct UpdateAttemptRequest {
    pub attempted_at: Option<String>,
    #[validate(length(max = 2000, message = "Note must be under 2000 characters"))]
    pub note: Option<String>,
    pub clear_note: Option<bool>,
}

#[put("/attempts/<id>", data = "<body>")]
pub async fn api_update_attempt(
    id: i64,
    body: Json<UpdateAttemptRequest>,
    user: User,
    db: &State<Pool<Sqlite>>,
) -> ApiResult<Status> {
    body.validate()?;
    if let Some(raw) = body.attempted_at.as_deref() {
        let dt = chrono::DateTime::parse_from_rfc3339(raw)
            .map_err(|e| {
                warn!(
                    attempt_id = id,
                    raw_value = raw,
                    error = %e,
                    "rejected attempt update: attempted_at not RFC3339"
                );
                ApiError::from(Status::BadRequest)
            })?
            .with_timezone(&chrono::Utc);
        update_attempt_timestamp(db, &user, id, dt).await?;
    }
    if body.clear_note == Some(true) {
        update_attempt_note(db, &user, id, None).await?;
    } else if let Some(note) = &body.note {
        update_attempt_note(db, &user, id, Some(note)).await?;
    }
    Ok(Status::Ok)
}

#[delete("/attempts/<id>")]
pub async fn api_delete_attempt(
    id: i64,
    user: User,
    db: &State<Pool<Sqlite>>,
) -> ApiResult<Status> {
    delete_attempt(db, &user, id).await?;
    Ok(Status::Ok)
}

#[derive(Serialize, Deserialize)]
pub struct RecentAttemptItemResponse {
    pub id: i64,
    pub student_technique_id: i64,
    pub technique_id: i64,
    pub technique_name: String,
    pub attempted_at: String,
    pub coach_note: Option<String>,
    pub student_note: Option<String>,
}

#[derive(Serialize, Deserialize)]
pub struct RecentAttemptsResponse {
    pub attempts: Vec<RecentAttemptItemResponse>,
}

#[derive(FromForm)]
pub struct RecentAttemptsQuery {
    limit: Option<i64>,
}

#[get("/student/<id>/attempts/recent?<params..>")]
pub async fn api_recent_attempts(
    id: i64,
    params: RecentAttemptsQuery,
    user: User,
    db: &State<Pool<Sqlite>>,
) -> ApiResult<Json<RecentAttemptsResponse>> {
    if user.id != id && !user.has_permission(Permission::ViewAllStudents) {
        return Err(Status::Forbidden.into());
    }
    let limit = params.limit.unwrap_or(5).clamp(1, 50);
    let items = list_recent_attempts_for_student(db, id, limit).await?;
    Ok(Json(RecentAttemptsResponse {
        attempts: items
            .into_iter()
            .map(|item| RecentAttemptItemResponse {
                id: item.id,
                student_technique_id: item.student_technique_id,
                technique_id: item.technique_id,
                technique_name: item.technique_name,
                attempted_at: item.attempted_at.to_rfc3339(),
                coach_note: item.coach_note,
                student_note: item.student_note,
            })
            .collect(),
    }))
}

#[derive(Serialize, Deserialize)]
pub struct AttemptSummaryResponse {
    pub this_week: i64,
    pub this_month: i64,
    pub total: i64,
}

#[get("/student/<id>/attempts/summary")]
pub async fn api_attempt_summary(
    id: i64,
    user: User,
    db: &State<Pool<Sqlite>>,
) -> ApiResult<Json<AttemptSummaryResponse>> {
    if user.id != id && !user.has_permission(Permission::ViewAllStudents) {
        return Err(Status::Forbidden.into());
    }
    let summary = attempt_summary_for_student(db, id).await?;
    Ok(Json(AttemptSummaryResponse {
        this_week: summary.this_week,
        this_month: summary.this_month,
        total: summary.total,
    }))
}

#[derive(Serialize, Deserialize)]
pub struct AttemptBucketResponse {
    pub date: String,
    pub count: i64,
}

#[derive(Serialize, Deserialize)]
pub struct AttemptBucketsResponse {
    pub buckets: Vec<AttemptBucketResponse>,
}

#[derive(FromForm)]
pub struct HeatmapQuery {
    from: Option<String>,
    to: Option<String>,
}

#[get("/student/<id>/attempts/heatmap?<params..>")]
pub async fn api_attempt_heatmap(
    id: i64,
    params: HeatmapQuery,
    user: User,
    db: &State<Pool<Sqlite>>,
) -> ApiResult<Json<AttemptBucketsResponse>> {
    if user.id != id && !user.has_permission(Permission::ViewAllStudents) {
        return Err(Status::Forbidden.into());
    }
    let today = chrono::Utc::now().date_naive();
    let default_from = today - chrono::Duration::days(365);
    let from = match params.from.as_deref() {
        Some(s) => chrono::NaiveDate::parse_from_str(s, "%Y-%m-%d").map_err(|e| {
            warn!(
                student_id = id,
                raw_value = s,
                error = %e,
                "rejected heatmap query: from not YYYY-MM-DD"
            );
            ApiError::from(Status::BadRequest)
        })?,
        None => default_from,
    };
    let to = match params.to.as_deref() {
        Some(s) => chrono::NaiveDate::parse_from_str(s, "%Y-%m-%d").map_err(|e| {
            warn!(
                student_id = id,
                raw_value = s,
                error = %e,
                "rejected heatmap query: to not YYYY-MM-DD"
            );
            ApiError::from(Status::BadRequest)
        })?,
        None => today,
    };
    let buckets = attempt_buckets_for_student(db, id, from, to).await?;
    Ok(Json(AttemptBucketsResponse {
        buckets: buckets
            .into_iter()
            .map(|b| AttemptBucketResponse {
                date: b.date.format("%Y-%m-%d").to_string(),
                count: b.count,
            })
            .collect(),
    }))
}

#[derive(FromForm)]
pub struct SparklineQuery {
    weeks: Option<i64>,
}

#[get("/student_technique/<id>/attempts/sparkline?<params..>")]
pub async fn api_attempt_sparkline(
    id: i64,
    params: SparklineQuery,
    user: User,
    db: &State<Pool<Sqlite>>,
) -> ApiResult<Json<AttemptBucketsResponse>> {
    let st = get_student_technique(db, id, user.id).await?;
    if user.id != st.student_id && !user.has_permission(Permission::ViewAllStudents) {
        return Err(Status::Forbidden.into());
    }
    let weeks = params.weeks.unwrap_or(12).clamp(1, 104);
    let buckets = attempt_weekly_buckets_for_technique(db, id, weeks).await?;
    Ok(Json(AttemptBucketsResponse {
        buckets: buckets
            .into_iter()
            .map(|b| AttemptBucketResponse {
                date: b.date.format("%Y-%m-%d").to_string(),
                count: b.count,
            })
            .collect(),
    }))
}

// ---- Activity feed routes (Task 23) ----------------------------------------

const ACTIVITY_FEED_DEFAULT_LIMIT: i64 = 50;
const ACTIVITY_FEED_MAX_LIMIT: i64 = 200;

#[derive(FromForm)]
pub struct ActivityFeedQuery {
    before_ts: Option<String>,
    before_id: Option<i64>,
    limit: Option<i64>,
}

/// Parse an optional RFC3339 or SQLite naive-datetime string into
/// `chrono::NaiveDateTime`. Returns `None` when the input is `None`.
fn parse_before_ts(s: &str) -> Option<chrono::NaiveDateTime> {
    // Try the SQLite storage format first (no T, no offset), then RFC3339,
    // then RFC3339 with sub-seconds.
    chrono::NaiveDateTime::parse_from_str(s, "%Y-%m-%d %H:%M:%S%.f")
        .or_else(|_| chrono::NaiveDateTime::parse_from_str(s, "%Y-%m-%d %H:%M:%S"))
        .or_else(|_| chrono::DateTime::parse_from_rfc3339(s).map(|dt| dt.naive_utc()))
        .ok()
}

/// `GET /api/activity/feed?before_ts=&before_id=&limit=`
///
/// Returns the viewer's activity feed as a JSON array. The viewer's cursor is
/// advanced to `feed_max_id` (snapshotted BEFORE building the page) so rows
/// that arrive during the request are not silently marked as seen.
#[get("/activity/feed?<params..>")]
pub async fn api_activity_feed(
    params: ActivityFeedQuery,
    user: User,
    db: &State<Pool<Sqlite>>,
) -> ApiResult<Json<Vec<ActivityRow>>> {
    let limit = params
        .limit
        .unwrap_or(ACTIVITY_FEED_DEFAULT_LIMIT)
        .clamp(1, ACTIVITY_FEED_MAX_LIMIT);

    let before = match (&params.before_ts, params.before_id) {
        (Some(ts_str), Some(id)) => {
            let ts = parse_before_ts(ts_str).ok_or_else(|| {
                warn!(
                    raw = ts_str,
                    "rejected activity/feed: unparseable before_ts"
                );
                ApiError::from(Status::BadRequest)
            })?;
            Some((ts, id))
        }
        (None, None) => None,
        _ => {
            warn!(
                "rejected activity/feed: partial cursor (before_ts and before_id must both be present or both absent)"
            );
            return Err(Status::BadRequest.into());
        }
    };

    // Snapshot the max id BEFORE building the page; advance cursor AFTER.
    let snapshot_max = feed_max_id(db, user.id, user.role.clone()).await?;
    let rows = feed(db, user.id, user.role.clone(), before, limit).await?;
    advance_cursor_to(db, user.id, snapshot_max).await?;

    Ok(Json(rows))
}

#[derive(Serialize)]
pub struct UnreadCountResponse {
    pub count: i64,
}

/// `GET /api/activity/unread_count`
#[get("/activity/unread_count")]
pub async fn api_activity_unread_count(
    user: User,
    db: &State<Pool<Sqlite>>,
) -> ApiResult<Json<UnreadCountResponse>> {
    let count = unread_count(db, user.id, user.role.clone()).await?;
    Ok(Json(UnreadCountResponse { count }))
}

/// `POST /api/activity/mark_all_read`
#[post("/activity/mark_all_read")]
pub async fn api_activity_mark_all_read(user: User, db: &State<Pool<Sqlite>>) -> ApiResult<Status> {
    mark_all_read(db, user.id).await?;
    Ok(Status::NoContent)
}

/// `POST /api/activity/<activity_id>/read`
#[post("/activity/<activity_id>/read")]
pub async fn api_activity_mark_one_read(
    activity_id: i64,
    user: User,
    db: &State<Pool<Sqlite>>,
) -> ApiResult<Status> {
    mark_one_read(db, user.id, activity_id).await?;
    Ok(Status::NoContent)
}

/// `POST /api/activity/<activity_id>/unread`
#[post("/activity/<activity_id>/unread")]
pub async fn api_activity_mark_one_unread(
    activity_id: i64,
    user: User,
    db: &State<Pool<Sqlite>>,
) -> ApiResult<Status> {
    mark_one_unread(db, user.id, activity_id).await?;
    Ok(Status::NoContent)
}

// ---- Student-scoped activity feed (coach viewing a student profile) --------

/// `GET /api/student/<sid>/activity_feed?before_ts=&before_id=&limit=`
///
/// Returns activity rows scoped to the given student (target_student_id = sid).
/// Authorized for the owning student OR any viewer with ViewAllStudents (coaches).
///
/// The student variant of `feed` already filters `target_student_id = sid` and
/// annotates unread against sid's own cursor, so the result is exactly what the
/// student themselves would see. This route does NOT advance any cursor
/// (read-only scoped view; the student's own cursor is advanced by the main
/// `/api/activity/feed` endpoint when the student opens their own feed).
#[get("/student/<sid>/activity_feed?<params..>")]
pub async fn api_student_activity_feed(
    sid: i64,
    params: ActivityFeedQuery,
    user: User,
    db: &State<Pool<Sqlite>>,
) -> ApiResult<Json<Vec<ActivityRow>>> {
    if user.id != sid && !user.has_permission(Permission::ViewAllStudents) {
        return Err(Status::Forbidden.into());
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
                    "rejected student activity_feed: unparseable before_ts"
                );
                ApiError::from(Status::BadRequest)
            })?;
            Some((ts, id))
        }
        (None, None) => None,
        _ => {
            warn!(
                "rejected student activity_feed: partial cursor (before_ts and before_id must both be present or both absent)"
            );
            return Err(Status::BadRequest.into());
        }
    };

    // Use the student-variant of feed (target_student_id = sid, unread
    // annotated against sid's cursor). Pass sid as the viewer so unread
    // annotations reflect the student's perspective.
    let rows = feed(db, sid, crate::auth::Role::Student, before, limit).await?;

    Ok(Json(rows))
}

// ---- Shared helpers ---------------------------------------------------------

/// Resolves the from/to window for heatmap queries.
/// Defaults: from = today minus 365 days, to = today.
/// Returns `Err(ApiError)` if either string is present but not YYYY-MM-DD.
fn resolve_heatmap_window(
    params: &HeatmapQuery,
) -> Result<(chrono::NaiveDate, chrono::NaiveDate), ApiError> {
    let today = chrono::Utc::now().date_naive();
    let default_from = today - chrono::Duration::days(365);
    let from = match params.from.as_deref() {
        Some(s) => chrono::NaiveDate::parse_from_str(s, "%Y-%m-%d")
            .map_err(|_| ApiError::from(Status::BadRequest))?,
        None => default_from,
    };
    let to = match params.to.as_deref() {
        Some(s) => chrono::NaiveDate::parse_from_str(s, "%Y-%m-%d")
            .map_err(|_| ApiError::from(Status::BadRequest))?,
        None => today,
    };
    Ok((from, to))
}

// ---- Coach dashboard recently-active route (Task 24) -----------------------

// ---- New syllabus-backed student dashboard routes --------------------------

#[get("/student/<id>/syllabus_techniques")]
pub async fn api_student_syllabus_techniques_flat(
    id: i64,
    user: User,
    db: &State<Pool<Sqlite>>,
) -> ApiResult<Json<Vec<crate::db::StudentSyllabusTechniqueOverview>>> {
    if user.id != id && !user.has_permission(Permission::ViewAllStudents) {
        return Err(Status::Forbidden.into());
    }
    Ok(Json(crate::db::list_sst_flat_for_student(db, id).await?))
}

#[get("/student/<id>/syllabus_attempts/recent?<params..>")]
pub async fn api_student_recent_syllabus_attempts(
    id: i64,
    params: RecentAttemptsQuery,
    user: User,
    db: &State<Pool<Sqlite>>,
) -> ApiResult<Json<Vec<crate::models::AttemptListItem>>> {
    if user.id != id && !user.has_permission(Permission::ViewAllStudents) {
        return Err(Status::Forbidden.into());
    }
    let limit = params.limit.unwrap_or(5).clamp(1, 50);
    Ok(Json(
        crate::db::list_recent_syllabus_attempts_for_student(db, id, limit).await?,
    ))
}

#[get("/student/<id>/syllabus_attempts/heatmap?<params..>")]
pub async fn api_student_syllabus_attempt_heatmap(
    id: i64,
    params: HeatmapQuery,
    user: User,
    db: &State<Pool<Sqlite>>,
) -> ApiResult<Json<Vec<crate::models::AttemptBucket>>> {
    if user.id != id && !user.has_permission(Permission::ViewAllStudents) {
        return Err(Status::Forbidden.into());
    }
    // Reuse the same default window the legacy heatmap route uses.
    let (from, to) = resolve_heatmap_window(&params)?;
    Ok(Json(
        crate::db::syllabus_attempt_buckets_for_student(db, id, from, to).await?,
    ))
}

/// `GET /api/activity/recently_active?limit=`
///
/// Returns each student's most-recent activity row, ordered by recency (most
/// recent first). Coach-facing. Intended to replace the legacy
/// `get_students_by_recent_updates` read for the "recently active students"
/// panel; the legacy endpoint at `GET /api/students` remains unchanged until
/// the frontend migration in Task 26.
#[get("/activity/recently_active?<limit>")]
pub async fn api_recently_active_students(
    limit: Option<i64>,
    user: User,
    db: &State<Pool<Sqlite>>,
) -> ApiResult<Json<Vec<crate::db::StudentLatestActivity>>> {
    user.require_permission(Permission::ViewAllStudents)?;
    let n = limit.unwrap_or(50).clamp(1, 200);
    let rows = recently_active_students(db, n).await?;
    Ok(Json(rows))
}
