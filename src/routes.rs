use rocket::Request;
use rocket::form::Form;
use rocket::http::{Cookie, CookieJar, SameSite};
use rocket::response::{self, Redirect, Responder};
use rocket::{State, http::Status};
use rocket_dyn_templates::{Template, context};
use serde_json::json;
use sqlx::{Pool, Sqlite};

use crate::auth::User;
use crate::db::{
    add_techniques_to_student, assign_technique_to_student, authenticate_user,
    create_and_assign_technique, get_all_techniques, get_student_technique,
    get_unassigned_techniques, get_users_by_role, update_student_notes, update_student_technique,
    update_technique, update_user_display_name, update_user_password, update_username,
};
use crate::db::{get_student_techniques, get_user};
use crate::telemetry::TracingSpan;

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
pub async fn index(span: TracingSpan, user: User, db: &State<Pool<Sqlite>>) -> IndexResponse {
    span.in_scope_async(|| async {
        info!("Accessing index page");
        if user.role == "student" {
            return IndexResponse::RedirectResponse(Redirect::to(format!("/student/{}", user.id)));
        }
        // Fetch students for the index page
        let students = match get_users_by_role(db, "student").await {
            Ok(students) => students,
            Err(e) => {
                error!("Failed to get users by role {}: {:?}", "student", e);
                return IndexResponse::ErrorResponse(Status::InternalServerError);
            }
        };
        IndexResponse::TemplateResponse(Template::render(
            "index",
            context! {
                title: "Jiu Jitsu Syllabus Tracker",
                students: students,
                current_user: user,
                current_route: "home",
            },
        ))
    })
    .await
}

#[get("/", rank = 2)]
pub fn index_anon(span: TracingSpan) -> Redirect {
    span.in_scope(|| {
        info!("Redirecting to login");

        Redirect::to("/login")
    })
}

#[get("/student/<id>")]
pub async fn student_techniques(
    span: TracingSpan,
    id: i64,
    user: User,
    db: &State<Pool<Sqlite>>,
) -> Result<Template, Status> {
    span.in_scope_async(|| async {
        info!("Accessing student-specific page");
        // Check permissions - coaches can see all, students can only see their own
        if user.role != "coach" && user.id != id {
            return Err(Status::Forbidden);
        }

        let student = match get_user(db, id).await {
            Ok(student) => student,
            Err(e) => {
                error!("Failed to get student {}: {:?}", id, e);
                return Err(Status::NotFound);
            }
        };

        let techniques = match get_student_techniques(db, id).await {
            Ok(techniques) => techniques,
            Err(e) => {
                error!("Failed to get techniques for student {}: {:?}", id, e);
                return Err(Status::InternalServerError);
            }
        };

        let all_techniques = match get_all_techniques(db).await {
            Ok(techniques) => techniques,
            Err(e) => {
                error!("Failed to get all techniques: {:?}", e);
                return Err(Status::InternalServerError);
            }
        };

        let unassigned_techniques = match get_unassigned_techniques(db, id).await {
            Ok(techniques) => techniques,
            Err(e) => {
                error!("Failed to get unassigned techniques: {:?}", e);
                return Err(Status::InternalServerError);
            }
        };

        // Update the json! macro with the new variable name
        let context = json!({
            "student": student,
            "student_techniques": techniques,  // Changed from student_techniques
            "all_techniques": all_techniques,
            "unassigned_techniques": unassigned_techniques,
            "current_user": user,
            "current_route": "student"
        });

        Ok(Template::render("student_techniques", context))
    })
    .await
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
    span: TracingSpan,
    id: i64,
    form: Form<UpdateStudentTechniqueForm>,
    user: User,
    db: &State<Pool<Sqlite>>,
) -> Result<Redirect, Status> {
    span.in_scope_async(|| async {
        info!("Updating student technique");
        // Get the student technique to retrieve student_id for redirect and permission check
        let student_technique = match get_student_technique(db, id).await {
            Ok(st) => st,
            Err(e) => {
                error!("Failed to retrieve student technique {}: {:?}", id, e);
                return Err(Status::NotFound);
            }
        };

        // Check permissions - coaches can edit everything, students can only edit their own notes
        if user.role != "coach" && (user.id != student_technique.student_id) {
            return Err(Status::Forbidden);
        }

        // If this is a student editing their own technique, only update student_notes
        if user.role == "student" {
            if let Err(e) = update_student_notes(db, id, &form.student_notes).await {
                error!(
                    "Failed to update student notes for technique {}: {:?}",
                    id, e
                );
                return Err(Status::InternalServerError);
            }
        } else {
            // Coach can update everything
            if let Err(e) = update_student_technique(
                db,
                id,
                &form.status,
                &form.student_notes,
                &form.coach_notes,
            )
            .await
            {
                error!("Failed to update student technique {}: {:?}", id, e);
                return Err(Status::InternalServerError);
            }

            if let Err(e) = update_technique(
                db,
                student_technique.technique_id,
                &form.technique_name,
                &form.technique_description,
            )
            .await
            {
                error!(
                    "Failed to update global technique {}: {:?}",
                    student_technique.technique_id, e
                );
            }
        }

        Ok(Redirect::to(uri!(student_techniques(
            student_technique.student_id
        ))))
    })
    .await
}

