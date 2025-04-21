use crate::DATABASE_URL;
use chrono::Utc;
use sqlx::migrate::MigrateDatabase;
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

pub async fn maybe_create_database() -> Result<(), Error> {
    if !Sqlite::database_exists(DATABASE_URL).await.unwrap_or(false) {
        info!("Creating database {}", DATABASE_URL);
        Sqlite::create_database(DATABASE_URL).await?
    } else {
        info!("Database already exists");
    }

    // Create users table (for coaches and students)
    sqlx::query(
        "
        CREATE TABLE IF NOT EXISTS users (
           id INTEGER PRIMARY KEY,
           username TEXT NOT NULL UNIQUE,
           role TEXT NOT NULL
        )
        ",
    )
    .execute(&conn().await?)
    .await?;

    // Create techniques table
    sqlx::query(
        "
        CREATE TABLE IF NOT EXISTS techniques (
           id INTEGER PRIMARY KEY,
           name TEXT NOT NULL,
           description TEXT,
           coach_id INTEGER,
           coach_name TEXT,
           FOREIGN KEY (coach_id) REFERENCES users(id)
        )
        ",
    )
    .execute(&conn().await?)
    .await?;

    // Create student_techniques for tracking progress
    sqlx::query(
        "
        CREATE TABLE IF NOT EXISTS student_techniques (
           id INTEGER PRIMARY KEY,
           technique_id INTEGER,
           technique_name TEXT,
           technique_description TEXT,
           student_id INTEGER,
           status TEXT DEFAULT 'red',
           student_notes TEXT,
           coach_notes TEXT,
           created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
           updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
           FOREIGN KEY (technique_id) REFERENCES techniques(id),
           FOREIGN KEY (student_id) REFERENCES users(id)
        )
        ",
    )
    .execute(&conn().await?)
    .await?;

    // Insert some default users if none exist (for testing)
    sqlx::query(
        "
        INSERT OR IGNORE INTO users (username, role)
        SELECT 'coach1', 'coach'
        WHERE NOT EXISTS (SELECT 1 FROM users WHERE role = 'coach')
        ",
    )
    .execute(&conn().await?)
    .await?;

    sqlx::query(
        "
        INSERT OR IGNORE INTO users (username, role)
        SELECT 'student1', 'student'
        WHERE NOT EXISTS (SELECT 1 FROM users WHERE role = 'student')
        ",
    )
    .execute(&conn().await?)
    .await?;

    Ok(())
}

pub async fn seed_techniques() -> Result<(), Error> {
    // First, get coach ID to use as coach_id in techniques
    let coach = sqlx::query_as!(
        User,
        "SELECT id, username, role FROM users WHERE role = 'coach' LIMIT 1"
    )
    .fetch_optional(&conn().await?)
    .await?;

    // If we have a coach, use their ID for the techniques
    if let Some(coach) = coach {
        // Check if we already have techniques
        let count = sqlx::query_scalar!("SELECT COUNT(*) FROM techniques")
            .fetch_one(&conn().await?)
            .await?;

        // Only seed if no techniques exist
        if count == 0 {
            info!("Seeding techniques table with sample techniques");

            // Insert some basic techniques
            let techniques = [
                (
                    "Armbar from Guard",
                    "Control opponent's arm from closed guard, open guard, extend hips for submission",
                    coach.id,
                ),
                (
                    "Triangle Choke",
                    "Control arm and head from guard, lock legs around neck and arm, squeeze for choke",
                    coach.id,
                ),
                (
                    "Kimura",
                    "Control opponent's wrist and elbow, rotate arm for shoulder lock",
                    coach.id,
                ),
                (
                    "Double Leg Takedown",
                    "Level change, penetration step, grab both legs, drive forward to complete takedown",
                    coach.id,
                ),
                (
                    "Rear Naked Choke",
                    "Take back control, one arm under chin, other behind head, squeeze for blood choke",
                    coach.id,
                ),
            ];

            for (name, description, coach_id) in techniques {
                sqlx::query!(
                    "INSERT INTO techniques (name, description, coach_id, coach_name) VALUES (?, ?, ?, ?)",
                    name,
                    description,
                    coach_id,
                    coach.username
                )
                .execute(&conn().await?)
                .await?;
            }
        }
    }

    Ok(())
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

// Student-Technique functions
pub async fn assign_technique_to_student(
    technique_id: i64,
    student_id: i64,
) -> Result<i64, sqlx::Error> {
    struct ReturnRow {
        id: i64,
    }

    // Check if this assignment already exists
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
        ORDER BY updated_at

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
