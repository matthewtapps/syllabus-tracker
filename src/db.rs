use crate::{
    auth::{DbUser, User},
    error::AppError,
};
use chrono::Utc;
use sqlx::{Pool, Sqlite};
use tracing::{info, instrument};

use crate::models::{DbStudentTechnique, DbTechnique, StudentTechnique, Technique};

#[instrument]
pub async fn get_user(pool: &Pool<Sqlite>, id: i64) -> Result<User, AppError> {
    info!("Fetching user by ID");
    let row = sqlx::query_as!(
        DbUser,
        "SELECT id, username, role, display_name FROM users WHERE id=?",
        id
    )
    .fetch_optional(pool)
    .await?;

    match row {
        Some(user) => Ok(User::from(user)),
        _ => Err(AppError::NotFound(format!(
            "User with id {} not found in database",
            id
        ))),
    }
}

#[instrument]
pub async fn update_user_display_name(
    pool: &Pool<Sqlite>,
    user_id: i64,
    display_name: &str,
) -> Result<(), AppError> {
    info!("Updating user display name");
    sqlx::query!(
        "UPDATE users SET display_name = ? WHERE id = ?",
        display_name,
        user_id
    )
    .execute(pool)
    .await?;

    Ok(())
}

#[instrument(skip_all, fields(user_id))]
pub async fn update_user_password(
    pool: &Pool<Sqlite>,
    user_id: i64,
    new_password: &str,
) -> Result<(), AppError> {
    info!("Updating user password");
    // Hash the password
    let hashed_password = bcrypt::hash(new_password, bcrypt::DEFAULT_COST)?;

    sqlx::query!(
        "UPDATE users SET password = ? WHERE id = ?",
        hashed_password,
        user_id
    )
    .execute(pool)
    .await?;

    Ok(())
}

#[instrument]
pub async fn update_username(
    pool: &Pool<Sqlite>,
    user_id: i64,
    new_username: &str,
) -> Result<(), AppError> {
    info!("Updating user username");
    let existing = sqlx::query!(
        "SELECT id FROM users WHERE username = ? AND id != ?",
        new_username,
        user_id
    )
    .fetch_optional(pool)
    .await?;

    if existing.is_some() {
        return Err(AppError::Validation("Username already exists".to_string())); // Using this as a stand-in for "username taken" error
    }

    sqlx::query!(
        "UPDATE users SET username = ? WHERE id = ?",
        new_username,
        user_id
    )
    .execute(pool)
    .await?;

    Ok(())
}

#[instrument]
pub async fn get_all_techniques(pool: &Pool<Sqlite>) -> Result<Vec<Technique>, AppError> {
    info!("Getting all techniques");
    let rows = sqlx::query_as!(
        DbTechnique,
        "SELECT *
         FROM techniques
         ORDER BY name",
    )
    .fetch_all(pool)
    .await?;

    Ok(rows
        .iter()
        .map(|row| Technique::from(row.clone()))
        .collect())
}

#[instrument]
pub async fn update_technique(
    pool: &Pool<Sqlite>,
    technique_id: i64,
    name: &str,
    description: &str,
) -> Result<(), AppError> {
    info!("Updating technique");
    sqlx::query!(
        "UPDATE techniques 
         SET name = ?, description = ?
         WHERE id = ?",
        name,
        description,
        technique_id
    )
    .execute(pool)
    .await?;

    sqlx::query!(
        "UPDATE student_techniques 
         SET technique_name = ?, technique_description = ?
         WHERE technique_id = ?",
        name,
        description,
        technique_id
    )
    .execute(pool)
    .await?;

    Ok(())
}

#[instrument]
pub async fn assign_technique_to_student(
    pool: &Pool<Sqlite>,
    technique_id: i64,
    student_id: i64,
) -> Result<i64, AppError> {
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
    .fetch_optional(pool)
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
    .execute(pool)
    .await?;

    Ok(res.last_insert_rowid())
}

#[instrument]
pub async fn get_student_techniques(
    pool: &Pool<Sqlite>,
    student_id: i64,
) -> Result<Vec<StudentTechnique>, AppError> {
    info!("Getting student techniques");
    let rows = sqlx::query_as!(
        DbStudentTechnique,
        "SELECT * FROM student_techniques
         WHERE student_id = ?
        ORDER BY updated_at DESC
",
        student_id
    )
    .fetch_all(pool)
    .await?;

    let techniques: Vec<StudentTechnique> = rows
        .iter()
        .map(|row| StudentTechnique::from(row.clone()))
        .collect();
    Ok(techniques)
}