#[derive(FromForm, Debug)]
pub struct AddTechniqueForm {
    technique_id: i64,
}

#[post("/student/<student_id>/add_technique", data = "<form>")]
pub async fn add_technique_to_student(
    span: TracingSpan,
    student_id: i64,
    form: Form<AddTechniqueForm>,
    user: User,
    db: &State<Pool<Sqlite>>,
) -> Result<Redirect, Status> {
    span.in_scope_async(|| async {
        info!("Adding technique to student");
        if user.role != "coach" {
            return Err(Status::Forbidden);
        }

        if let Err(e) = assign_technique_to_student(db, form.technique_id, student_id).await {
            error!(
                "Failed to assign technique {} to student {}: {:?}",
                form.technique_id, student_id, e
            );
            return Err(Status::InternalServerError);
        }

        Ok(Redirect::to(uri!(student_techniques(student_id))))
    })
    .await
}

#[derive(FromForm, Debug)]
pub struct AddMultipleTechniquesForm {
    technique_ids: Vec<i64>,
}

#[post("/student/<student_id>/add_techniques", data = "<form>")]
pub async fn add_multiple_techniques_to_student(
    span: TracingSpan,
    student_id: i64,
    form: Form<AddMultipleTechniquesForm>,
    user: User,
    db: &State<Pool<Sqlite>>,
) -> Result<Redirect, Status> {
    span.in_scope_async(|| async {
        info!("Adding multiple techniques to student");
        if user.role != "coach" {
            return Err(Status::Forbidden);
        }

        if let Err(e) = add_techniques_to_student(db, student_id, form.technique_ids.clone()).await
        {
            error!(
                "Failed to assign techniques with ids {:?} to student {}: {:?}",
                form.technique_ids, student_id, e
            );
            return Err(Status::InternalServerError);
        }

        Ok(Redirect::to(uri!(student_techniques(student_id))))
    })
    .await
}

#[derive(FromForm, Debug)]
pub struct CreateTechniqueForm {
    name: String,
    description: String,
}

#[post("/student/<student_id>/create_technique", data = "<form>")]
pub async fn create_and_assign_technique_route(
    span: TracingSpan,
    student_id: i64,
    form: Form<CreateTechniqueForm>,
    user: User,
    db: &State<Pool<Sqlite>>,
) -> Result<Redirect, Status> {
    span.in_scope_async(|| async {
        info!("Creating and assigning new technique to student");
        if user.role != "coach" {
            return Err(Status::Forbidden);
        }

        if let Err(e) =
            create_and_assign_technique(db, user.id, student_id, &form.name, &form.description)
                .await
        {
            error!(
                "Failed to create and assign technique to student {}: {:?}",
                student_id, e
            );
            return Err(Status::InternalServerError);
        }

        Ok(Redirect::to(uri!(student_techniques(student_id))))
    })
    .await
}

#[get("/profile")]
pub async fn profile(span: TracingSpan, user: User) -> Template {
    span.in_scope(|| {
        info!("Accessing profile page");
        Template::render(
            "profile",
            context! {
                title: "Your Profile - Jiu Jitsu Syllabus Tracker",
                current_user: user,
                current_route: "profile"
            },
        )
    })
}

#[derive(FromForm, Debug)]
pub struct UpdateNameForm {
    display_name: String,
}

#[post("/profile/update-name", data = "<form>")]
pub async fn update_name(
    span: TracingSpan,
    user: User,
    form: Form<UpdateNameForm>,
    db: &State<Pool<Sqlite>>,
) -> Result<Template, Status> {
    let entered = span.enter();
    info!("Updating user display name");
    if let Err(e) = update_user_display_name(db, user.id, &form.display_name).await {
        error!("Failed to update display name: {:?}", e);
        drop(entered);
        return Ok(Template::render(
            "profile",
            context! {
                title: "Your Profile - Jiu Jitsu Syllabus Tracker",
                current_user: user,
                message: "Failed to update display name",
                message_type: "error",
                current_route: "profile"
            },
        ));
    }

    // Get updated user data
    let updated_user = match get_user(db, user.id).await {
        Ok(user) => user,
        Err(_) => {
            return Ok(Template::render(
                "profile",
                context! {
                    title: "Your Profile - Jiu Jitsu Syllabus Tracker",
                    current_user: user,
                    message: "Display name updated but couldn't refresh user data",
                    message_type: "warning",
                    current_route: "profile"
                },
            ));
        }
    };

    drop(entered);
    Ok(Template::render(
        "profile",
        context! {
            title: "Your Profile - Jiu Jitsu Syllabus Tracker",
            current_user: updated_user,
            message: "Display name updated successfully",
            message_type: "success",
            current_route: "profile"
        },
    ))
}

