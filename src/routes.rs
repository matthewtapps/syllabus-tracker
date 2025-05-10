use rocket::Request;
use rocket::form::{Contextual, Form, FromForm};
use rocket::http::{Cookie, CookieJar, SameSite};
use rocket::response::{self, Redirect, Responder};
use rocket::{State, http::Status};
use rocket_dyn_templates::{Template, context};
use serde_json::json;
use sqlx::{Pool, Sqlite};
use tracing::info;

use crate::auth::{Permission, Role, User};
use crate::db::{
    add_techniques_to_student, assign_technique_to_student, authenticate_user,
    create_and_assign_technique, get_all_techniques, get_all_users, get_student_technique,
    get_unassigned_techniques, get_users_by_role, set_user_archived, update_student_notes,
    update_student_technique, update_technique, update_user_admin, update_user_display_name,
    update_user_password, update_username,
};
use crate::db::{get_student_techniques, get_user};
use crate::error::AppError;
use crate::models::{StudentTechnique, Technique};

pub enum IndexResponse {
    TemplateResponse(Template),
    RedirectResponse(Redirect),
    ErrorResponse(Status),
}

impl<'r> Responder<'r, 'static> for IndexResponse {
    fn respond_to(self, request: &'r Request<'_>) -> response::Result<'static> {
        match self {
            IndexResponse::TemplateResponse(template) => template.respond_to(request),
            IndexResponse::RedirectResponse(redirect) => redirect.respond_to(request),
            IndexResponse::ErrorResponse(status) => status.respond_to(request),
        }
    }
}

#[get("/")]
pub async fn index(user: User, db: &State<Pool<Sqlite>>) -> IndexResponse {
    info!("Accessing index page");
    match user.role {
        Role::Student => {
            IndexResponse::RedirectResponse(Redirect::to(format!("/student/{}", user.id)))
        }
        _ => {
            if !user.has_permission(Permission::ViewAllStudents) {
                return IndexResponse::ErrorResponse(Status::Forbidden);
            }

            match get_users_by_role(db, "student", false).await {
                Ok(students) => IndexResponse::TemplateResponse(Template::render(
                    "index",
                    context! {
                        title: "Jiu Jitsu Syllabus Tracker",
                        students: students,
                        current_user: user,
                        current_route: "home",
                    },
                )),
                Err(err) => {
                    err.log_and_record("Index page");
                    IndexResponse::ErrorResponse(err.status_code())
                }
            }
        }
    }
}

#[get("/", rank = 2)]
pub fn index_anon() -> Redirect {
    info!("Redirecting to login");

    Redirect::to("/login")
}

#[get("/student/<id>")]
pub async fn student_techniques(
    id: i64,
    user: User,
    db: &State<Pool<Sqlite>>,
) -> Result<Template, Status> {
    info!("Accessing student-specific page");
    if user.id != id && !user.has_permission(Permission::ViewAllStudents) {
        return Err(Status::Forbidden);
    }

    let student: User = get_user(db, id).await?;
    let techniques: Vec<StudentTechnique> = get_student_techniques(db, id).await?;
    let all_techniques: Vec<Technique> = get_all_techniques(db).await?;
    let unassigned_techniques: Vec<Technique> = get_unassigned_techniques(db, id).await?;

    let context = json!({
        "student": student,
        "student_techniques": techniques,
        "all_techniques": all_techniques,
        "unassigned_techniques": unassigned_techniques,
        "current_user": user,
        "current_route": "student",
        "can_edit_all_techniques": user.has_permission(Permission::EditAllTechniques),
        "can_assign_techniques": user.has_permission(Permission::AssignTechniques),
        "can_create_techniques": user.has_permission(Permission::CreateTechniques)
    });

    Ok(Template::render("student_techniques", context))
}

#[derive(FromForm, Debug)]
pub struct UpdateStudentTechniqueForm {
    status: String,
    coach_notes: String,
    student_notes: String,
    technique_name: String,
    technique_description: String,
}

