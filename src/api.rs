use rocket::FromForm;
use rocket::State;
use rocket::http::Status;
use rocket::response::Redirect;
use rocket::response::status::Custom;
use rocket::serde::{Deserialize, Serialize, json::Json};
use sqlx::{Pool, Sqlite};
use validator::Validate;

use crate::auth::UserSession;
use crate::auth::{Permission, User};
use crate::db::add_tag_to_technique;
use crate::db::create_tag;
use crate::db::create_user;
use crate::db::delete_tag;
use crate::db::find_user_by_username;
use crate::db::get_all_tags;
use crate::db::get_all_users;
use crate::db::get_tags_for_technique;
use crate::db::remove_tag_from_technique;
use crate::db::set_user_archived;
use crate::db::update_user_display_name;
use crate::db::update_user_password;
use crate::db::update_user_role;
use crate::db::update_username;
use crate::db::{
    add_techniques_to_student, authenticate_user, create_and_assign_technique, create_user_session,
    get_student_technique, get_student_techniques, get_students_by_recent_updates,
    get_unassigned_techniques, get_user, get_users_by_role, invalidate_session,
    update_student_notes, update_student_technique, update_technique,
};
use crate::models::Tag;
use crate::models::Technique;
use crate::validation::AppErrorExt;
use crate::validation::JsonValidateExt;
use crate::validation::PermissionCheckExt;
use crate::validation::ValidationResponse;

#[derive(Deserialize, Validate)]
pub struct LoginRequest {
    username: String,
    password: String,
}

#[derive(Serialize, Deserialize)]
pub struct LoginResponse {
    pub success: bool,
    pub user: Option<UserData>,
    pub error: Option<String>,
    pub redirect_url: Option<String>,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct UserData {
    pub id: i64,
    pub username: String,
    pub display_name: String,
    pub role: String,
    pub last_update: Option<String>,
    pub archived: bool,
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
        }
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
    pub tags: Vec<TagResponse>,
}