#[derive(FromForm)]
pub struct UpdatePasswordForm {
    current_password: String,
    new_password: String,
    confirm_password: String,
}

#[post("/profile/update-password", data = "<form>")]
pub async fn update_password(
    span: TracingSpan,
    user: User,
    form: Form<UpdatePasswordForm>,
    db: &State<Pool<Sqlite>>,
) -> Result<Template, Status> {
    span.in_scope_async(|| async {
        info!("Updating user password");
        if form.new_password != form.confirm_password {
            info!("New passwords didn't match");
            return Ok(Template::render(
                "profile",
                context! {
                    title: "Your Profile - Jiu Jitsu Syllabus Tracker",
                    current_user: user,
                    message: "New passwords do not match",
                    message_type: "error",
                    current_route: "profile"
                },
            ));
        }

        // Verify current password
        let is_valid = match authenticate_user(db, &user.username, &form.current_password).await {
            Ok(valid) => valid,
            Err(_) => false,
        };

        if !is_valid {
            info!("Invalid current password");
            return Ok(Template::render(
                "profile",
                context! {
                    title: "Your Profile - Jiu Jitsu Syllabus Tracker",
                    user: user,
                    message: "Current password is incorrect",
                    message_type: "error",
                    current_route: "profile"
                },
            ));
        }

        // Update password
        if let Err(e) = update_user_password(db, user.id, &form.new_password).await {
            error!("Failed to update password: {:?}", e);
            return Ok(Template::render(
                "profile",
                context! {
                    title: "Your Profile - Jiu Jitsu Syllabus Tracker",
                    current_user: user,
                    message: "Failed to update password",
                    message_type: "error",
                    current_route: "profile"
                },
            ));
        }

        Ok(Template::render(
            "profile",
            context! {
                title: "Your Profile - Jiu Jitsu Syllabus Tracker",
                current_user: user,
                message: "Password updated successfully",
                message_type: "success",
                    current_route: "profile"
            },
        ))
    })
    .await
}

#[derive(FromForm, Debug)]
pub struct UpdateUsernameForm {
    username: String,
}

#[post("/profile/update-username", data = "<form>")]
pub async fn update_username_route(
    span: TracingSpan,
    user: User,
    form: Form<UpdateUsernameForm>,
    cookies: &CookieJar<'_>,
    db: &State<Pool<Sqlite>>,
) -> Result<Template, Status> {
    span.in_scope_async(|| async {
        info!("Updating user username");
        if form.username.trim().is_empty() {
            return Ok(Template::render(
                "profile",
                context! {
                    title: "Your Profile - Jiu Jitsu Syllabus Tracker",
                    current_user: user,
                    message: "Username cannot be empty",
                    message_type: "error",
                    current_route: "profile"
                },
            ));
        }

        // Update username in database
        match update_username(db, user.id, &form.username).await {
            Ok(_) => {
                // Get updated user data first
                match get_user(db, user.id).await {
                    Ok(updated_user) => {
                        // Now update all cookies with the latest user data

                        // Remove old cookies
                        cookies.remove_private(Cookie::build("logged_in"));
                        cookies.remove_private(Cookie::build("user_role"));
                        cookies.remove_private(Cookie::build("user_id"));

                        // Add new cookies with updated information
                        cookies.add_private(
                            Cookie::build(("logged_in", updated_user.username.clone()))
                                .same_site(SameSite::Lax),
                        );
                        cookies.add_private(
                            Cookie::build(("user_role", updated_user.role.clone()))
                                .same_site(SameSite::Lax),
                        );
                        cookies.add_private(
                            Cookie::build(("user_id", updated_user.id.to_string()))
                                .same_site(SameSite::Lax),
                        );

                        // Now render the template with the updated user data
                        Ok(Template::render(
                            "profile",
                            context! {
                                title: "Your Profile - Jiu Jitsu Syllabus Tracker",
                                message: "Username updated successfully",
                                message_type: "success",
                                current_route: "profile",
                                current_user: updated_user
                            },
                        ))
                    }
                    Err(_) => {
                        // This is unlikely to happen, but handle it just in case
                        Ok(Template::render(
                            "profile",
                            context! {
                                title: "Your Profile - Jiu Jitsu Syllabus Tracker",
                                current_user: User {
                                    id: user.id,
                                    username: form.username.clone(),
                                    role: user.role.clone(),
                                    display_name: user.display_name.clone(),
                                },
                                message: "Username updated but couldn't refresh user data",
                                message_type: "warning",
                                current_route: "profile",
                            },
                        ))
                    }
                }
            }
            Err(_) => Ok(Template::render(
                "profile",
                context! {
                    title: "Your Profile - Jiu Jitsu Syllabus Tracker",
                    message: "Username already taken or couldn't be updated",
                    message_type: "error",
                    current_route: "profile",
                    current_user: user, // Important! Add this
                },
            )),
        }
    })
    .await
}