#[instrument]
pub async fn get_student_technique(
    pool: &Pool<Sqlite>,
    student_technique_id: i64,
) -> Result<StudentTechnique, AppError> {
    info!("Getting student technique");
    let row = sqlx::query_as!(
        DbStudentTechnique,
        "SELECT * FROM student_techniques
         WHERE id = ?",
        student_technique_id
    )
    .fetch_one(pool)
    .await?;

    Ok(StudentTechnique::from(row))
}

#[instrument]
pub async fn update_student_technique(
    pool: &Pool<Sqlite>,
    id: i64,
    status: &str,
    student_notes: &str,
    coach_notes: &str,
) -> Result<(), AppError> {
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
    .execute(pool)
    .await?;

    Ok(())
}

#[instrument]
pub async fn create_technique(
    pool: &Pool<Sqlite>,
    name: &str,
    description: &str,
    coach_id: i64,
) -> Result<i64, AppError> {
    info!("Creating technique");
    let res = sqlx::query!(
        "INSERT INTO techniques (name, description, coach_id)
         VALUES (?, ?, ?)",
        name,
        description,
        coach_id
    )
    .execute(pool)
    .await?;
    Ok(res.last_insert_rowid())
}

#[instrument]
pub async fn update_student_notes(
    pool: &Pool<Sqlite>,
    id: i64,
    student_notes: &str,
) -> Result<(), AppError> {
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
    .execute(pool)
    .await?;

    Ok(())
}

#[instrument]
pub async fn get_unassigned_techniques(
    pool: &Pool<Sqlite>,
    student_id: i64,
) -> Result<Vec<Technique>, AppError> {
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
    .fetch_all(pool)
    .await?;

    // No error thrown if there are no techniques found
    let techniques: Vec<Technique> = rows
        .iter()
        .map(|row| Technique::from(row.clone()))
        .collect();
    Ok(techniques)
}

#[instrument]
pub async fn add_techniques_to_student(
    pool: &Pool<Sqlite>,
    student_id: i64,
    technique_ids: Vec<i64>,
) -> Result<(), AppError> {
    info!("Adding technique to student");
    for technique_id in technique_ids {
        assign_technique_to_student(pool, technique_id, student_id).await?;
    }

    Ok(())
}

#[instrument]
pub async fn create_and_assign_technique(
    pool: &Pool<Sqlite>,
    coach_id: i64,
    student_id: i64,
    technique_name: &str,
    technique_description: &str,
) -> Result<(), AppError> {
    info!("Creating and assigning technique to student");
    let technique_id =
        create_technique(pool, technique_name, technique_description, coach_id).await?;

    assign_technique_to_student(pool, technique_id, student_id).await?;

    Ok(())
}

#[instrument(skip_all, fields(username))]
pub async fn authenticate_user(
    pool: &Pool<Sqlite>,
    username: &str,
    password: &str,
) -> Result<bool, AppError> {
    info!("Authenticating user");
    let user = sqlx::query!(
        "SELECT id, username, password, role FROM users WHERE username = ?",
        username
    )
    .fetch_optional(pool)
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
pub async fn create_user(
    pool: &Pool<Sqlite>,
    username: &str,
    password: &str,
    role: &str,
) -> Result<i64, AppError> {
    info!("Creating new user");

    let existing_user = sqlx::query!("SELECT id FROM users WHERE username = ?", username)
        .fetch_optional(pool)
        .await?;

    if existing_user.is_some() {
        return Err(AppError::Validation(format!(
            "Username '{}' already exists",
            username
        )));
    }

    let hashed_password = bcrypt::hash(password, bcrypt::DEFAULT_COST)?;

    let res = sqlx::query!(
        "INSERT INTO users (username, password, role) VALUES (?, ?, ?)",
        username,
        hashed_password,
        role
    )
    .execute(pool)
    .await?;

    Ok(res.last_insert_rowid())
}

#[instrument]
pub async fn get_user_by_username(pool: &Pool<Sqlite>, username: &str) -> Result<User, AppError> {
    info!("Getting user by username");
    let row = sqlx::query_as!(
        DbUser,
        "SELECT id, username, role, display_name FROM users WHERE username = ?",
        username
    )
    .fetch_optional(pool)
    .await?;

    match row {
        Some(db_user) => Ok(User::from(db_user)),
        _ => Err(AppError::NotFound(format!(
            "User with username {} not found in database",
            username
        ))),
    }
}

#[instrument]
pub async fn get_users_by_role(pool: &Pool<Sqlite>, role: &str) -> Result<Vec<User>, AppError> {
    let rows = sqlx::query_as::<_, DbUser>("SELECT * FROM Users WHERE Role = 'student'")
        .fetch_all(pool)
        .await?;

    let users: Vec<User> = rows.into_iter().map(User::from).collect();

    if users.is_empty() {
        return Err(AppError::NotFound(format!(
            "No users found for role {}",
            role
        )));
    }

    Ok(users)
}
