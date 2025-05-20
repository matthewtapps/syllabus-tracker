use std::collections::{HashMap, hash_map::Entry};

use crate::{
    auth::{DbUser, DbUserSession, Role, User, UserSession},
    error::AppError,
    models::{DbTag, Tag},
};
use chrono::{NaiveDateTime, Utc};
use sqlx::{Pool, Sqlite};
use tracing::{info, instrument};

use crate::models::{DbStudentTechnique, DbTechnique, StudentTechnique, Technique};

#[instrument]
pub async fn get_user(pool: &Pool<Sqlite>, id: i64) -> Result<User, AppError> {
    info!("Fetching user by ID");
    let row = sqlx::query_as!(
        DbUser,
        "SELECT id, username, role, display_name, archived FROM users WHERE id=?",
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

#[instrument(skip(pool, new_password))]
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
    info!("Getting all techniques with tags");

    let rows = sqlx::query!(
        r#"
        SELECT t.id, t.name, t.description, t.coach_id, t.coach_name,
               tag.id as tag_id, tag.name as tag_name
        FROM techniques t
        LEFT JOIN technique_tags tt ON t.id = tt.technique_id
        LEFT JOIN tags tag ON tt.tag_id = tag.id
        ORDER BY t.name
        "#
    )
    .fetch_all(pool)
    .await?;

    // Group by technique
    let mut techniques_map: HashMap<i64, Technique> = HashMap::new();

    for row in rows {
        let technique_id = row.id;

        if let Entry::Vacant(e) = techniques_map.entry(technique_id) {
            let technique = Technique {
                id: technique_id,
                name: row.name,
                description: row.description.unwrap_or_default(),
                coach_id: row.coach_id.unwrap_or_default(),
                coach_name: row.coach_name.unwrap_or_default(),
                tags: Vec::new(),
            };
            e.insert(technique);
        }

        // Add tag if it exists
        if let (tag_id, Some(tag_name)) = (row.tag_id, row.tag_name) {
            let tag = Tag {
                id: tag_id,
                name: tag_name,
            };

            // Avoid duplicate tags
            let technique = techniques_map.get_mut(&technique_id).unwrap();
            if !technique.tags.iter().any(|t| t.id == tag_id) {
                technique.tags.push(tag);
            }
        }
    }

    // Sort tags by name for each technique
    for technique in techniques_map.values_mut() {
        technique.tags.sort_by(|a, b| a.name.cmp(&b.name));
    }

    // Convert map to vector and return
    let techniques: Vec<Technique> = techniques_map.into_values().collect();
    Ok(techniques)
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
    info!("Getting student techniques with tags");

    let rows = sqlx::query!(
        r#"
        SELECT st.id, st.technique_id, st.technique_name, st.technique_description,
               st.student_id, st.status, st.student_notes, st.coach_notes, 
               st.created_at, st.updated_at,
               tag.id as tag_id, tag.name as tag_name
        FROM student_techniques st
        LEFT JOIN technique_tags tt ON st.technique_id = tt.technique_id
        LEFT JOIN tags tag ON tt.tag_id = tag.id
        WHERE st.student_id = ?
        ORDER BY st.updated_at DESC
        "#,
        student_id
    )
    .fetch_all(pool)
    .await?;

    let mut techniques_map: HashMap<i64, StudentTechnique> = HashMap::new();

    for row in rows {
        let technique_id = row.id;

        if let Entry::Vacant(e) = techniques_map.entry(technique_id) {
            let technique = StudentTechnique {
                id: technique_id,
                technique_id: row.technique_id.unwrap_or_default(),
                student_id: row.student_id.unwrap_or_default(),
                technique_name: row.technique_name.unwrap_or_default(),
                technique_description: row.technique_description.unwrap_or_default(),
                status: row.status.unwrap_or_default(),
                student_notes: row.student_notes.unwrap_or_default(),
                coach_notes: row.coach_notes.unwrap_or_default(),
                created_at: row
                    .created_at
                    .map(|dt| chrono::DateTime::<Utc>::from_naive_utc_and_offset(dt, Utc))
                    .unwrap_or_else(Utc::now),
                updated_at: row
                    .updated_at
                    .map(|dt| chrono::DateTime::<Utc>::from_naive_utc_and_offset(dt, Utc))
                    .unwrap_or_else(Utc::now),
                tags: Vec::new(),
            };
            e.insert(technique);
        }

        if let (tag_id, Some(tag_name)) = (row.tag_id, row.tag_name) {
            let tag = Tag {
                id: tag_id,
                name: tag_name,
            };

            let technique = techniques_map.get_mut(&technique_id).unwrap();
            if !technique.tags.iter().any(|t| t.id == tag_id) {
                technique.tags.push(tag);
            }
        }
    }

    for technique in techniques_map.values_mut() {
        technique.tags.sort_by(|a, b| a.name.cmp(&b.name));
    }

    let mut techniques: Vec<StudentTechnique> = techniques_map.into_values().collect();
    techniques.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));

    Ok(techniques)
}

