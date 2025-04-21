use rocket::form::Form;
use rocket::response::Redirect;
use rocket::{State, http::Status};
use rocket_dyn_templates::{Template, context};
use sqlx::{Pool, Sqlite};

use crate::db::{
    assign_technique_to_student, get_student_technique, update_student_technique, update_technique,
};
use crate::{
    db::{get_all_techniques, get_student_techniques, get_user},
    models::{DbUser, StudentTechnique, User},
};

#[get("/")]
pub async fn index(db: &State<Pool<Sqlite>>) -> Template {
    // Fetch all students for the index page
    let students: Vec<User> =
        sqlx::query_as::<_, DbUser>("SELECT * FROM Users WHERE Role = 'student'")
            .fetch_all(&**db)
            .await
            .unwrap_or_default()
            .into_iter()
            .map(User::from)
            .collect();

    Template::render(
        "index",
        context! {
            title: "Jiu Jitsu Syllabus Tracker",
            students: students,
        },
    )
}

#[get("/student/<id>")]
pub async fn student_techniques(id: i64) -> Result<Template, Status> {
    let student = match get_user(id).await {
        Ok(user) => user,
        Err(_) => return Err(Status::NotFound),
    };

    let student_techniques: Vec<StudentTechnique> = match get_student_techniques(student.id).await {
        Ok(student_techniques) => student_techniques,
        Err(_) => return Err(Status::InternalServerError),
    };

    let all_techniques = match get_all_techniques().await {
        Ok(all_techniques) => all_techniques,
        Err(_) => return Err(Status::InternalServerError),
    };

    Ok(Template::render(
        "student_techniques",
        context! {
            title: format!("{}'s Techniques", student.username),
            student: student,
            student_techniques: student_techniques,
            all_techniques: all_techniques,
        },
    ))
}

#[derive(FromForm)]
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
    // You might want to add user authentication context here to verify coach role
) -> Result<Redirect, Status> {
    // Get the student technique to retrieve student_id for redirect
    let student_technique = match get_student_technique(id).await {
        Ok(st) => st,
        Err(e) => {
            error!("Failed to retrieve student technique {}: {:?}", id, e);
            return Err(Status::NotFound);
        }
    };

    // Step 1: Update the student-specific details
    if let Err(e) =
        update_student_technique(id, &form.status, &form.student_notes, &form.coach_notes).await
    {
        error!("Failed to update student technique {}: {:?}", id, e);
        return Err(Status::InternalServerError);
    }

    // Step 2: Update the global technique details
    if let Err(e) = update_technique(
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
        // Continue anyway, as we've already updated the student-specific details
        // You might want to add a flash message here to indicate partial success
    }

    Ok(Redirect::to(uri!(student_techniques(
        student_technique.student_id
    ))))
}

// Form structure for adding a technique to a student
#[derive(FromForm)]
pub struct AddTechniqueForm {
    technique_id: i64,
}

#[post("/student/<student_id>/add_technique", data = "<form>")]
pub async fn add_technique_to_student(
    student_id: i64,
    form: Form<AddTechniqueForm>,
) -> Result<Redirect, Status> {
    if let Err(e) = assign_technique_to_student(form.technique_id, student_id).await {
        error!(
            "Failed to assign technique {} to student {}: {:?}",
            form.technique_id, student_id, e
        );
        return Err(Status::InternalServerError);
    }

    Ok(Redirect::to(uri!(student_techniques(student_id))))
}
