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
use validator::Validate;
use validator::ValidationErrors;

use crate::auth::UserSession;
use crate::auth::{Permission, User};
use crate::db::{
    add_tag_to_technique, add_technique_to_collection, add_techniques_to_student, approve_user,
    assign_collection_to_student, authenticate_user, claim_invite, count_techniques,
    create_and_assign_technique, create_collection, create_invite_token,
    create_self_registered_user, create_tag, create_user, create_user_session, create_user_stub,
    delete_collection, delete_tag, find_user_by_username, find_valid_invite_token,
    get_all_collections, get_all_tags, get_all_users, get_collection, get_student_technique,
    get_student_techniques, get_students_by_recent_updates, get_students_with_collection,
    get_tags_for_technique, get_unassigned_techniques, get_user, invalidate_session,
    read_and_bump_last_seen, remove_tag_from_technique, remove_technique_from_collection,
    request_password_reset, reset_user_claim, set_user_archived, set_user_graduated,
    update_collection, update_student_notes, update_student_technique, update_technique,
    update_user_display_name, update_user_password, update_user_role, update_username, Collection,
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
    pub has_new_student_activity: Option<bool>,
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
            has_new_student_activity: user.has_new_student_activity,
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
    let expires_at = Utc::now() + chrono::Duration::hours(1);
    create_user_session(db, user.id, &token, expires_at.naive_utc()).await?;

    cookies.add_private(
        Cookie::build(("session_token", token))
            .same_site(SameSite::Lax)
            .http_only(true)
            .max_age(rocket::time::Duration::hours(1)),
    );
    cookies.add_private(
        Cookie::build(("user_id", user.id.to_string()))
            .same_site(SameSite::Lax)
            .http_only(true)
            .max_age(rocket::time::Duration::hours(1)),
    );
    cookies.add_private(
        Cookie::build(("logged_in", user.username.clone()))
            .same_site(SameSite::Lax)
            .max_age(rocket::time::Duration::hours(1)),
    );
    let current_timestamp = rocket::time::OffsetDateTime::now_utc()
        .unix_timestamp()
        .to_string();
    cookies.add_private(
        Cookie::build(("session_timestamp", current_timestamp))
            .same_site(SameSite::Lax)
            .max_age(rocket::time::Duration::hours(1)),
    );
    cookies.add_private(
        Cookie::build(("user_role", user.role.to_string()))
            .same_site(SameSite::Lax)
            .max_age(rocket::time::Duration::hours(1)),
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
    pub has_new_student_activity: bool,
    pub tags: Vec<TagResponse>,
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

    let techniques = get_student_techniques(db, id).await?;

    let technique_responses: Vec<TechniqueResponse> = techniques
        .into_iter()
        .map(|t| {
            let has_new_student_activity = match (t.last_student_update_at, t.last_coach_update_at)
            {
                (Some(student), Some(coach)) => student > coach,
                (Some(_), None) => true,
                _ => false,
            };
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
                has_new_student_activity,
                tags: t.tags.into_iter().map(TagResponse::from).collect(),
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

    let student_technique = get_student_technique(db, id).await?;

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
    let students = get_students_by_recent_updates(db, include_archived).await?;

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
}

#[put("/profile", data = "<profile>")]
pub async fn api_update_profile(
    profile: Json<ProfileUpdateRequest>,
    user: User,
    db: &State<Pool<Sqlite>>,
) -> ApiResult<Status> {
    profile.validate()?;

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

#[derive(Serialize, Deserialize)]
pub struct SeenResponse {
    pub previous_last_seen_at: Option<String>,
}

/// Bump the current user's `last_seen_at` to NOW and return the previous value.
/// The dashboard calls this on mount to compute "new from coach since last visit".
#[post("/me/seen")]
pub async fn api_bump_last_seen(
    user: User,
    db: &State<Pool<Sqlite>>,
) -> ApiResult<Json<SeenResponse>> {
    let previous = read_and_bump_last_seen(db, user.id).await?;
    Ok(Json(SeenResponse {
        previous_last_seen_at: previous,
    }))
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
    add_tag_to_technique(db, request.technique_id, request.tag_id).await?;
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
    remove_tag_from_technique(db, technique_id, tag_id).await?;
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
pub async fn api_approve_user(
    id: i64,
    user: User,
    db: &State<Pool<Sqlite>>,
) -> ApiResult<Status> {
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

// ---- Collections / syllabuses ----

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
}

#[derive(Serialize, Deserialize, Debug)]
pub struct TechniqueLibraryResponse {
    pub id: i64,
    pub name: String,
    pub description: String,
    pub coach_id: i64,
    pub coach_name: String,
}

fn collection_to_response(c: Collection) -> CollectionResponse {
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
        collections.into_iter().map(collection_to_response).collect(),
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
    Ok(Json(collection_to_response(collection)))
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
    Ok(Json(collection_to_response(collection)))
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
pub struct AddTechniqueToCollectionRequest {
    technique_id: i64,
}

#[post("/collections/<id>/techniques", data = "<body>")]
pub async fn api_add_technique_to_collection(
    id: i64,
    body: Json<AddTechniqueToCollectionRequest>,
    user: User,
    db: &State<Pool<Sqlite>>,
) -> ApiResult<Status> {
    user.require_permission(Permission::CreateTechniques)?;
    add_technique_to_collection(db, id, body.technique_id).await?;
    Ok(Status::Ok)
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
    assign_collection_to_student(db, student_id, collection_id).await?;
    Ok(Status::Ok)
}