#[instrument]
pub async fn get_student_technique(
    pool: &Pool<Sqlite>,
    student_technique_id: i64,
) -> Result<StudentTechnique, AppError> {
    info!("Getting student technique with tags");

    let row = sqlx::query_as!(
        DbStudentTechnique,
        "SELECT * FROM student_techniques WHERE id = ?",
        student_technique_id
    )
    .fetch_one(pool)
    .await?;

    let mut technique = StudentTechnique::from(row.clone());

    if let Some(technique_id) = row.technique_id {
        let tags = sqlx::query_as!(
            DbTag,
            "SELECT t.id, t.name 
             FROM tags t
             JOIN technique_tags tt ON t.id = tt.tag_id
             WHERE tt.technique_id = ?
             ORDER BY t.name",
            technique_id
        )
        .fetch_all(pool)
        .await?;

        technique.tags = tags.into_iter().map(Tag::from).collect();
    }

    Ok(technique)
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
    info!("Getting unassigned techniques with tags");

    let rows = sqlx::query!(
        r#"
        SELECT t.id, t.name, t.description, t.coach_id, t.coach_name,
               tag.id as tag_id, tag.name as tag_name
        FROM techniques t
        LEFT JOIN technique_tags tt ON t.id = tt.technique_id
        LEFT JOIN tags tag ON tt.tag_id = tag.id
        WHERE t.id NOT IN (
            SELECT technique_id FROM student_techniques 
            WHERE student_id = ?
        )
        ORDER BY t.name
        "#,
        student_id
    )
    .fetch_all(pool)
    .await?;

    let mut techniques_map: HashMap<i64, Technique> = HashMap::new();

    for row in rows {
        let technique_id = row.id;

        if let std::collections::hash_map::Entry::Vacant(e) = techniques_map.entry(technique_id) {
            let technique = Technique {
                id: technique_id,
                name: row.name,
                description: row.description.unwrap_or_default(),
                coach_id: row.coach_id.unwrap_or_default(),
                coach_name: row.coach_name.unwrap_or_default(),
                tags: Vec::new(),
            };
            e.insert(technique);
        }

        if let (tag_id, Some(tag_name)) = (row.tag_id, row.tag_name) {
            let tag = Tag {
                id: tag_id,
                name: tag_name,
            };

            let technique = techniques_map.get_mut(&technique_id).unwrap();
            if !technique.tags.iter().any(|t| t.id == tag_id) {
                technique.tags.push(tag);
            }
        }
    }

    for technique in techniques_map.values_mut() {
        technique.tags.sort_by(|a, b| a.name.cmp(&b.name));
    }

    // Convert map to vector and return
    let techniques: Vec<Technique> = techniques_map.into_values().collect();
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

#[instrument(skip(pool, password))]
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

#[instrument(skip(pool, password))]
pub async fn create_user(
    pool: &Pool<Sqlite>,
    username: &str,
    password: &str,
    role: &str,
    display_name: Option<&str>,
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
        "INSERT INTO users (username, display_name, password, role) VALUES (?, ?, ?, ?)",
        username,
        display_name,
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
        "SELECT id, username, role, display_name, archived FROM users WHERE username = ?",
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
pub async fn get_users_by_role(
    pool: &Pool<Sqlite>,
    role: &str,
    show_archived: bool,
) -> Result<Vec<User>, AppError> {
    info!(role = %role, show_archived = %show_archived, "Getting users by role");

    let query = if show_archived {
        "SELECT id, username, role, display_name, archived FROM users WHERE role = ?"
    } else {
        "SELECT id, username, role, display_name, archived FROM users WHERE role = ? AND archived IS 0"
    };

    let rows = sqlx::query_as::<_, DbUser>(query)
        .bind(role)
        .fetch_all(pool)
        .await?;

    let users: Vec<User> = rows.into_iter().map(User::from).collect();

    Ok(users)
}

#[instrument]
pub async fn get_all_users(pool: &Pool<Sqlite>) -> Result<Vec<User>, AppError> {
    let rows = sqlx::query_as::<_, DbUser>("SELECT * FROM Users")
        .fetch_all(pool)
        .await?;

    let users: Vec<User> = rows.into_iter().map(User::from).collect();

    if users.is_empty() {
        return Err(AppError::NotFound("No users found".to_string()));
    }

    Ok(users)
}

#[instrument]
pub async fn update_user_admin(
    pool: &Pool<Sqlite>,
    user_id: i64,
    username: &str,
    display_name: &str,
    role: &str,
) -> Result<(), AppError> {
    info!("Admin updating user");

    let existing = sqlx::query!(
        "SELECT id FROM users WHERE username = ? AND id != ?",
        username,
        user_id
    )
    .fetch_optional(pool)
    .await?;

    if existing.is_some() {
        return Err(AppError::Validation("Username already exists".to_string()));
    }

    sqlx::query!(
        "UPDATE users SET username = ?, display_name = ?, role = ? WHERE id = ?",
        username,
        display_name,
        role,
        user_id
    )
    .execute(pool)
    .await?;

    Ok(())
}

#[instrument]
pub async fn set_user_archived(
    pool: &Pool<Sqlite>,
    user_id: i64,
    archive: bool,
) -> Result<bool, AppError> {
    info!("Toggling user archived status");

    sqlx::query!(
        "UPDATE users SET archived = ? WHERE id = ?",
        archive,
        user_id
    )
    .execute(pool)
    .await?;

    Ok(archive)
}

#[instrument(skip(pool, token))]
pub async fn create_user_session(
    pool: &Pool<Sqlite>,
    user_id: i64,
    token: &str,
    expires_at: NaiveDateTime,
) -> Result<i64, AppError> {
    info!("Creating user session");

    let res = sqlx::query!(
        "INSERT INTO user_sessions (user_id, token, expires_at) VALUES (?, ?, ?)",
        user_id,
        token,
        expires_at
    )
    .execute(pool)
    .await?;

    Ok(res.last_insert_rowid())
}

#[instrument(skip(pool, token))]
pub async fn get_session_by_token(
    pool: &Pool<Sqlite>,
    token: &str,
) -> Result<crate::auth::UserSession, AppError> {
    info!("Getting session by token");

    let session = sqlx::query_as!(
        DbUserSession,
        "SELECT id, user_id, token, created_at, expires_at FROM user_sessions WHERE token = ?",
        token
    )
    .fetch_optional(pool)
    .await?;

    match session {
        Some(session) => Ok(UserSession::from(session)),
        _ => Err(AppError::Authentication(
            "Invalid session token".to_string(),
        )),
    }
}

#[instrument(skip(pool, token))]
pub async fn invalidate_session(pool: &Pool<Sqlite>, token: &str) -> Result<(), AppError> {
    info!("Invalidating session");

    sqlx::query!("DELETE FROM user_sessions WHERE token = ?", token)
        .execute(pool)
        .await?;

    Ok(())
}

#[instrument(skip(pool))]
pub async fn clean_expired_sessions(pool: &Pool<Sqlite>) -> Result<u64, AppError> {
    info!("Cleaning expired sessions");

    let now = Utc::now().naive_utc();

    let result = sqlx::query!("DELETE FROM user_sessions WHERE expires_at < ?", now)
        .execute(pool)
        .await?;

    Ok(result.rows_affected())
}

#[derive(sqlx::FromRow)]
pub struct UserWithActivityDto {
    pub id: Option<i64>,
    pub username: Option<String>,
    pub role: Option<String>,
    pub display_name: Option<String>,
    pub archived: Option<bool>,
    pub last_update: Option<String>,
}

#[instrument(skip(pool))]
pub async fn get_students_by_recent_updates(
    pool: &Pool<Sqlite>,
    include_archived: bool,
) -> Result<Vec<User>, AppError> {
    let dtos = sqlx::query_as!(
        UserWithActivityDto,
        r#"
        SELECT 
            u.id, 
            u.username, 
            u.display_name, 
            u.role, 
            u.archived, 
            MAX(st.updated_at) as last_update
        FROM users u
        LEFT JOIN student_techniques st ON u.id = st.student_id
        WHERE u.role = 'student'
        GROUP BY u.id
        ORDER BY last_update DESC NULLS LAST
        "#
    )
    .fetch_all(pool)
    .await?;

    // First collect into a Vec<User>
    let users: Vec<User> = dtos
        .into_iter()
        .map(|dto| User {
            id: dto.id.unwrap_or_default(),
            username: dto.username.unwrap_or_default(),
            role: Role::from_str(&dto.role.unwrap_or_default()).unwrap(),
            display_name: dto.display_name.unwrap_or_default(),
            archived: dto.archived.unwrap_or_default(),
            last_update: dto.last_update,
        })
        .collect();

    if include_archived {
        Ok(users)
    } else {
        Ok(users.into_iter().filter(|user| !user.archived).collect())
    }
}

#[instrument]
pub async fn create_tag(pool: &Pool<Sqlite>, name: &str) -> Result<i64, AppError> {
    info!("Creating tag");
    let res = sqlx::query!("INSERT INTO tags (name) VALUES (?)", name)
        .execute(pool)
        .await?;
    Ok(res.last_insert_rowid())
}

#[instrument]
pub async fn get_all_tags(pool: &Pool<Sqlite>) -> Result<Vec<Tag>, AppError> {
    info!("Getting all tags");
    let rows = sqlx::query_as!(DbTag, "SELECT id, name FROM tags ORDER BY name")
        .fetch_all(pool)
        .await?;

    Ok(rows.into_iter().map(Tag::from).collect())
}

#[instrument]
pub async fn get_tags_for_technique(
    pool: &Pool<Sqlite>,
    technique_id: i64,
) -> Result<Vec<Tag>, AppError> {
    info!("Getting tags for technique");
    let rows = sqlx::query_as!(
        DbTag,
        "SELECT t.id, t.name 
         FROM tags t
         JOIN technique_tags tt ON t.id = tt.tag_id
         WHERE tt.technique_id = ?
         ORDER BY t.name",
        technique_id
    )
    .fetch_all(pool)
    .await?;

    Ok(rows.into_iter().map(Tag::from).collect())
}

#[instrument]
pub async fn add_tag_to_technique(
    pool: &Pool<Sqlite>,
    technique_id: i64,
    tag_id: i64,
) -> Result<(), AppError> {
    info!("Adding tag to technique");
    sqlx::query!(
        "INSERT OR IGNORE INTO technique_tags (technique_id, tag_id) VALUES (?, ?)",
        technique_id,
        tag_id
    )
    .execute(pool)
    .await?;

    Ok(())
}

#[instrument]
pub async fn remove_tag_from_technique(
    pool: &Pool<Sqlite>,
    technique_id: i64,
    tag_id: i64,
) -> Result<(), AppError> {
    info!("Removing tag from technique");
    sqlx::query!(
        "DELETE FROM technique_tags WHERE technique_id = ? AND tag_id = ?",
        technique_id,
        tag_id
    )
    .execute(pool)
    .await?;

    Ok(())
}

#[instrument]
pub async fn delete_tag(pool: &Pool<Sqlite>, tag_id: i64) -> Result<(), AppError> {
    info!("Deleting tag");
    // The technique_tags relationships will be automatically deleted due to the ON DELETE CASCADE constraint
    sqlx::query!("DELETE FROM tags WHERE id = ?", tag_id)
        .execute(pool)
        .await?;

    Ok(())
}

#[instrument]
pub async fn get_tag_by_name(pool: &Pool<Sqlite>, name: &str) -> Result<Option<Tag>, AppError> {
    info!("Getting tag by name");
    let row = sqlx::query_as!(DbTag, "SELECT id, name FROM tags WHERE name = ?", name)
        .fetch_optional(pool)
        .await?;

    Ok(row.map(Tag::from))
}

#[instrument]
pub async fn get_techniques_by_tag(
    pool: &Pool<Sqlite>,
    tag_id: i64,
) -> Result<Vec<Technique>, AppError> {
    info!("Getting techniques by tag");
    let rows = sqlx::query_as!(
        DbTechnique,
        "SELECT t.* 
         FROM techniques t
         JOIN technique_tags tt ON t.id = tt.technique_id
         WHERE tt.tag_id = ?
         ORDER BY t.name",
        tag_id
    )
    .fetch_all(pool)
    .await?;

    Ok(rows.into_iter().map(Technique::from).collect())
}

#[instrument]
pub async fn update_user_role(
    pool: &Pool<Sqlite>,
    user_id: i64,
    role: &str,
) -> Result<(), AppError> {
    info!("Updating user role");
    sqlx::query!("UPDATE users SET role = ? WHERE id = ?", role, user_id)
        .execute(pool)
        .await?;

    Ok(())
}
