use crate::DATABASE_URL;
use crate::auth::{DbUser, User};
use chrono::Utc;
use rocket::response::Redirect;
use sqlx::sqlite::SqlitePoolOptions;
use sqlx::{Error, Pool, Sqlite};
use tracing::instrument;

use crate::models::{DbStudentTechnique, DbTechnique, StudentTechnique, Technique};

#[instrument]
async fn conn() -> Result<Pool<Sqlite>, sqlx::Error> {
    info!("Opening databsae connection");
    let pool = SqlitePoolOptions::new()
        .max_connections(5)
        .connect(DATABASE_URL)
        .await?;

    Ok(pool)
}

#[instrument]
pub async fn get_user(id: i64) -> Result<User, sqlx::Error> {
    info!("Fetching user by ID");
    let row = sqlx::query_as!(
        DbUser,
        "SELECT id, username, role, display_name FROM users WHERE id=?",
        id
    )
    .fetch_one(&conn().await?)
    .await?;
    Ok(User::from(row))
}

#[instrument]
pub async fn update_user_display_name(user_id: i64, display_name: &str) -> Result<(), sqlx::Error> {
    info!("Updating user display name");
    sqlx::query!(
        "UPDATE users SET display_name = ? WHERE id = ?",
        display_name,
        user_id
    )
    .execute(&conn().await?)
    .await?;

    Ok(())
}

#[instrument(skip_all, fields(user_id))]
pub async fn update_user_password(user_id: i64, new_password: &str) -> Result<(), sqlx::Error> {
    info!("Updating user password");
    // Hash the password
    let hashed_password =
        bcrypt::hash(new_password, bcrypt::DEFAULT_COST).map_err(|_| sqlx::Error::RowNotFound)?;

    sqlx::query!(
        "UPDATE users SET password = ? WHERE id = ?",
        hashed_password,
        user_id
    )
    .execute(&conn().await?)
    .await?;

    Ok(())
}

#[instrument]
pub async fn update_username(user_id: i64, new_username: &str) -> Result<(), sqlx::Error> {
    info!("Updating user username");
    let existing = sqlx::query!(
        "SELECT id FROM users WHERE username = ? AND id != ?",
        new_username,
        user_id
    )
    .fetch_optional(&conn().await?)
    .await?;

    if existing.is_some() {
        return Err(sqlx::Error::RowNotFound); // Using this as a stand-in for "username taken" error
    }

    sqlx::query!(
        "UPDATE users SET username = ? WHERE id = ?",
        new_username,
        user_id
    )
    .execute(&conn().await?)
    .await?;

    Ok(())
}

#[instrument]
pub async fn get_all_techniques() -> Result<Vec<Technique>, Error> {
    info!("Getting all techniques");
    let rows = sqlx::query_as!(
        DbTechnique,
        "SELECT *
         FROM techniques
         ORDER BY name",
    )
    .fetch_all(&conn().await?)
    .await?;

    Ok(rows
        .iter()
        .map(|row| Technique::from(row.clone()))
        .collect())
}

#[instrument]
pub async fn update_technique(
    technique_id: i64,
    name: &str,
    description: &str,
) -> Result<(), sqlx::Error> {
    info!("Updating technique");
    sqlx::query!(
        "UPDATE techniques 
         SET name = ?, description = ?
         WHERE id = ?",
        name,
        description,
        technique_id
    )
    .execute(&conn().await?)
    .await?;

    sqlx::query!(
        "UPDATE student_techniques 
         SET technique_name = ?, technique_description = ?
         WHERE technique_id = ?",
        name,
        description,
        technique_id
    )
    .execute(&conn().await?)
    .await?;

    Ok(())
}

#[instrument]
pub async fn assign_technique_to_student(
    technique_id: i64,
    student_id: i64,
) -> Result<i64, sqlx::Error> {
    info!("Assigning technique to student");
    struct ReturnRow {
        id: i64,
    }

    let exists = sqlx::query_as!(
        ReturnRow,
        "SELECT id FROM student_techniques WHERE technique_id = ? AND student_id = ?",
        technique_id,
        student_id
    )
    .fetch_optional(&conn().await?)
    .await?;

    if let Some(row) = exists {
        return Ok(row.id);
    }

    let res = sqlx::query!(
        "INSERT INTO student_techniques
     (student_id, student_notes, coach_notes, technique_id, technique_name, technique_description)
     SELECT ?, '', '', t.id, t.name, t.description
     FROM techniques t WHERE t.id = ?",
        student_id,
        technique_id
    )
    .execute(&conn().await?)
    .await?;

    Ok(res.last_insert_rowid())
}

#[instrument]
pub async fn get_student_techniques(student_id: i64) -> Result<Vec<StudentTechnique>, sqlx::Error> {
    info!("Getting student techniques");
    let rows = sqlx::query_as!(
        DbStudentTechnique,
        "SELECT * FROM student_techniques
         WHERE student_id = ?
        ORDER BY updated_at DESC

",
        student_id
    )
    .fetch_all(&conn().await?)
    .await?;

    Ok(rows
        .iter()
        .map(|row| StudentTechnique::from(row.clone()))
        .collect())
}

