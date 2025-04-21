use crate::DATABASE_URL;
use chrono::Utc;
use rocket::response::Redirect;
use sqlx::sqlite::SqlitePoolOptions;
use sqlx::{Error, Pool, Sqlite};

use crate::models::{DbStudentTechnique, DbTechnique, StudentTechnique, Technique, User};

async fn conn() -> Result<Pool<Sqlite>, sqlx::Error> {
    let pool = SqlitePoolOptions::new()
        .max_connections(5)
        .connect(DATABASE_URL)
        .await?;

    Ok(pool)
}

pub async fn get_user(id: i64) -> Result<User, sqlx::Error> {
    let row = sqlx::query_as!(User, "SELECT id, username, role FROM users WHERE id=?", id)
        .fetch_one(&conn().await?)
        .await?;
    Ok(row)
}

pub async fn get_users_by_role(role: &str) -> Result<Vec<User>, sqlx::Error> {
    let rows: Vec<User> = sqlx::query_as!(
        User,
        "
SELECT id, username, role 
FROM users 
WHERE role=?
            ",
        role
    )
    .fetch_all(&conn().await?)
    .await?;
    Ok(rows)
}

pub async fn add_technique(
    name: &str,
    description: &str,
    coach_id: i64,
) -> Result<i64, sqlx::Error> {
    let res = sqlx::query("INSERT INTO techniques (name, description, coach_id) VALUES (?, ?, ?)")
        .bind(name)
        .bind(description)
        .bind(coach_id)
        .execute(&conn().await?)
        .await?;
    Ok(res.last_insert_rowid())
}

pub async fn get_all_techniques() -> Result<Vec<Technique>, Error> {
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

pub async fn update_technique(
    technique_id: i64,
    name: &str,
    description: &str,
) -> Result<(), sqlx::Error> {
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

pub async fn assign_technique_to_student(
    technique_id: i64,
    student_id: i64,
) -> Result<i64, sqlx::Error> {
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

pub async fn get_student_techniques(student_id: i64) -> Result<Vec<StudentTechnique>, sqlx::Error> {
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

pub async fn get_student_technique(
    student_technique_id: i64,
) -> Result<StudentTechnique, sqlx::Error> {
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

pub async fn update_student_technique(
    id: i64,
    status: &str,
    student_notes: &str,
    coach_notes: &str,
) -> Result<(), sqlx::Error> {
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

pub async fn create_technique(
    name: &str,
    description: &str,
    coach_id: i64,
) -> Result<i64, sqlx::Error> {
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

pub async fn get_unassigned_techniques(student_id: i64) -> Result<Vec<Technique>, sqlx::Error> {
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

pub async fn add_techniques_to_student(
    student_id: i64,
    technique_ids: Vec<i64>,
) -> Result<Redirect, sqlx::Error> {
    for technique_id in technique_ids {
        assign_technique_to_student(technique_id, student_id).await?;
    }

    Ok(Redirect::to(format!("/student/{}", student_id)))
}

pub async fn create_and_assign_technique(
    coach_id: i64,
    student_id: i64,
    technique_name: &str,
    technique_description: &str,
) -> Result<Redirect, sqlx::Error> {
    let technique_id = create_technique(technique_name, technique_description, coach_id).await?;

    assign_technique_to_student(technique_id, student_id).await?;

    Ok(Redirect::to(format!("/student/{}", student_id)))
}
