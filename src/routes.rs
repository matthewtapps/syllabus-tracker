use rocket::form::Form;
use rocket::response::Redirect;
use rocket::{State, http::Status};
use rocket_dyn_templates::{Template, context};
use serde_json::json;
use sqlx::{Pool, Sqlite};

use crate::db::{
    add_techniques_to_student, assign_technique_to_student, create_and_assign_technique,
    get_student_technique, get_unassigned_techniques, update_student_technique, update_technique,
};
use crate::{
    db::{get_all_techniques, get_student_techniques, get_user},
    models::{DbUser, User},
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
        Ok(student) => student,
        Err(e) => {
            error!("Failed to get student {}: {:?}", id, e);
            return Err(Status::NotFound);
        }
    };

    let student_techniques = match get_student_techniques(id).await {
        Ok(techniques) => techniques,
        Err(e) => {
            error!("Failed to get techniques for student {}: {:?}", id, e);
            return Err(Status::InternalServerError);
        }
    };

    let all_techniques = match get_all_techniques().await {
        Ok(techniques) => techniques,
        Err(e) => {
            error!("Failed to get all techniques: {:?}", e);
            return Err(Status::InternalServerError);
        }
    };

    let unassigned_techniques = match get_unassigned_techniques(id).await {
        Ok(techniques) => techniques,
        Err(e) => {
            error!("Failed to get unassigned techniques: {:?}", e);
            return Err(Status::InternalServerError);
        }
    };

    let context = json!({
        "student": student,
        "student_techniques": student_techniques,
        "all_techniques": all_techniques,
        "unassigned_techniques": unassigned_techniques
    });

    Ok(Template::render("student_techniques", context))
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

    if let Err(e) =
        update_student_technique(id, &form.status, &form.student_notes, &form.coach_notes).await
    {
        error!("Failed to update student technique {}: {:?}", id, e);
        return Err(Status::InternalServerError);
    }

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
    }

    Ok(Redirect::to(uri!(student_techniques(
        student_technique.student_id
    ))))
}

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

#[derive(FromForm)]
pub struct AddMultipleTechniquesForm {
    technique_ids: Vec<i64>,
}

#[post("/student/<student_id>/add_techniques", data = "<form>")]
pub async fn add_multiple_techniques_to_student(
    student_id: i64,
    form: Form<AddMultipleTechniquesForm>,
) -> Result<Redirect, Status> {
    if let Err(e) = add_techniques_to_student(student_id, form.technique_ids.clone()).await {
        error!(
            "Failed to assign techniques with ids {:?} to student {}: {:?}",
            form.technique_ids, student_id, e
        );
        return Err(Status::InternalServerError);
    }
    Ok(Redirect::to(uri!(student_techniques(student_id))))
}

#[derive(FromForm)]
pub struct CreateTechniqueForm {
    name: String,
    description: String,
}

#[post("/student/<student_id>/create_technique", data = "<form>")]
pub async fn create_and_assign_technique_route(
    student_id: i64,
    form: Form<CreateTechniqueForm>,
) -> Result<Redirect, Status> {
    // TODO: Coach ID instead of hardcoded 1

    if let Err(e) = create_and_assign_technique(1, student_id, &form.name, &form.description).await
    {
        error!(
            "Failed to create and assign technique to student {}: {:?}",
            student_id, e
        );
        return Err(Status::InternalServerError);
    }

    Ok(Redirect::to(uri!(student_techniques(student_id))))
}