#[instrument]
pub async fn get_student_technique(
    student_technique_id: i64,
) -> Result<StudentTechnique, sqlx::Error> {
    info!("Getting student technique");
    let row = sqlx::query_as!(
        DbStudentTechnique,
        "SELECT * FROM student_techniques
         WHERE id = ?",
        student_technique_id
    )
    .fetch_one(&conn().await?)
    .await?;

    Ok(StudentTechnique::from(row))
}

#[instrument]
pub async fn update_student_technique(
    id: i64,
    status: &str,
    student_notes: &str,
    coach_notes: &str,
) -> Result<(), sqlx::Error> {
    info!("Updating student technique");
    let now = Utc::now();
    sqlx::query!(
        "UPDATE student_techniques
         SET status = ?, student_notes = ?, coach_notes = ?, updated_at = ?
         WHERE id = ?",
        status,
        student_notes,
        coach_notes,
        now,
        id
    )
    .execute(&conn().await?)
    .await?;

    Ok(())
}

#[instrument]
pub async fn create_technique(
    name: &str,
    description: &str,
    coach_id: i64,
) -> Result<i64, sqlx::Error> {
    info!("Creating technique");
    let res = sqlx::query!(
        "INSERT INTO techniques (name, description, coach_id)
         VALUES (?, ?, ?)",
        name,
        description,
        coach_id
    )
    .execute(&conn().await?)
    .await?;
    Ok(res.last_insert_rowid())
}

#[instrument]
pub async fn update_student_notes(id: i64, student_notes: &str) -> Result<(), sqlx::Error> {
    info!("Updating student notes");
    let now = Utc::now();
    sqlx::query!(
        "UPDATE student_techniques
         SET student_notes = ?, updated_at = ?
         WHERE id = ?",
        student_notes,
        now,
        id
    )
    .execute(&conn().await?)
    .await?;

    Ok(())
}

#[instrument]
pub async fn get_unassigned_techniques(student_id: i64) -> Result<Vec<Technique>, sqlx::Error> {
    info!("Getting unassigned techniques");
    let rows = sqlx::query_as!(
        DbTechnique,
        "SELECT t.* FROM techniques t
         WHERE t.id NOT IN (
             SELECT technique_id FROM student_techniques 
             WHERE student_id = ?
         )",
        student_id
    )
    .fetch_all(&conn().await?)
    .await?;
    Ok(rows
        .iter()
        .map(|row| Technique::from(row.clone()))
        .collect())
}

#[instrument]
pub async fn add_techniques_to_student(
    student_id: i64,
    technique_ids: Vec<i64>,
) -> Result<Redirect, sqlx::Error> {
    info!("Adding technique to student");
    for technique_id in technique_ids {
        assign_technique_to_student(technique_id, student_id).await?;
    }

    Ok(Redirect::to(format!("/student/{}", student_id)))
}

#[instrument]
pub async fn create_and_assign_technique(
    coach_id: i64,
    student_id: i64,
    technique_name: &str,
    technique_description: &str,
) -> Result<Redirect, sqlx::Error> {
    info!("Creating and assigning technique to student");
    let technique_id = create_technique(technique_name, technique_description, coach_id).await?;

    assign_technique_to_student(technique_id, student_id).await?;

    Ok(Redirect::to(format!("/student/{}", student_id)))
}

#[instrument(skip_all, fields(username))]
pub async fn authenticate_user(username: &str, password: &str) -> Result<bool, sqlx::Error> {
    info!("Authenticating user");
    let user = sqlx::query!(
        "SELECT id, username, password, role FROM users WHERE username = ?",
        username
    )
    .fetch_optional(&conn().await?)
    .await?;

    match user {
        Some(user) => {
            // Verify the password using bcrypt
            match bcrypt::verify(password, &user.password) {
                Ok(valid) => Ok(valid),
                Err(_) => Ok(false),
            }
        }
        _ => Ok(false),
    }
}

#[instrument(skip_all, fields(username, role))]
pub async fn create_user(username: &str, password: &str, role: &str) -> Result<i64, sqlx::Error> {
    info!("Creating new user");

    let hashed_password =
        bcrypt::hash(password, bcrypt::DEFAULT_COST).map_err(|_| sqlx::Error::RowNotFound)?;

    let res = sqlx::query!(
        "INSERT INTO users (username, password, role) VALUES (?, ?, ?)",
        username,
        hashed_password,
        role
    )
    .execute(&conn().await?)
    .await?;

    Ok(res.last_insert_rowid())
}

#[instrument]
pub async fn get_user_by_username(username: &str) -> Result<User, sqlx::Error> {
    info!("Getting user by username");
    let row = sqlx::query_as!(
        DbUser,
        "SELECT id, username, role, display_name FROM users WHERE username = ?",
        username
    )
    .fetch_one(&conn().await?)
    .await?;

    Ok(User::from(row))
}