#[post("/student_technique/<id>", data = "<form>")]
pub async fn update_student_technique_route(
    id: i64,
    form: Form<UpdateStudentTechniqueForm>,
    user: User,
    db: &State<Pool<Sqlite>>,
) -> Result<Redirect, Status> {
    info!("Updating student technique");
    let student_technique: StudentTechnique = get_student_technique(db, id).await?;

    let is_own_technique = user.id == student_technique.student_id;

    if is_own_technique {
        update_student_notes(db, id, &form.student_notes).await?;
    } else {
        user.require_all_permissions(&[
            Permission::EditAllTechniques,
            Permission::ViewAllStudents,
        ])?;

        update_student_technique(db, id, &form.status, &form.student_notes, &form.coach_notes)
            .await?;

        update_technique(
            db,
            student_technique.technique_id,
            &form.technique_name,
            &form.technique_description,
        )
        .await?;
    }

    Ok(Redirect::to(uri!(student_techniques(
        student_technique.student_id
    ))))
}

#[derive(FromForm, Debug)]
pub struct AddTechniqueForm {
    technique_id: i64,
}

#[post("/student/<student_id>/add_technique", data = "<form>")]
pub async fn add_technique_to_student(
    student_id: i64,
    form: Form<AddTechniqueForm>,
    user: User,
    db: &State<Pool<Sqlite>>,
) -> Result<Redirect, Status> {
    user.require_permission(Permission::AssignTechniques)?;
    info!("Adding technique to student");

    assign_technique_to_student(db, form.technique_id, student_id).await?;

    Ok(Redirect::to(uri!(student_techniques(student_id))))
}

#[derive(FromForm, Debug)]
pub struct AddMultipleTechniquesForm {
    technique_ids: Vec<i64>,
}

#[post("/student/<student_id>/add_techniques", data = "<form>")]
pub async fn add_multiple_techniques_to_student(
    student_id: i64,
    form: Form<AddMultipleTechniquesForm>,
    user: User,
    db: &State<Pool<Sqlite>>,
) -> Result<Redirect, Status> {
    user.require_permission(Permission::AssignTechniques)?;
    info!("Adding multiple techniques to student");

    add_techniques_to_student(db, student_id, form.technique_ids.clone()).await?;

    Ok(Redirect::to(uri!(student_techniques(student_id))))
}

#[derive(FromForm, Debug)]
pub struct CreateTechniqueForm {
    name: String,
    description: String,
}

#[post("/student/<student_id>/create_technique", data = "<form>")]
pub async fn create_and_assign_technique_route(
    student_id: i64,
    form: Form<CreateTechniqueForm>,
    user: User,
    db: &State<Pool<Sqlite>>,
) -> Result<Redirect, Status> {
    user.require_all_permissions(&[Permission::AssignTechniques, Permission::CreateTechniques])?;

    info!("Creating and assigning new technique to student");

    create_and_assign_technique(db, user.id, student_id, &form.name, &form.description).await?;

    Ok(Redirect::to(uri!(student_techniques(student_id))))
}

#[get("/profile?<message>&<message_type>")]
pub async fn profile(
    user: User,
    message: Option<String>,
    message_type: Option<String>,
) -> Template {
    info!("Accessing profile page");
    Template::render(
        "profile",
        context! {
            title: "Your Profile - Jiu Jitsu Syllabus Tracker",
            current_user: user,
            current_route: "profile",
            message,
            message_type,
        },
    )
}

#[derive(FromForm, Debug)]
pub struct UpdateNameForm<'r> {
    #[field(validate = len(1..100).or_else(msg!("Display name cannot be empty")))]
    display_name: &'r str,
}

