use std::collections::{HashMap, hash_map::Entry};

use crate::{
    auth::{DbUser, DbUserSession, Role, User, UserSession},
    error::AppError,
    models::{DbTag, Tag, naive_to_utc},
};
use chrono::{NaiveDateTime, Utc};
use serde::Serialize;
use sqlx::{Pool, Sqlite};
use tracing::{info, instrument};

use crate::models::{DbStudentTechnique, DbTechnique, StudentTechnique, Technique};

#[instrument]
pub async fn get_user(pool: &Pool<Sqlite>, id: i64) -> Result<User, AppError> {
    info!("Fetching user by ID");
    let row = sqlx::query_as!(
        DbUser,
        "SELECT id, username, role, display_name, archived, graduated_at, email, claimed_at, approved_at, first_name, last_name, reset_requested_at FROM users WHERE id=?",
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
    let existing_user = sqlx::query!(
        "SELECT id FROM users WHERE username = ? AND id != ?",
        new_username,
        user_id
    )
    .fetch_optional(pool)
    .await?;

    if existing_user.is_some() {
        return Err(AppError::Internal(
            "Uncaught username validation error".to_string(),
        ));
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
    collection_id: Option<i64>,
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
        // If the caller is assigning into a specific collection, move the
        // existing assignment into that collection. Status and notes are
        // preserved. Loose-assign (collection_id = None) leaves it alone.
        if let Some(cid) = collection_id {
            sqlx::query!(
                "UPDATE student_techniques SET collection_id = ? WHERE id = ?",
                cid,
                row.id
            )
            .execute(pool)
            .await?;
        }
        return Ok(row.id);
    }

    let res = sqlx::query!(
        "INSERT INTO student_techniques
     (student_id, student_notes, coach_notes, technique_id, technique_name, technique_description, collection_id)
     SELECT ?, '', '', t.id, t.name, t.description, ?
     FROM techniques t WHERE t.id = ?",
        student_id,
        collection_id,
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
               st.last_coach_update_at, st.last_coach_update_by_id,
               st.last_student_update_at, st.last_student_update_by_id,
               st.collection_id,
               cu.display_name as coach_updater_display_name,
               cu.username as coach_updater_username,
               su.display_name as student_updater_display_name,
               su.username as student_updater_username,
               coll.name as "collection_name?",
               tag.id as tag_id, tag.name as tag_name
        FROM student_techniques st
        LEFT JOIN users cu ON st.last_coach_update_by_id = cu.id
        LEFT JOIN users su ON st.last_student_update_by_id = su.id
        LEFT JOIN collections coll ON st.collection_id = coll.id
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
            let coach_updater_name = row
                .coach_updater_display_name
                .filter(|s| !s.is_empty())
                .or(row.coach_updater_username);
            let student_updater_name = row
                .student_updater_display_name
                .filter(|s| !s.is_empty())
                .or(row.student_updater_username);

            let technique = StudentTechnique {
                id: technique_id,
                technique_id: row.technique_id.unwrap_or_default(),
                student_id: row.student_id.unwrap_or_default(),
                technique_name: row.technique_name.unwrap_or_default(),
                technique_description: row.technique_description.unwrap_or_default(),
                status: row.status.unwrap_or_default(),
                student_notes: row.student_notes.unwrap_or_default(),
                coach_notes: row.coach_notes.unwrap_or_default(),
                created_at: row.created_at.map(naive_to_utc).unwrap_or_else(Utc::now),
                updated_at: row.updated_at.map(naive_to_utc).unwrap_or_else(Utc::now),
                last_coach_update_at: row.last_coach_update_at.map(naive_to_utc),
                last_coach_update_by_id: row.last_coach_update_by_id,
                last_coach_update_by_name: coach_updater_name,
                last_student_update_at: row.last_student_update_at.map(naive_to_utc),
                last_student_update_by_id: row.last_student_update_by_id,
                last_student_update_by_name: student_updater_name,
                collection_id: row.collection_id,
                collection_name: row.collection_name,
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

#[instrument(skip(actor))]
pub async fn update_student_technique(
    pool: &Pool<Sqlite>,
    id: i64,
    actor: &User,
    status: &str,
    student_notes: &str,
    coach_notes: &str,
) -> Result<(), AppError> {
    info!("Updating student technique");
    let now = Utc::now();
    let actor_id = actor.id;

    match actor.role {
        Role::Coach | Role::Admin => {
            sqlx::query!(
                "UPDATE student_techniques
                 SET status = ?, student_notes = ?, coach_notes = ?, updated_at = ?,
                     last_coach_update_at = ?, last_coach_update_by_id = ?
                 WHERE id = ?",
                status,
                student_notes,
                coach_notes,
                now,
                now,
                actor_id,
                id
            )
            .execute(pool)
            .await?;
        }
        Role::Student => {
            sqlx::query!(
                "UPDATE student_techniques
                 SET status = ?, student_notes = ?, coach_notes = ?, updated_at = ?,
                     last_student_update_at = ?, last_student_update_by_id = ?
                 WHERE id = ?",
                status,
                student_notes,
                coach_notes,
                now,
                now,
                actor_id,
                id
            )
            .execute(pool)
            .await?;
        }
    }

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

#[instrument(skip(actor))]
pub async fn update_student_notes(
    pool: &Pool<Sqlite>,
    id: i64,
    actor: &User,
    student_notes: &str,
) -> Result<(), AppError> {
    info!("Updating student notes");
    let now = Utc::now();
    let actor_id = actor.id;

    match actor.role {
        Role::Coach | Role::Admin => {
            sqlx::query!(
                "UPDATE student_techniques
                 SET student_notes = ?, updated_at = ?,
                     last_coach_update_at = ?, last_coach_update_by_id = ?
                 WHERE id = ?",
                student_notes,
                now,
                now,
                actor_id,
                id
            )
            .execute(pool)
            .await?;
        }
        Role::Student => {
            sqlx::query!(
                "UPDATE student_techniques
                 SET student_notes = ?, updated_at = ?,
                     last_student_update_at = ?, last_student_update_by_id = ?
                 WHERE id = ?",
                student_notes,
                now,
                now,
                actor_id,
                id
            )
            .execute(pool)
            .await?;
        }
    }

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
    collection_id: Option<i64>,
) -> Result<(), AppError> {
    info!("Adding techniques to student");
    for technique_id in technique_ids {
        assign_technique_to_student(pool, technique_id, student_id, collection_id).await?;
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
    collection_id: Option<i64>,
) -> Result<(), AppError> {
    info!("Creating and assigning technique to student");
    let technique_id =
        create_technique(pool, technique_name, technique_description, coach_id).await?;

    assign_technique_to_student(pool, technique_id, student_id, collection_id).await?;

    Ok(())
}

#[instrument(skip(pool, password))]
pub async fn authenticate_user(
    pool: &Pool<Sqlite>,
    username: &str,
    password: &str,
) -> Result<Option<User>, AppError> {
    let user_auth = sqlx::query!(
        r#"SELECT id, username, password, role, display_name, archived,
                  email, first_name, last_name,
                  CAST(graduated_at AS TEXT) as "graduated_at?: String",
                  CAST(claimed_at AS TEXT) as "claimed_at?: String",
                  CAST(approved_at AS TEXT) as "approved_at?: String",
                  CAST(reset_requested_at AS TEXT) as "reset_requested_at?: String"
           FROM users WHERE username = ?"#,
        username
    )
    .fetch_optional(pool)
    .await?;

    match user_auth {
        Some(user) => {
            // Stub (unclaimed) users have an empty password. bcrypt::verify
            // would error on a non-hash, so short-circuit cleanly here.
            if user.password.is_empty() {
                return Ok(None);
            }
            if bcrypt::verify(password, &user.password)? {
                Ok(Some(User {
                    id: user.id.unwrap(),
                    username: user.username.clone().unwrap_or_default(),
                    role: Role::from_str(&user.role)?,
                    display_name: user.display_name.unwrap_or_default(),
                    archived: user.archived,
                    graduated_at: user.graduated_at,
                    email: user.email,
                    claimed_at: user.claimed_at,
                    approved_at: user.approved_at,
                    first_name: user.first_name,
                    last_name: user.last_name,
                    reset_requested_at: user.reset_requested_at,
                    last_update: None,
                    last_coach_update_at: None,
                    total_techniques: None,
                    red_count: None,
                    amber_count: None,
                    green_count: None,
                    has_new_student_activity: None,
                }))
            } else {
                Ok(None) // Password doesn't match
            }
        }
        None => Ok(None), // User not found
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
        return Err(AppError::Internal(
            "Uncaught username validation error".to_string(),
        ));
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

pub async fn find_user_by_username(
    pool: &Pool<Sqlite>,
    username: &str,
) -> Result<Option<User>, AppError> {
    let row = sqlx::query_as!(
        DbUser,
        "SELECT id, username, role, display_name, archived, graduated_at, email, claimed_at, approved_at, first_name, last_name, reset_requested_at FROM users WHERE username = ?",
        username
    )
    .fetch_optional(pool)
    .await?;

    Ok(row.map(User::from))
}

#[instrument]
pub async fn get_users_by_role(
    pool: &Pool<Sqlite>,
    role: &str,
    show_archived: bool,
) -> Result<Vec<User>, AppError> {
    info!(role = %role, show_archived = %show_archived, "Getting users by role");

    let query = if show_archived {
        "SELECT id, username, role, display_name, archived, graduated_at, email, claimed_at, approved_at, first_name, last_name, reset_requested_at FROM users WHERE role = ?"
    } else {
        "SELECT id, username, role, display_name, archived, graduated_at, email, claimed_at, approved_at, first_name, last_name, reset_requested_at FROM users WHERE role = ? AND archived IS 0"
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

    let existing_user = sqlx::query!(
        "SELECT id FROM users WHERE username = ? AND id != ?",
        username,
        user_id
    )
    .fetch_optional(pool)
    .await?;

    if existing_user.is_some() {
        return Err(AppError::Internal(
            "Uncaught username validation error".to_string(),
        ));
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

/// Atomically read the user's previous `last_seen_at` and update it to NOW.
/// Returns the previous value (None if this is the first visit).
#[instrument]
pub async fn read_and_bump_last_seen(
    pool: &Pool<Sqlite>,
    user_id: i64,
) -> Result<Option<String>, AppError> {
    info!("Reading and bumping last_seen_at");

    let row = sqlx::query!(
        r#"SELECT CAST(last_seen_at AS TEXT) as "last_seen_at?: String" FROM users WHERE id = ?"#,
        user_id
    )
    .fetch_one(pool)
    .await?;

    let now = Utc::now();
    sqlx::query!(
        "UPDATE users SET last_seen_at = ? WHERE id = ?",
        now,
        user_id
    )
    .execute(pool)
    .await?;

    Ok(row.last_seen_at)
}

#[instrument]
pub async fn set_user_graduated(
    pool: &Pool<Sqlite>,
    user_id: i64,
    graduated: bool,
    actor_id: Option<i64>,
) -> Result<bool, AppError> {
    info!("Setting graduated state");

    if graduated {
        let now = Utc::now();
        sqlx::query!(
            "UPDATE users SET graduated_at = ?, graduated_by_id = ? WHERE id = ?",
            now,
            actor_id,
            user_id
        )
        .execute(pool)
        .await?;
    } else {
        sqlx::query!(
            "UPDATE users SET graduated_at = NULL, graduated_by_id = NULL WHERE id = ?",
            user_id
        )
        .execute(pool)
        .await?;
    }

    Ok(graduated)
}

// ---- Collections / syllabuses ----

#[derive(Debug, Serialize, Clone)]
pub struct Collection {
    pub id: i64,
    pub name: String,
    pub description: String,
    pub coach_id: Option<i64>,
    pub created_at: chrono::DateTime<chrono::Utc>,
    pub technique_count: i64,
    pub student_count: i64,
    pub techniques: Vec<Technique>,
}

#[instrument]
pub async fn create_collection(
    pool: &Pool<Sqlite>,
    name: &str,
    description: &str,
    coach_id: i64,
) -> Result<i64, AppError> {
    info!("Creating collection");
    let res = sqlx::query!(
        "INSERT INTO collections (name, description, coach_id) VALUES (?, ?, ?)",
        name,
        description,
        coach_id
    )
    .execute(pool)
    .await?;
    Ok(res.last_insert_rowid())
}

#[instrument]
pub async fn update_collection(
    pool: &Pool<Sqlite>,
    collection_id: i64,
    name: &str,
    description: &str,
) -> Result<(), AppError> {
    info!("Updating collection");
    sqlx::query!(
        "UPDATE collections SET name = ?, description = ? WHERE id = ?",
        name,
        description,
        collection_id
    )
    .execute(pool)
    .await?;
    Ok(())
}

#[instrument]
pub async fn delete_collection(pool: &Pool<Sqlite>, collection_id: i64) -> Result<(), AppError> {
    info!("Deleting collection");
    // Existing student assignments in this collection become "loose" rather
    // than disappear (preserves the student's history).
    sqlx::query!(
        "UPDATE student_techniques SET collection_id = NULL WHERE collection_id = ?",
        collection_id
    )
    .execute(pool)
    .await?;
    sqlx::query!("DELETE FROM collections WHERE id = ?", collection_id)
        .execute(pool)
        .await?;
    Ok(())
}

#[instrument]
pub async fn get_all_collections(pool: &Pool<Sqlite>) -> Result<Vec<Collection>, AppError> {
    info!("Listing collections");
    let rows = sqlx::query!(
        r#"
        SELECT
            c.id, c.name, c.description, c.coach_id,
            c.created_at as "created_at: chrono::NaiveDateTime",
            (SELECT COUNT(*) FROM collection_techniques WHERE collection_id = c.id)
                as "technique_count!: i64",
            (SELECT COUNT(DISTINCT student_id) FROM student_techniques WHERE collection_id = c.id)
                as "student_count!: i64"
        FROM collections c
        ORDER BY c.name
        "#
    )
    .fetch_all(pool)
    .await?;

    Ok(rows
        .into_iter()
        .map(|r| Collection {
            id: r.id,
            name: r.name,
            description: r.description.unwrap_or_default(),
            coach_id: r.coach_id,
            created_at: r
                .created_at
                .map(naive_to_utc)
                .unwrap_or_else(chrono::Utc::now),
            technique_count: r.technique_count,
            student_count: r.student_count,
            techniques: Vec::new(),
        })
        .collect())
}

#[instrument]
pub async fn get_collection(pool: &Pool<Sqlite>, collection_id: i64) -> Result<Collection, AppError> {
    info!("Getting collection");
    let row = sqlx::query!(
        r#"
        SELECT
            c.id, c.name, c.description, c.coach_id,
            c.created_at as "created_at: chrono::NaiveDateTime",
            (SELECT COUNT(*) FROM collection_techniques WHERE collection_id = c.id)
                as "technique_count!: i64",
            (SELECT COUNT(DISTINCT student_id) FROM student_techniques WHERE collection_id = c.id)
                as "student_count!: i64"
        FROM collections c
        WHERE c.id = ?
        "#,
        collection_id
    )
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("Collection {} not found", collection_id)))?;

    let technique_rows = sqlx::query!(
        r#"
        SELECT t.id, t.name, t.description, t.coach_id, t.coach_name
        FROM collection_techniques ct
        JOIN techniques t ON t.id = ct.technique_id
        WHERE ct.collection_id = ?
        ORDER BY ct.position, t.name
        "#,
        collection_id
    )
    .fetch_all(pool)
    .await?;

    let techniques: Vec<Technique> = technique_rows
        .into_iter()
        .map(|r| Technique {
            id: r.id.unwrap_or_default(),
            name: r.name,
            description: r.description.unwrap_or_default(),
            coach_id: r.coach_id.unwrap_or_default(),
            coach_name: r.coach_name.unwrap_or_default(),
            tags: Vec::new(),
        })
        .collect();

    Ok(Collection {
        id: row.id,
        name: row.name,
        description: row.description.unwrap_or_default(),
        coach_id: row.coach_id,
        created_at: row
            .created_at
            .map(naive_to_utc)
            .unwrap_or_else(chrono::Utc::now),
        technique_count: row.technique_count,
        student_count: row.student_count,
        techniques,
    })
}

#[instrument]
pub async fn add_technique_to_collection(
    pool: &Pool<Sqlite>,
    collection_id: i64,
    technique_id: i64,
) -> Result<(), AppError> {
    info!("Adding technique to collection");
    sqlx::query!(
        "INSERT OR IGNORE INTO collection_techniques (collection_id, technique_id, position)
         VALUES (?, ?,
            (SELECT COALESCE(MAX(position), -1) + 1 FROM collection_techniques WHERE collection_id = ?))",
        collection_id,
        technique_id,
        collection_id
    )
    .execute(pool)
    .await?;
    Ok(())
}

#[instrument]
pub async fn add_techniques_to_collection(
    pool: &Pool<Sqlite>,
    collection_id: i64,
    technique_ids: Vec<i64>,
) -> Result<(), AppError> {
    info!("Adding techniques to collection");
    for technique_id in technique_ids {
        add_technique_to_collection(pool, collection_id, technique_id).await?;
    }
    Ok(())
}

#[instrument]
pub async fn create_technique_in_collection(
    pool: &Pool<Sqlite>,
    coach_id: i64,
    collection_id: i64,
    name: &str,
    description: &str,
) -> Result<i64, AppError> {
    info!("Creating technique in collection");
    let technique_id = create_technique(pool, name, description, coach_id).await?;
    add_technique_to_collection(pool, collection_id, technique_id).await?;
    Ok(technique_id)
}

#[instrument]
pub async fn remove_technique_from_collection(
    pool: &Pool<Sqlite>,
    collection_id: i64,
    technique_id: i64,
) -> Result<(), AppError> {
    info!("Removing technique from collection");
    sqlx::query!(
        "DELETE FROM collection_techniques WHERE collection_id = ? AND technique_id = ?",
        collection_id,
        technique_id
    )
    .execute(pool)
    .await?;
    // Detach the technique from any student assignments that were filed under
    // this collection (set collection_id to NULL, preserves the assignment).
    sqlx::query!(
        "UPDATE student_techniques
         SET collection_id = NULL
         WHERE collection_id = ? AND technique_id = ?",
        collection_id,
        technique_id
    )
    .execute(pool)
    .await?;
    Ok(())
}

/// Bulk-assign every technique in a collection to a student. Idempotent:
/// techniques the student already has are moved into this collection
/// (collection_id update), techniques they don't have are inserted. Returns
/// the number of NEW assignments created.
#[instrument]
pub async fn assign_collection_to_student(
    pool: &Pool<Sqlite>,
    student_id: i64,
    collection_id: i64,
) -> Result<usize, AppError> {
    info!("Assigning collection to student");
    let technique_ids: Vec<i64> = sqlx::query_scalar!(
        "SELECT technique_id FROM collection_techniques WHERE collection_id = ? ORDER BY position",
        collection_id
    )
    .fetch_all(pool)
    .await?;

    let before: i64 = sqlx::query_scalar!(
        "SELECT COUNT(*) FROM student_techniques WHERE student_id = ?",
        student_id
    )
    .fetch_one(pool)
    .await?;

    for tid in technique_ids {
        assign_technique_to_student(pool, tid, student_id, Some(collection_id)).await?;
    }

    let after: i64 = sqlx::query_scalar!(
        "SELECT COUNT(*) FROM student_techniques WHERE student_id = ?",
        student_id
    )
    .fetch_one(pool)
    .await?;

    Ok((after - before).max(0) as usize)
}

#[instrument]
pub async fn get_students_with_collection(
    pool: &Pool<Sqlite>,
    collection_id: i64,
) -> Result<Vec<User>, AppError> {
    info!("Listing students with collection");
    let rows = sqlx::query_as!(
        DbUser,
        r#"
        SELECT DISTINCT u.id, u.username, u.role, u.display_name, u.archived,
               u.graduated_at as "graduated_at: chrono::NaiveDateTime",
               u.email,
               u.claimed_at as "claimed_at: chrono::NaiveDateTime",
               u.approved_at as "approved_at: chrono::NaiveDateTime",
               u.first_name, u.last_name,
               u.reset_requested_at as "reset_requested_at: chrono::NaiveDateTime"
        FROM users u
        JOIN student_techniques st ON st.student_id = u.id
        WHERE st.collection_id = ?
        ORDER BY u.display_name, u.username
        "#,
        collection_id
    )
    .fetch_all(pool)
    .await?;
    Ok(rows.into_iter().map(User::from).collect())
}

// ---- Self-registration / approval flow ----

/// Create a self-registered student. Username and password are set;
/// claimed_at is now; approved_at is NULL until a coach approves.
#[instrument(skip(pool, password))]
pub async fn create_self_registered_user(
    pool: &Pool<Sqlite>,
    username: &str,
    password: &str,
    first_name: Option<&str>,
    last_name: Option<&str>,
) -> Result<i64, AppError> {
    info!("Self-registering user");

    let existing = sqlx::query!("SELECT id FROM users WHERE username = ?", username)
        .fetch_optional(pool)
        .await?;
    if existing.is_some() {
        return Err(AppError::Internal("Username already taken".to_string()));
    }

    let hashed = bcrypt::hash(password, bcrypt::DEFAULT_COST)?;
    let display_name = match (first_name, last_name) {
        (Some(f), Some(l)) => format!("{} {}", f, l),
        (Some(f), None) => f.to_string(),
        (None, Some(l)) => l.to_string(),
        (None, None) => username.to_string(),
    };
    let now = Utc::now();

    let res = sqlx::query!(
        "INSERT INTO users
            (username, password, role, display_name, first_name, last_name, claimed_at)
         VALUES (?, ?, 'student', ?, ?, ?, ?)",
        username,
        hashed,
        display_name,
        first_name,
        last_name,
        now
    )
    .execute(pool)
    .await?;

    Ok(res.last_insert_rowid())
}

/// Approve a self-registered user. Idempotent.
#[instrument]
pub async fn approve_user(
    pool: &Pool<Sqlite>,
    user_id: i64,
) -> Result<(), AppError> {
    info!("Approving user");
    let now = Utc::now();
    sqlx::query!(
        "UPDATE users SET approved_at = ? WHERE id = ? AND approved_at IS NULL",
        now,
        user_id
    )
    .execute(pool)
    .await?;
    Ok(())
}

// ---- Invite / claim flow ----

/// Create a "stub" user: no username, no password, just display name and role.
/// Coaches use this to pre-populate a student's record before they claim.
#[instrument]
pub async fn create_user_stub(
    pool: &Pool<Sqlite>,
    display_name: &str,
    email: Option<&str>,
    role: &str,
) -> Result<i64, AppError> {
    info!("Creating stub user");
    // Coach-driven creates are implicitly approved.
    let now = Utc::now();
    let res = sqlx::query!(
        "INSERT INTO users (username, password, display_name, role, email, approved_at)
         VALUES (NULL, '', ?, ?, ?, ?)",
        display_name,
        role,
        email,
        now
    )
    .execute(pool)
    .await?;
    Ok(res.last_insert_rowid())
}

#[derive(Debug, Clone)]
pub struct InviteToken {
    pub id: i64,
    pub user_id: i64,
}

/// Create an invite token tied to a user. Token expires in 7 days. The token
/// value is generated via the same `UserSession::generate_token` used for
/// session cookies.
#[instrument]
pub async fn create_invite_token(
    pool: &Pool<Sqlite>,
    user_id: i64,
) -> Result<String, AppError> {
    info!("Creating invite token");
    let token = crate::auth::UserSession::generate_token();
    let expires_at = (Utc::now() + chrono::Duration::days(7)).naive_utc();

    sqlx::query!(
        "INSERT INTO invite_tokens (user_id, token, expires_at) VALUES (?, ?, ?)",
        user_id,
        token,
        expires_at
    )
    .execute(pool)
    .await?;

    Ok(token)
}

/// Look up an invite token. Returns the row only when it's still valid
/// (not used, not expired). Otherwise returns None.
#[instrument(skip(token))]
pub async fn find_valid_invite_token(
    pool: &Pool<Sqlite>,
    token: &str,
) -> Result<Option<InviteToken>, AppError> {
    let row = sqlx::query!(
        r#"SELECT id, user_id, token, expires_at as "expires_at: chrono::NaiveDateTime",
                  used_at as "used_at?: chrono::NaiveDateTime"
           FROM invite_tokens WHERE token = ?"#,
        token
    )
    .fetch_optional(pool)
    .await?;

    let row = match row {
        Some(r) => r,
        None => return Ok(None),
    };

    if row.used_at.is_some() {
        return Ok(None);
    }
    let now = Utc::now().naive_utc();
    if row.expires_at < now {
        return Ok(None);
    }

    Ok(Some(InviteToken {
        id: row.id.unwrap_or_default(),
        user_id: row.user_id,
    }))
}

/// Atomically claim an invite. Sets the user's username and (bcrypt-hashed)
/// password, marks claimed_at on the user and used_at on the token.
/// Returns the user id on success. Errors if the username is taken.
#[instrument(skip(pool, token, password))]
pub async fn claim_invite(
    pool: &Pool<Sqlite>,
    token: &str,
    username: &str,
    password: &str,
) -> Result<i64, AppError> {
    info!("Claiming invite");

    let invite = find_valid_invite_token(pool, token)
        .await?
        .ok_or_else(|| AppError::NotFound("Invite token not valid".to_string()))?;

    let existing = sqlx::query!(
        "SELECT id FROM users WHERE username = ? AND id != ?",
        username,
        invite.user_id
    )
    .fetch_optional(pool)
    .await?;
    if existing.is_some() {
        return Err(AppError::Internal("Username already taken".to_string()));
    }

    let hashed = bcrypt::hash(password, bcrypt::DEFAULT_COST)?;
    let now = Utc::now();

    // Apply both updates. SQLite single-connection writes are serialized by the
    // pool, so this is effectively atomic for our purposes.
    sqlx::query!(
        "UPDATE users SET username = ?, password = ?, claimed_at = ? WHERE id = ?",
        username,
        hashed,
        now,
        invite.user_id
    )
    .execute(pool)
    .await?;

    sqlx::query!(
        "UPDATE invite_tokens SET used_at = ? WHERE id = ?",
        now,
        invite.id
    )
    .execute(pool)
    .await?;

    Ok(invite.user_id)
}

/// Reset a claimed user back to stub state: clear password, invalidate
/// existing sessions, return a fresh invite token. Username stays so existing
/// references are unaffected, but the user can re-claim with a new password
/// (and optionally change the username again during claim).
#[instrument]
pub async fn reset_user_claim(
    pool: &Pool<Sqlite>,
    user_id: i64,
) -> Result<String, AppError> {
    info!("Resetting user claim");

    // Also clear any standing password-reset request so it stops showing
    // on the coach's dashboard once they've acted on it.
    sqlx::query!(
        "UPDATE users
         SET password = '', claimed_at = NULL, reset_requested_at = NULL
         WHERE id = ?",
        user_id
    )
    .execute(pool)
    .await?;

    // Invalidate any existing sessions for this user.
    sqlx::query!("DELETE FROM user_sessions WHERE user_id = ?", user_id)
        .execute(pool)
        .await?;

    create_invite_token(pool, user_id).await
}

/// Flag a user as having requested a password reset. Silently no-ops if the
/// username doesn't exist (we don't want to leak whether usernames are real
/// to anonymous callers).
#[instrument]
pub async fn request_password_reset(
    pool: &Pool<Sqlite>,
    username: &str,
) -> Result<(), AppError> {
    info!("Recording password reset request");
    let now = Utc::now();
    sqlx::query!(
        "UPDATE users SET reset_requested_at = ? WHERE username = ?",
        now,
        username
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
    pub graduated_at: Option<String>,
    pub email: Option<String>,
    pub claimed_at: Option<String>,
    pub approved_at: Option<String>,
    pub first_name: Option<String>,
    pub last_name: Option<String>,
    pub reset_requested_at: Option<String>,
    pub last_update: Option<String>,
    pub last_coach_update_at: Option<String>,
    pub total_techniques: Option<i64>,
    pub red_count: Option<i64>,
    pub amber_count: Option<i64>,
    pub green_count: Option<i64>,
    pub has_new_student_activity: Option<i64>,
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
            CAST(u.graduated_at AS TEXT) as "graduated_at?: String",
            u.email,
            CAST(u.claimed_at AS TEXT) as "claimed_at?: String",
            CAST(u.approved_at AS TEXT) as "approved_at?: String",
            u.first_name,
            u.last_name,
            CAST(u.reset_requested_at AS TEXT) as "reset_requested_at?: String",
            MAX(st.updated_at) as last_update,
            CAST(MAX(st.last_coach_update_at) AS TEXT) as "last_coach_update_at?: String",
            COUNT(st.id) as total_techniques,
            COALESCE(SUM(CASE WHEN st.status = 'red'   THEN 1 ELSE 0 END), 0) as red_count,
            COALESCE(SUM(CASE WHEN st.status = 'amber' THEN 1 ELSE 0 END), 0) as amber_count,
            COALESCE(SUM(CASE WHEN st.status = 'green' THEN 1 ELSE 0 END), 0) as green_count,
            COALESCE(MAX(
                CASE
                    WHEN st.last_student_update_at IS NULL THEN 0
                    WHEN st.last_coach_update_at IS NULL THEN 1
                    WHEN st.last_student_update_at > st.last_coach_update_at THEN 1
                    ELSE 0
                END
            ), 0) as has_new_student_activity
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
            graduated_at: dto.graduated_at,
            email: dto.email,
            claimed_at: dto.claimed_at,
            approved_at: dto.approved_at,
            first_name: dto.first_name,
            last_name: dto.last_name,
            reset_requested_at: dto.reset_requested_at,
            last_update: dto.last_update,
            last_coach_update_at: dto.last_coach_update_at,
            total_techniques: dto.total_techniques,
            red_count: dto.red_count,
            amber_count: dto.amber_count,
            green_count: dto.green_count,
            has_new_student_activity: dto.has_new_student_activity.map(|v| v != 0),
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
pub async fn count_techniques(pool: &Pool<Sqlite>) -> Result<i64, AppError> {
    let row = sqlx::query!("SELECT COUNT(*) as count FROM techniques")
        .fetch_one(pool)
        .await?;
    Ok(row.count as i64)
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
