use rocket::State;
use rocket::fs::NamedFile;
use rocket::http::Status;
use rocket::response::Redirect;
use rocket::serde::{Deserialize, Serialize, json::Json};
use sqlx::{Pool, Sqlite};

use crate::auth::{Permission, User};
use crate::db::{
    add_techniques_to_student, authenticate_user, create_and_assign_technique, create_user_session,
    get_student_technique, get_student_techniques, get_unassigned_techniques, get_user,
    get_user_by_username, get_users_by_role, invalidate_session, update_student_notes,
    update_student_technique, update_technique,
};
use crate::models::Technique;

#[derive(Deserialize)]
pub struct LoginRequest {
    username: String,
    password: String,
}

#[derive(Serialize)]
pub struct LoginResponse {
    success: bool,
    user: Option<UserData>,
    error: Option<String>,
    redirect_url: Option<String>,
}

#[derive(Serialize)]
pub struct UserData {
    id: i64,
    username: String,
    display_name: String,
    role: String,
}

impl From<User> for UserData {
    fn from(user: User) -> Self {
        Self {
            id: user.id,
            username: user.username.clone(),
            display_name: user.display_name.clone(),
            role: user.role.to_string(),
        }
    }
}

#[derive(Serialize)]
pub struct TechniqueResponse {
    id: i64,
    technique_id: i64,
    technique_name: String,
    technique_description: String,
    status: String,
    student_notes: String,
    coach_notes: String,
    created_at: String,
    updated_at: String,
}

#[derive(Serialize)]
pub struct StudentResponse {
    id: i64,
    username: String,
    display_name: String,
}

#[derive(Serialize)]
pub struct StudentTechniquesResponse {
    student: StudentResponse,
    techniques: Vec<TechniqueResponse>,
    can_edit_all_techniques: bool,
    can_assign_techniques: bool,
    can_create_techniques: bool,
}

#[post("/login", data = "<login>")]
pub async fn api_login(
    login: Json<LoginRequest>,
    cookies: &rocket::http::CookieJar<'_>,
    db: &State<Pool<Sqlite>>,
) -> Json<LoginResponse> {
    use chrono::Utc;
    use rocket::http::{Cookie, SameSite};

    match authenticate_user(db, &login.username, &login.password).await {
        Ok(true) => match get_user_by_username(db, &login.username).await {
            Ok(user) => {
                let token = crate::auth::UserSession::generate_token();
                let expires_at = Utc::now() + chrono::Duration::hours(1);

                match create_user_session(db, user.id, &token, expires_at.naive_utc()).await {
                    Ok(_) => {
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
                            Cookie::build(("logged_in", login.username.clone()))
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

                        Json(LoginResponse {
                            success: true,
                            user: Some(UserData {
                                id: user.id,
                                username: user.username.clone(),
                                display_name: user.display_name.clone(),
                                role: user.role.to_string(),
                            }),
                            error: None,
                            redirect_url: Some(redirect_url),
                        })
                    }
                    Err(_) => Json(LoginResponse {
                        success: false,
                        user: None,
                        error: Some("Failed to create session".to_string()),
                        redirect_url: None,
                    }),
                }
            }
            Err(_) => Json(LoginResponse {
                success: false,
                user: None,
                error: Some("User not found".to_string()),
                redirect_url: None,
            }),
        },
        _ => Json(LoginResponse {
            success: false,
            user: None,
            error: Some("Invalid username or password".to_string()),
            redirect_url: None,
        }),
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

#[get("/students")]
pub async fn api_get_students(
    user: User,
    db: &State<Pool<Sqlite>>,
) -> Result<Json<Vec<UserData>>, Status> {
    if !user.has_permission(Permission::ViewAllStudents) {
        return Err(Status::Forbidden);
    }

    let students = get_users_by_role(db, "student", false).await?;

    let student_responses: Vec<UserData> = students
        .iter()
        .map(|s| UserData {
            id: s.id,
            username: s.username.clone(),
            display_name: s.display_name.clone(),
            role: s.role.to_string(),
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

#[get("/<_..>", rank = 2)]
pub async fn serve_spa_fallback() -> Option<NamedFile> {
    NamedFile::open("./frontend/dist/index.html").await.ok()
}

#[get("/ui")]
pub async fn serve_spa_fallback_2() -> Option<NamedFile> {
    NamedFile::open("./frontend/dist/index.html").await.ok()
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