#[post("/profile/update-name", data = "<form>")]
pub async fn update_name<'r>(
    user: User,
    form: Form<Contextual<'r, UpdateNameForm<'r>>>,
    db: &State<Pool<Sqlite>>,
) -> Result<Redirect, Status> {
    info!("Updating user display name");

    if form.value.is_none() {
        let error_message = form
            .context
            .errors()
            .next()
            .map(|err| err.to_string())
            .unwrap_or_else(|| "Validation failed".to_string());

        return Ok(Redirect::to(uri!(profile(
            Some(&error_message),
            Some("error")
        ))));
    }

    // Form is valid, extract the display name
    let display_name = &form.value.as_ref().unwrap().display_name;

    match update_user_display_name(db, user.id, display_name).await {
        Ok(_) => Ok(Redirect::to(uri!(profile(
            Some("Display name successfully updated"),
            Some("success")
        )))),
        Err(e) => {
            e.log_and_record("Display name update failed");

            Ok(Redirect::to(uri!(profile(
                Some("Failed to update display name"),
                Some("error")
            ))))
        }
    }
}

#[derive(FromForm)]
pub struct UpdatePasswordForm<'r> {
    current_password: &'r str,
    #[field(validate = len(5..).or_else(msg!("Password must be at least 5 characters long")))]
    new_password: &'r str,
    #[field(validate = eq(self.new_password).or_else(msg!("Passwords did not match")))]
    confirm_password: &'r str,
}

#[post("/profile/update-password", data = "<form>")]
pub async fn update_password<'r>(
    user: User,
    form: Form<Contextual<'r, UpdatePasswordForm<'r>>>,
    db: &State<Pool<Sqlite>>,
) -> Result<Redirect, Status> {
    info!("Updating user password");

    if form.value.is_none() {
        let error_message = form
            .context
            .errors()
            .next()
            .map(|err| err.to_string())
            .unwrap_or_else(|| "Validation failed".to_string());

        return Ok(Redirect::to(uri!(profile(
            Some(&error_message),
            Some("error")
        ))));
    }

    let form_value = form.value.as_ref().unwrap();

    match authenticate_user(db, &user.username, &form_value.current_password).await {
        Ok(true) => match update_user_password(db, user.id, &form_value.new_password).await {
            Ok(_) => Ok(Redirect::to(uri!(profile(
                Some("Password successfully updated"),
                Some("success")
            )))),
            Err(e) => {
                e.log_and_record("Password update failed");

                Ok(Redirect::to(uri!(profile(
                    Some("Failed to update password"),
                    Some("error")
                ))))
            }
        },
        Ok(false) => Ok(Redirect::to(uri!(profile(
            Some("Invalid current password"),
            Some("error")
        )))),
        Err(e) => {
            e.log_and_record("Authentication error");

            Ok(Redirect::to(uri!(profile(
                Some("Authentication error"),
                Some("error")
            ))))
        }
    }
}

#[derive(FromForm, Debug)]
pub struct UpdateUsernameForm<'r> {
    #[field(validate = len(4..50).or_else(msg!("Username must be between 4 and 50 characters long")))]
    #[field(validate = omits(' ').or_else(msg!("Username cannot contain spaces")))]
    username: &'r str,
}

#[post("/profile/update-username", data = "<form>")]
pub async fn update_username_route<'r>(
    user: User,
    form: Form<Contextual<'r, UpdateUsernameForm<'r>>>,
    cookies: &CookieJar<'_>,
    db: &State<Pool<Sqlite>>,
) -> Result<Redirect, Status> {
    info!("Updating user username");

    if form.value.is_none() {
        let error_message = form
            .context
            .errors()
            .next()
            .map(|err| err.to_string())
            .unwrap_or_else(|| "Validation failed".to_string());

        return Ok(Redirect::to(uri!(profile(
            Some(&error_message),
            Some("error")
        ))));
    }

    let username = &form.value.as_ref().unwrap().username;

    match update_username(db, user.id, username).await {
        Ok(_) => match get_user(db, user.id).await {
            Ok(updated_user) => {
                cookies.remove_private(Cookie::build("logged_in"));
                cookies.remove_private(Cookie::build("user_role"));
                cookies.remove_private(Cookie::build("user_id"));

                cookies.add_private(
                    Cookie::build(("logged_in", updated_user.username.clone()))
                        .same_site(SameSite::Lax),
                );
                cookies.add_private(
                    Cookie::build(("user_role", updated_user.role.to_string()))
                        .same_site(SameSite::Lax),
                );
                cookies.add_private(
                    Cookie::build(("user_id", updated_user.id.to_string()))
                        .same_site(SameSite::Lax),
                );

                Ok(Redirect::to(uri!(profile(
                    Some("Username updated successfully"),
                    Some("success")
                ))))
            }
            Err(_) => Ok(Redirect::to(uri!(profile(
                Some("Username updated but couldn't refresh user data"),
                Some("warning")
            )))),
        },
        Err(e) => {
            e.log_and_record("Username update failed");

            let error_message = if matches!(e, AppError::Validation(_)) {
                "Username already taken"
            } else {
                "Failed to update username"
            };

            Ok(Redirect::to(uri!(profile(
                Some(error_message),
                Some("error")
            ))))
        }
    }
}