#[derive(Serialize, Deserialize)]
pub struct StudentResponse {
    pub id: i64,
    pub username: String,
    pub display_name: String,
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

#[post("/login", data = "<login>")]
pub async fn api_login(
    login: Json<LoginRequest>,
    cookies: &rocket::http::CookieJar<'_>,
    db: &State<Pool<Sqlite>>,
) -> Result<Json<LoginResponse>, Custom<Json<ValidationResponse>>> {
    use chrono::Utc;
    use rocket::http::{Cookie, SameSite};

    let validated = login.validate_custom()?;

    match authenticate_user(db, &validated.username, &validated.password)
        .await
        .validate_custom()?
    {
        Some(user) => {
            // Create session token
            let token = UserSession::generate_token();
            let expires_at = Utc::now() + chrono::Duration::hours(1);

            create_user_session(db, user.id, &token, expires_at.naive_utc())
                .await
                .validate_custom()?;

            // Set cookies
            let cookie = Cookie::build(("session_token", token))
                .same_site(SameSite::Lax)
                .http_only(true)
                .max_age(rocket::time::Duration::hours(1));
            cookies.add_private(cookie);

            cookies.add_private(
                Cookie::build(("user_id", user.id.to_string()))
                    .same_site(SameSite::Lax)
                    .http_only(true)
                    .max_age(rocket::time::Duration::hours(1)),
            );

            cookies.add_private(
                Cookie::build(("logged_in", validated.username))
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

#[get("/student/<id>/techniques")]
pub async fn api_get_student_techniques(
    id: i64,
    user: User,
    db: &State<Pool<Sqlite>>,
) -> Result<Json<StudentTechniquesResponse>, Status> {
    if user.id != id && !user.has_permission(Permission::ViewAllStudents) {
        return Err(Status::Forbidden);
    }

    let student = get_user(db, id).await?;

    let techniques = get_student_techniques(db, id).await?;

    let technique_responses: Vec<TechniqueResponse> = techniques
        .into_iter()
        .map(|t| TechniqueResponse {
            id: t.id,
            technique_id: t.technique_id,
            technique_name: t.technique_name,
            technique_description: t.technique_description,
            status: t.status,
            student_notes: t.student_notes,
            coach_notes: t.coach_notes,
            created_at: t.created_at.to_rfc3339(),
            updated_at: t.updated_at.to_rfc3339(),
            tags: t.tags.into_iter().map(TagResponse::from).collect(), // Convert tags to TagResponse
        })
        .collect();

    Ok(Json(StudentTechniquesResponse {
        student: StudentResponse {
            id: student.id,
            username: student.username,
            display_name: student.display_name,
        },
        techniques: technique_responses,
        can_edit_all_techniques: user.has_permission(Permission::EditAllTechniques),
        can_assign_techniques: user.has_permission(Permission::AssignTechniques),
        can_create_techniques: user.has_permission(Permission::CreateTechniques),
        can_manage_tags: user.has_permission(Permission::ManageTags),
    }))
}

#[derive(Deserialize)]
pub struct TechniqueUpdateRequest {
    status: Option<String>,
    student_notes: Option<String>,
    coach_notes: Option<String>,
    technique_name: Option<String>,
    technique_description: Option<String>,
}

#[put("/student_technique/<id>", data = "<technique>")]
pub async fn api_update_student_technique(
    id: i64,
    technique: Json<TechniqueUpdateRequest>,
    user: User,
    db: &State<Pool<Sqlite>>,
) -> Result<Status, Status> {
    let student_technique = get_student_technique(db, id).await?;

    let is_own_technique = user.id == student_technique.student_id;
    let can_edit_all = user.has_permission(Permission::EditAllTechniques);

    if !is_own_technique && !can_edit_all {
        return Err(Status::Forbidden);
    }

    if is_own_technique && !can_edit_all {
        if let Some(notes) = &technique.student_notes {
            update_student_notes(db, id, notes).await?;
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

        update_student_technique(db, id, &status, &student_notes, &coach_notes).await?;

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

    Err(Status::BadRequest)
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
) -> Result<Json<Vec<UserData>>, Status> {
    user.require_permission(Permission::ViewAllStudents)?;

    let include_archived = params.include_archived.unwrap_or(false);

    let students = match params.sort_by.as_deref() {
        Some("recent_update") => get_students_by_recent_updates(db, include_archived).await?,
        _ => get_users_by_role(db, "student", include_archived).await?,
    };

    let student_responses: Vec<UserData> = students
        .iter()
        .map(|s| UserData {
            id: s.id,
            username: s.username.clone(),
            display_name: s.display_name.clone(),
            role: s.role.to_string(),
            last_update: s.last_update.clone(),
            archived: s.archived,
        })
        .collect();

    Ok(Json(student_responses))
}

#[get("/student/<id>/unassigned_techniques")]
pub async fn api_get_unassigned_techniques(
    id: i64,
    user: User,
    db: &State<Pool<Sqlite>>,
) -> Result<Json<Vec<Technique>>, Status> {
    user.require_permission(Permission::AssignTechniques)?;

    let techniques = get_unassigned_techniques(db, id).await?;

    Ok(Json(techniques))
}

#[derive(Deserialize)]
pub struct AssignTechniquesRequest {
    technique_ids: Vec<i64>,
}

#[post("/student/<student_id>/add_techniques", data = "<request>")]
pub async fn api_assign_techniques(
    student_id: i64,
    request: Json<AssignTechniquesRequest>,
    user: User,
    db: &State<Pool<Sqlite>>,
) -> Result<Status, Status> {
    user.require_permission(Permission::AssignTechniques)?;

    add_techniques_to_student(db, student_id, request.technique_ids.clone()).await?;

    Ok(Status::Ok)
}

#[derive(Deserialize)]
pub struct CreateTechniqueRequest {
    name: String,
    description: String,
}

#[post("/student/<student_id>/create_technique", data = "<request>")]
pub async fn api_create_and_assign_technique(
    student_id: i64,
    request: Json<CreateTechniqueRequest>,
    user: User,
    db: &State<Pool<Sqlite>>,
) -> Result<Status, Status> {
    user.require_all_permissions(&[Permission::CreateTechniques, Permission::AssignTechniques])?;

    create_and_assign_technique(db, user.id, student_id, &request.name, &request.description)
        .await?;

    Ok(Status::Ok)
}

#[get("/me")]
pub async fn api_me(user: User) -> Json<UserData> {
    Json(UserData::from(user))
}

#[get("/me", rank = 2)]
pub async fn api_me_unauthorized() -> Status {
    Status::Unauthorized
}

#[post("/logout")]
pub async fn api_logout(
    cookies: &rocket::http::CookieJar<'_>,
    db: &State<Pool<Sqlite>>,
) -> Redirect {
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

    Redirect::to("/ui/")
}

#[derive(Deserialize, Validate, Clone)]
pub struct ProfileUpdateRequest {
    display_name: String,
}

#[put("/profile", data = "<profile>")]
pub async fn api_update_profile(
    profile: Json<ProfileUpdateRequest>,
    user: User,
    db: &State<Pool<Sqlite>>,
) -> Result<Status, Custom<Json<ValidationResponse>>> {
    profile.clone().validate_custom()?;

    update_user_display_name(db, user.id, &profile.display_name)
        .await
        .validate_custom()?;

    Ok(Status::Ok)
}

#[derive(Deserialize, Validate)]
pub struct PasswordChangeRequest {
    current_password: String,
    new_password: String,
}

#[post("/change-password", data = "<password>")]
pub async fn api_change_password(
    password: Json<PasswordChangeRequest>,
    user: User,
    db: &State<Pool<Sqlite>>,
) -> Result<Status, Custom<Json<ValidationResponse>>> {
    let validated = password.validate_custom()?;

    let is_valid = authenticate_user(db, &user.username, &validated.current_password)
        .await
        .validate_custom()?;

    match is_valid {
        Some(_) => {
            update_user_password(db, user.id, &validated.new_password)
                .await
                .validate_custom()?;

            Ok(Status::Ok)
        }
        _ => Err(Custom(
            Status::Unauthorized,
            Json(ValidationResponse::with_error(
                "current_password",
                "Current password is incorrect",
            )),
        )),
    }
}

#[derive(Deserialize, Validate, Clone)]
pub struct UserRegistrationRequest {
    username: String,
    display_name: String,
    password: String,
    role: String,
}

#[post("/register", data = "<registration>")]
pub async fn api_register_user(
    registration: Json<UserRegistrationRequest>,
    user: User,
    db: &State<Pool<Sqlite>>,
) -> Result<Status, Custom<Json<ValidationResponse>>> {
    let validated = registration.clone().validate_custom()?;

    let existing_user = find_user_by_username(db, &registration.username)
        .await
        .validate_custom()?;

    if existing_user.is_some() {
        return Err(Custom(
            Status::Conflict,
            Json(ValidationResponse::with_error(
                "username",
                "Username already exists",
            )),
        ));
    }

    match validated.role.as_str() {
        "admin" => user
            .require_all_permissions(&[Permission::EditUserRoles, Permission::RegisterUsers])
            .validate_custom()?,
        _ => user
            .require_permission(Permission::RegisterUsers)
            .validate_custom()?,
    };

    create_user(
        db,
        &validated.username,
        &validated.password,
        &validated.role,
        Some(&validated.display_name),
    )
    .await
    .validate_custom()?;

    Ok(Status::Created)
}

#[derive(Deserialize)]
pub struct UserUpdateRequest {
    username: Option<String>,
    display_name: Option<String>,
    password: Option<String>,
    archived: Option<bool>,
    role: Option<String>,
}

#[put("/admin/users/<id>", data = "<update>")]
pub async fn api_update_user(
    id: i64,
    update: Json<UserUpdateRequest>,
    user: User,
    db: &State<Pool<Sqlite>>,
) -> Result<Status, Status> {
    user.require_permission(Permission::EditUserCredentials)?;

    // For role changes, require EditUserRoles permission
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

    if let Some(role) = &update.role {
        update_user_role(db, id, role).await?;
    }

    Ok(Status::Ok)
}

#[get("/health")]
pub fn health() -> &'static str {
    "OK"
}

#[derive(Deserialize)]
pub struct CreateTagRequest {
    name: String,
}

#[derive(Deserialize)]
pub struct TagTechniqueRequest {
    technique_id: i64,
    tag_id: i64,
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
) -> Result<Json<TagsResponse>, Status> {
    let tags = get_all_tags(db).await?;
    Ok(Json(TagsResponse { tags }))
}

#[post("/tags", data = "<tag>")]
pub async fn api_create_tag(
    tag: Json<CreateTagRequest>,
    user: User,
    db: &State<Pool<Sqlite>>,
) -> Result<Status, Status> {
    user.require_permission(Permission::ManageTags)?;

    create_tag(db, &tag.name).await?;

    Ok(Status::Ok)
}

#[delete("/tags/<id>")]
pub async fn api_delete_tag(
    id: i64,
    user: User,
    db: &State<Pool<Sqlite>>,
) -> Result<Status, Status> {
    user.require_permission(Permission::ManageTags)?;
    delete_tag(db, id).await?;
    Ok(Status::Ok)
}

#[post("/technique/tag", data = "<request>")]
pub async fn api_add_tag_to_technique(
    request: Json<TagTechniqueRequest>,
    user: User,
    db: &State<Pool<Sqlite>>,
) -> Result<Status, Status> {
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
) -> Result<Status, Status> {
    user.require_permission(Permission::ManageTags)?;
    remove_tag_from_technique(db, technique_id, tag_id).await?;
    Ok(Status::Ok)
}

#[get("/technique/<id>/tags")]
pub async fn api_get_technique_tags(
    id: i64,
    _user: User,
    db: &State<Pool<Sqlite>>,
) -> Result<Json<TagsResponse>, Status> {
    // Everyone can view tags
    let tags = get_tags_for_technique(db, id).await?;
    Ok(Json(TagsResponse { tags }))
}

#[get("/admin/users")]
pub async fn api_get_all_users(
    user: User,
    db: &State<Pool<Sqlite>>,
) -> Result<Json<Vec<UserData>>, Status> {
    user.require_permission(Permission::EditUserRoles)?;

    let users = get_all_users(db).await?;

    let user_responses: Vec<UserData> = users
        .iter()
        .map(|u| UserData {
            id: u.id,
            username: u.username.clone(),
            display_name: u.display_name.clone(),
            role: u.role.to_string(),
            last_update: u.last_update.clone(),
            archived: u.archived,
        })
        .collect();

    Ok(Json(user_responses))
}