#[get("/users?<message>")]
pub async fn admin_users(
    user: User,
    db: &State<Pool<Sqlite>>,
    message: Option<String>,
) -> Result<Template, Status> {
    user.require_permission(Permission::EditUserRoles)?;

    let users = get_all_users(db).await?;

    let active_users: Vec<_> = users.iter().filter(|u| !u.archived).cloned().collect();
    let archived_users: Vec<_> = users.iter().filter(|u| u.archived).cloned().collect();

    Ok(Template::render(
        "users",
        context! {
            title: "User Management - Admin",
            current_user: user,
            active_users: active_users,
            archived_users: archived_users,
            current_route: "admin_users",
            message,
        },
    ))
}

#[get("/users/<id>/edit?<message>")]
pub async fn admin_edit_user(
    id: i64,
    user: User,
    db: &State<Pool<Sqlite>>,
    message: Option<String>,
) -> Result<Template, Status> {
    user.require_permission(Permission::EditUserRoles)?;

    let edit_user = get_user(db, id).await?;

    Ok(Template::render(
        "edit_user",
        context! {
            title: "Edit User - Admin",
            current_user: user,
            edit_user: edit_user,
            current_route: "admin_users",
            message,
        },
    ))
}

#[derive(Debug, FromForm)]
pub struct AdminEditUserForm<'r> {
    #[field(validate = len(3..30).or_else(msg!("Username must be between 3 and 30 characters")))]
    #[field(validate = omits(' ').or_else(msg!("Username cannot contain spaces")))]
    username: &'r str,
    display_name: &'r str,
    role: &'r str,
    #[field(validate = len(0..).or_else(msg!("Password cannot be negative length")))]
    password: &'r str,
}

#[post("/users/<id>/edit", data = "<form>")]
pub async fn admin_process_edit_user<'r>(
    id: i64,
    user: User,
    form: Form<Contextual<'r, AdminEditUserForm<'r>>>,
    db: &State<Pool<Sqlite>>,
) -> Result<Redirect, Status> {
    user.require_permission(Permission::EditUserRoles)?;

    if form.value.is_none() {
        let error_message = form
            .context
            .errors()
            .next()
            .map(|err| err.to_string())
            .unwrap_or_else(|| "Validation failed".to_string());

        return Ok(Redirect::to(uri!(admin_edit_user(
            id,
            Some(&error_message)
        ))));
    }

    let form_value = form.value.as_ref().unwrap();

    update_user_admin(
        db,
        id,
        form_value.username,
        &form_value.display_name,
        &form_value.role,
    )
    .await?;

    if !form_value.password.is_empty() {
        update_user_password(db, id, form_value.password).await?;
    }

    Ok(Redirect::to(uri!(admin_users(Some(
        "User updated successfully"
    )))))
}

#[post("/users/<id>/archive")]
pub async fn admin_archive_user(
    id: i64,
    user: User,
    db: &State<Pool<Sqlite>>,
) -> Result<Redirect, Status> {
    user.require_permission(Permission::DeleteUsers)?;

    let current_state = user.archived;

    let now_archived: bool = set_user_archived(db, id, !current_state).await?;

    let message: String = match now_archived {
        true => "User archived successfully".to_string(),
        false => "User unarchived successfully".to_string(),
    };

    Ok(Redirect::to(uri!(admin_users(Some(message)))))
}
