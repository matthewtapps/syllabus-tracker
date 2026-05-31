use std::collections::{HashMap, hash_map::Entry};

use crate::{
    auth::{DbUser, DbUserSession, Role, User, UserSession},
    error::AppError,
    models::{DbTag, Tag, naive_to_utc},
};
use chrono::{DateTime, NaiveDateTime, Utc};
use serde::Serialize;
use sqlx::{Pool, Sqlite};
use tracing::{info, instrument};

use crate::models::{
    Attempt, DbStudentTechnique, DbTechnique, DbVideo, ProcessingStatus, StudentTechnique,
    Technique, Video, VideoKind,
};

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
    actor_id: i64,
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

    // Stamp the coach-update timestamps on creation so the assignment itself
    // counts as a coach action — the student sees an "unseen activity" dot
    // until they open it.
    let now = Utc::now().naive_utc();
    let res = sqlx::query!(
        "INSERT INTO student_techniques
     (student_id, student_notes, coach_notes, technique_id, technique_name, technique_description, collection_id, last_coach_update_at, last_coach_update_by_id)
     SELECT ?, '', '', t.id, t.name, t.description, ?, ?, ?
     FROM techniques t WHERE t.id = ?",
        student_id,
        collection_id,
        now,
        actor_id,
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
    viewer_id: i64,
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
               tag.id as "tag_id?: i64", tag.name as "tag_name?: String",
               COALESCE(att.attempt_count, 0) as "attempt_count!: i64",
               att.last_attempt_at as "last_attempt_at?: NaiveDateTime",
               stv.seen_at as "viewer_seen_at?: NaiveDateTime"
        FROM student_techniques st
        LEFT JOIN users cu ON st.last_coach_update_by_id = cu.id
        LEFT JOIN users su ON st.last_student_update_by_id = su.id
        LEFT JOIN collections coll ON st.collection_id = coll.id
        LEFT JOIN technique_tags tt ON st.technique_id = tt.technique_id
        LEFT JOIN tags tag ON tt.tag_id = tag.id
        LEFT JOIN (
            SELECT student_technique_id,
                   COUNT(*) AS attempt_count,
                   MAX(attempted_at) AS last_attempt_at
            FROM attempts
            GROUP BY student_technique_id
        ) att ON att.student_technique_id = st.id
        LEFT JOIN student_technique_views stv
               ON stv.student_technique_id = st.id AND stv.user_id = ?
        WHERE st.student_id = ?
        ORDER BY st.updated_at DESC
        "#,
        viewer_id,
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
                attempt_count: row.attempt_count,
                last_attempt_at: row.last_attempt_at.map(naive_to_utc),
                viewer_seen_at: row.viewer_seen_at.map(naive_to_utc),
            };
            e.insert(technique);
        }

        if let (Some(tag_id), Some(tag_name)) = (row.tag_id, row.tag_name) {
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
    viewer_id: i64,
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

    let agg = sqlx::query!(
        r#"SELECT COUNT(*) as "count!: i64",
                  MAX(attempted_at) as "last?: NaiveDateTime"
           FROM attempts
           WHERE student_technique_id = ?"#,
        student_technique_id
    )
    .fetch_one(pool)
    .await?;
    technique.attempt_count = agg.count;
    technique.last_attempt_at = agg.last.map(naive_to_utc);

    let seen = sqlx::query!(
        r#"SELECT seen_at as "seen_at?: NaiveDateTime"
           FROM student_technique_views
           WHERE student_technique_id = ? AND user_id = ?"#,
        student_technique_id,
        viewer_id
    )
    .fetch_optional(pool)
    .await?;
    technique.viewer_seen_at = seen.and_then(|r| r.seen_at).map(naive_to_utc);

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
    actor_id: i64,
) -> Result<(), AppError> {
    info!("Adding techniques to student");
    for technique_id in technique_ids {
        assign_technique_to_student(pool, technique_id, student_id, collection_id, actor_id)
            .await?;
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

    assign_technique_to_student(pool, technique_id, student_id, collection_id, coach_id).await?;

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
                    has_unseen_activity: None,
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

/// Upsert the `seen_at` for `(student_technique_id, user_id)` to NOW. Used by
/// the row-expand "mark seen" interaction to clear the unseen-activity dot
/// for the viewer.
#[instrument(skip(pool))]
pub async fn mark_student_technique_seen(
    pool: &Pool<Sqlite>,
    student_technique_id: i64,
    user_id: i64,
) -> Result<(), AppError> {
    let now = Utc::now().naive_utc();
    sqlx::query!(
        "INSERT INTO student_technique_views (student_technique_id, user_id, seen_at)
         VALUES (?, ?, ?)
         ON CONFLICT(student_technique_id, user_id)
         DO UPDATE SET seen_at = excluded.seen_at",
        student_technique_id,
        user_id,
        now
    )
    .execute(pool)
    .await?;
    Ok(())
}

/// Idempotently backfill `student_technique_views` so existing rows do not
/// suddenly light up with dots for every viewer when the per-viewer "unseen
/// activity" feature ships. Safe to re-run on every boot: `INSERT OR IGNORE`
/// leaves rows added by live traffic untouched.
#[instrument(skip(pool))]
pub async fn backfill_student_technique_views(pool: &Pool<Sqlite>) -> Result<(), AppError> {
    info!("Backfilling student_technique_views");

    sqlx::query!(
        "INSERT OR IGNORE INTO student_technique_views (student_technique_id, user_id, seen_at)
         SELECT st.id, st.student_id,
                COALESCE(MAX(st.last_coach_update_at, st.last_student_update_at, st.created_at),
                         CURRENT_TIMESTAMP)
         FROM   student_techniques st
         WHERE  st.student_id IS NOT NULL"
    )
    .execute(pool)
    .await?;

    sqlx::query!(
        "INSERT OR IGNORE INTO student_technique_views (student_technique_id, user_id, seen_at)
         SELECT st.id, u.id,
                COALESCE(MAX(st.last_coach_update_at, st.last_student_update_at, st.created_at),
                         CURRENT_TIMESTAMP)
         FROM   student_techniques st
         CROSS JOIN users u
         WHERE  u.role IN ('coach', 'admin')"
    )
    .execute(pool)
    .await?;

    Ok(())
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
    actor_id: i64,
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
        assign_technique_to_student(pool, tid, student_id, Some(collection_id), actor_id).await?;
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
    pub has_unseen_activity: Option<i64>,
}

#[instrument(skip(pool))]
pub async fn get_students_by_recent_updates(
    pool: &Pool<Sqlite>,
    include_archived: bool,
    viewer_id: i64,
) -> Result<Vec<User>, AppError> {
    // Aggregate flag: does this student have any student_technique where the
    // student has touched it since the viewing coach last looked? `stv.seen_at`
    // is null for rows the viewer has never opened, so MAX(...) of a NULL
    // becomes a "yes" via the first WHEN branch.
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
                    WHEN stv.seen_at IS NULL THEN 1
                    WHEN st.last_student_update_at > stv.seen_at THEN 1
                    ELSE 0
                END
            ), 0) as has_unseen_activity
        FROM users u
        LEFT JOIN student_techniques st ON u.id = st.student_id
        LEFT JOIN student_technique_views stv
               ON stv.student_technique_id = st.id AND stv.user_id = ?
        WHERE u.role = 'student'
        GROUP BY u.id
        ORDER BY last_update DESC NULLS LAST
        "#,
        viewer_id
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
            has_unseen_activity: dto.has_unseen_activity.map(|v| v != 0),
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

// ---- Attempts ----

/// What the UI should suggest after a successful attempt log. Only the
/// transition from zero attempts on a red technique surfaces a nudge; all
/// other cases are silent.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum AttemptSuggestion {
    None,
    Amber,
}

#[derive(Debug, Clone, Serialize)]
pub struct AttemptCreateResult {
    pub attempt: Attempt,
    pub suggestion: AttemptSuggestion,
}

#[derive(Debug, Clone, Serialize)]
pub struct AttemptListItem {
    pub id: i64,
    pub student_technique_id: i64,
    pub technique_id: i64,
    pub technique_name: String,
    pub attempted_at: chrono::DateTime<Utc>,
    pub coach_note: Option<String>,
    pub student_note: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct AttemptSummary {
    pub this_week: i64,
    pub this_month: i64,
    pub total: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct AttemptBucket {
    pub date: chrono::NaiveDate,
    pub count: i64,
}

#[allow(clippy::too_many_arguments)]
fn hydrate_attempt_row(
    id: i64,
    student_technique_id: i64,
    recorded_by_id: i64,
    recorded_by_name: Option<String>,
    attempted_at: NaiveDateTime,
    coach_note: Option<String>,
    coach_note_by_id: Option<i64>,
    coach_note_by_name: Option<String>,
    coach_note_at: Option<NaiveDateTime>,
    student_note: Option<String>,
    student_note_at: Option<NaiveDateTime>,
    created_at: NaiveDateTime,
) -> Attempt {
    Attempt {
        id,
        student_technique_id,
        recorded_by_id,
        recorded_by_name,
        attempted_at: naive_to_utc(attempted_at),
        coach_note,
        coach_note_by_id,
        coach_note_by_name,
        coach_note_at: coach_note_at.map(naive_to_utc),
        student_note,
        student_note_at: student_note_at.map(naive_to_utc),
        created_at: naive_to_utc(created_at),
    }
}

fn prefer_display_name(display: Option<String>, username: Option<String>) -> Option<String> {
    display.filter(|s| !s.is_empty()).or(username)
}

/// Bump the parent student_technique's activity timestamps to "now" using
/// the actor's role to pick the right slot. Mirrors how note edits via
/// `update_student_technique` track activity.
async fn bump_student_technique_activity(
    tx: &mut sqlx::Transaction<'_, Sqlite>,
    student_technique_id: i64,
    actor: &User,
) -> Result<(), AppError> {
    let now = Utc::now().naive_utc();
    let actor_id = actor.id;
    match actor.role {
        Role::Coach | Role::Admin => {
            sqlx::query!(
                "UPDATE student_techniques
                 SET updated_at = ?,
                     last_coach_update_at = ?,
                     last_coach_update_by_id = ?
                 WHERE id = ?",
                now,
                now,
                actor_id,
                student_technique_id,
            )
            .execute(&mut **tx)
            .await?;
        }
        Role::Student => {
            sqlx::query!(
                "UPDATE student_techniques
                 SET updated_at = ?,
                     last_student_update_at = ?,
                     last_student_update_by_id = ?
                 WHERE id = ?",
                now,
                now,
                actor_id,
                student_technique_id,
            )
            .execute(&mut **tx)
            .await?;
        }
    }
    Ok(())
}

/// Authorise an actor to read/append attempts for a given student technique.
/// Coach/admin can act on anyone; a student can only act on their own.
async fn ensure_can_access_student_technique(
    pool: &Pool<Sqlite>,
    actor: &User,
    student_technique_id: i64,
) -> Result<i64, AppError> {
    let row = sqlx::query!(
        "SELECT student_id FROM student_techniques WHERE id = ?",
        student_technique_id
    )
    .fetch_optional(pool)
    .await?;

    let student_id = row
        .and_then(|r| r.student_id)
        .ok_or_else(|| AppError::NotFound(format!("student_technique {}", student_technique_id)))?;

    match actor.role {
        Role::Coach | Role::Admin => Ok(student_id),
        Role::Student => {
            if actor.id == student_id {
                Ok(student_id)
            } else {
                Err(AppError::Authorization(
                    "Cannot access this student technique".into(),
                ))
            }
        }
    }
}

#[instrument(skip(actor))]
pub async fn create_attempt(
    pool: &Pool<Sqlite>,
    actor: &User,
    student_technique_id: i64,
    attempted_at: chrono::DateTime<Utc>,
    note: Option<&str>,
) -> Result<AttemptCreateResult, AppError> {
    info!("Creating attempt");

    ensure_can_access_student_technique(pool, actor, student_technique_id).await?;

    let mut tx = pool.begin().await?;

    // Read current status + existing attempt count for the suggestion.
    let pre = sqlx::query!(
        r#"SELECT st.status, COUNT(a.id) as "attempt_count!: i64"
           FROM student_techniques st
           LEFT JOIN attempts a ON a.student_technique_id = st.id
           WHERE st.id = ?
           GROUP BY st.id"#,
        student_technique_id
    )
    .fetch_optional(&mut *tx)
    .await?;

    let (status, prior_count) = match pre {
        Some(row) => (row.status.unwrap_or_default(), row.attempt_count),
        None => {
            return Err(AppError::NotFound(format!(
                "student_technique {}",
                student_technique_id
            )));
        }
    };

    let actor_id = actor.id;
    let attempted_naive = attempted_at.naive_utc();
    let note_owned = note.map(|n| n.to_string());

    let (coach_note, coach_note_by, coach_note_at, student_note, student_note_at) =
        match actor.role {
            Role::Coach | Role::Admin => (
                note_owned.clone(),
                note_owned.as_ref().map(|_| actor_id),
                note_owned.as_ref().map(|_| attempted_naive),
                None,
                None,
            ),
            Role::Student => (
                None,
                None,
                None,
                note_owned.clone(),
                note_owned.as_ref().map(|_| attempted_naive),
            ),
        };

    let res = sqlx::query!(
        "INSERT INTO attempts (
            student_technique_id, recorded_by_id, attempted_at,
            coach_note, coach_note_by_id, coach_note_at,
            student_note, student_note_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        student_technique_id,
        actor_id,
        attempted_naive,
        coach_note,
        coach_note_by,
        coach_note_at,
        student_note,
        student_note_at,
    )
    .execute(&mut *tx)
    .await?;

    let id = res.last_insert_rowid();

    // Bump the parent student_technique's activity timestamps so this attempt
    // surfaces in the "recently updated" dashboard sections. The bump reflects
    // when the attempt was logged (now), not the (possibly backdated)
    // attempted_at value.
    bump_student_technique_activity(&mut tx, student_technique_id, actor).await?;

    tx.commit().await?;

    let attempt = get_attempt(pool, id).await?;

    let suggestion = if prior_count == 0 && status == "red" {
        AttemptSuggestion::Amber
    } else {
        AttemptSuggestion::None
    };

    Ok(AttemptCreateResult {
        attempt,
        suggestion,
    })
}

#[instrument]
pub async fn get_attempt(pool: &Pool<Sqlite>, attempt_id: i64) -> Result<Attempt, AppError> {
    let row = sqlx::query!(
        r#"SELECT a.id as "id!: i64", a.student_technique_id as "student_technique_id!: i64",
                  a.recorded_by_id as "recorded_by_id!: i64",
                  rec.display_name as "rec_display?: String", rec.username as "rec_username?: String",
                  a.attempted_at as "attempted_at!: NaiveDateTime",
                  a.coach_note, a.coach_note_by_id,
                  cnb.display_name as "cn_display?: String", cnb.username as "cn_username?: String",
                  a.coach_note_at as "coach_note_at?: NaiveDateTime",
                  a.student_note, a.student_note_at as "student_note_at?: NaiveDateTime",
                  a.created_at as "created_at!: NaiveDateTime"
           FROM attempts a
           LEFT JOIN users rec ON rec.id = a.recorded_by_id
           LEFT JOIN users cnb ON cnb.id = a.coach_note_by_id
           WHERE a.id = ?"#,
        attempt_id
    )
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("attempt {}", attempt_id)))?;

    Ok(hydrate_attempt_row(
        row.id,
        row.student_technique_id,
        row.recorded_by_id,
        prefer_display_name(row.rec_display, row.rec_username),
        row.attempted_at,
        row.coach_note,
        row.coach_note_by_id,
        prefer_display_name(row.cn_display, row.cn_username),
        row.coach_note_at,
        row.student_note,
        row.student_note_at,
        row.created_at,
    ))
}

#[instrument]
pub async fn list_attempts(
    pool: &Pool<Sqlite>,
    student_technique_id: i64,
) -> Result<Vec<Attempt>, AppError> {
    let rows = sqlx::query!(
        r#"SELECT a.id as "id!: i64", a.student_technique_id as "student_technique_id!: i64",
                  a.recorded_by_id as "recorded_by_id!: i64",
                  rec.display_name as "rec_display?: String", rec.username as "rec_username?: String",
                  a.attempted_at as "attempted_at!: NaiveDateTime",
                  a.coach_note, a.coach_note_by_id,
                  cnb.display_name as "cn_display?: String", cnb.username as "cn_username?: String",
                  a.coach_note_at as "coach_note_at?: NaiveDateTime",
                  a.student_note, a.student_note_at as "student_note_at?: NaiveDateTime",
                  a.created_at as "created_at!: NaiveDateTime"
           FROM attempts a
           LEFT JOIN users rec ON rec.id = a.recorded_by_id
           LEFT JOIN users cnb ON cnb.id = a.coach_note_by_id
           WHERE a.student_technique_id = ?
           ORDER BY a.attempted_at DESC, a.id DESC"#,
        student_technique_id,
    )
    .fetch_all(pool)
    .await?;

    Ok(rows
        .into_iter()
        .map(|row| {
            hydrate_attempt_row(
                row.id,
                row.student_technique_id,
                row.recorded_by_id,
                prefer_display_name(row.rec_display, row.rec_username),
                row.attempted_at,
                row.coach_note,
                row.coach_note_by_id,
                prefer_display_name(row.cn_display, row.cn_username),
                row.coach_note_at,
                row.student_note,
                row.student_note_at,
                row.created_at,
            )
        })
        .collect())
}

#[instrument]
pub async fn list_recent_attempts_for_student(
    pool: &Pool<Sqlite>,
    student_id: i64,
    limit: i64,
) -> Result<Vec<AttemptListItem>, AppError> {
    let rows = sqlx::query!(
        r#"SELECT a.id as "id!: i64",
                  a.student_technique_id as "student_technique_id!: i64",
                  st.technique_id as "technique_id!: i64",
                  st.technique_name as "technique_name: String",
                  a.attempted_at as "attempted_at!: NaiveDateTime",
                  a.coach_note, a.student_note
           FROM attempts a
           JOIN student_techniques st ON st.id = a.student_technique_id
           WHERE st.student_id = ?
           ORDER BY a.attempted_at DESC, a.id DESC
           LIMIT ?"#,
        student_id,
        limit,
    )
    .fetch_all(pool)
    .await?;

    Ok(rows
        .into_iter()
        .map(|row| AttemptListItem {
            id: row.id,
            student_technique_id: row.student_technique_id,
            technique_id: row.technique_id,
            technique_name: row.technique_name.unwrap_or_default(),
            attempted_at: naive_to_utc(row.attempted_at),
            coach_note: row.coach_note,
            student_note: row.student_note,
        })
        .collect())
}

#[instrument(skip(actor))]
pub async fn delete_attempt(
    pool: &Pool<Sqlite>,
    actor: &User,
    attempt_id: i64,
) -> Result<(), AppError> {
    let row = sqlx::query!(
        "SELECT recorded_by_id, student_technique_id FROM attempts WHERE id = ?",
        attempt_id
    )
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("attempt {}", attempt_id)))?;

    // Coach/admin can delete any attempt on a student technique they can access.
    // Student can only delete attempts they recorded themselves.
    match actor.role {
        Role::Coach | Role::Admin => {
            ensure_can_access_student_technique(pool, actor, row.student_technique_id).await?;
        }
        Role::Student => {
            ensure_can_access_student_technique(pool, actor, row.student_technique_id).await?;
            if row.recorded_by_id != actor.id {
                return Err(AppError::Authorization(
                    "Students can only remove their own attempts".into(),
                ));
            }
        }
    }

    sqlx::query!("DELETE FROM attempts WHERE id = ?", attempt_id)
        .execute(pool)
        .await?;

    Ok(())
}

#[instrument(skip(actor))]
pub async fn update_attempt_note(
    pool: &Pool<Sqlite>,
    actor: &User,
    attempt_id: i64,
    note: Option<&str>,
) -> Result<(), AppError> {
    let row = sqlx::query!(
        "SELECT student_technique_id FROM attempts WHERE id = ?",
        attempt_id
    )
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("attempt {}", attempt_id)))?;

    ensure_can_access_student_technique(pool, actor, row.student_technique_id).await?;

    let now = Utc::now();
    let actor_id = actor.id;
    // Empty string clears the note.
    let normalised: Option<String> = note
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());

    let mut tx = pool.begin().await?;
    match actor.role {
        Role::Coach | Role::Admin => {
            let stamp = normalised.as_ref().map(|_| now.naive_utc());
            let by_id = normalised.as_ref().map(|_| actor_id);
            sqlx::query!(
                "UPDATE attempts
                 SET coach_note = ?, coach_note_by_id = ?, coach_note_at = ?
                 WHERE id = ?",
                normalised,
                by_id,
                stamp,
                attempt_id
            )
            .execute(&mut *tx)
            .await?;
        }
        Role::Student => {
            let stamp = normalised.as_ref().map(|_| now.naive_utc());
            sqlx::query!(
                "UPDATE attempts
                 SET student_note = ?, student_note_at = ?
                 WHERE id = ?",
                normalised,
                stamp,
                attempt_id
            )
            .execute(&mut *tx)
            .await?;
        }
    }

    // Editing or adding a note is meaningful activity on the technique, so
    // surface it in the dashboard's "recently updated" view too.
    bump_student_technique_activity(&mut tx, row.student_technique_id, actor).await?;
    tx.commit().await?;

    Ok(())
}

#[instrument(skip(actor))]
pub async fn update_attempt_timestamp(
    pool: &Pool<Sqlite>,
    actor: &User,
    attempt_id: i64,
    attempted_at: chrono::DateTime<Utc>,
) -> Result<(), AppError> {
    let row = sqlx::query!(
        "SELECT recorded_by_id, student_technique_id FROM attempts WHERE id = ?",
        attempt_id
    )
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("attempt {}", attempt_id)))?;

    match actor.role {
        Role::Coach | Role::Admin => {
            ensure_can_access_student_technique(pool, actor, row.student_technique_id).await?;
        }
        Role::Student => {
            ensure_can_access_student_technique(pool, actor, row.student_technique_id).await?;
            if row.recorded_by_id != actor.id {
                return Err(AppError::Authorization(
                    "Students can only edit their own attempts".into(),
                ));
            }
        }
    }

    let stamp = attempted_at.naive_utc();
    sqlx::query!(
        "UPDATE attempts SET attempted_at = ? WHERE id = ?",
        stamp,
        attempt_id
    )
    .execute(pool)
    .await?;

    Ok(())
}

#[instrument]
pub async fn attempt_summary_for_student(
    pool: &Pool<Sqlite>,
    student_id: i64,
) -> Result<AttemptSummary, AppError> {
    // Use SQLite's date arithmetic so "this week" / "this month" line up with
    // the server clock without juggling timezones in Rust.
    let row = sqlx::query!(
        r#"SELECT
            COUNT(*) as "total!: i64",
            SUM(CASE WHEN a.attempted_at >= datetime('now', '-7 days') THEN 1 ELSE 0 END) as "this_week!: i64",
            SUM(CASE WHEN a.attempted_at >= datetime('now', '-30 days') THEN 1 ELSE 0 END) as "this_month!: i64"
           FROM attempts a
           JOIN student_techniques st ON st.id = a.student_technique_id
           WHERE st.student_id = ?"#,
        student_id
    )
    .fetch_one(pool)
    .await?;

    Ok(AttemptSummary {
        this_week: row.this_week,
        this_month: row.this_month,
        total: row.total,
    })
}

#[instrument]
pub async fn attempt_buckets_for_student(
    pool: &Pool<Sqlite>,
    student_id: i64,
    from: chrono::NaiveDate,
    to: chrono::NaiveDate,
) -> Result<Vec<AttemptBucket>, AppError> {
    let from_str = from.format("%Y-%m-%d").to_string();
    let to_str = to.format("%Y-%m-%d").to_string();
    let rows = sqlx::query!(
        r#"SELECT date(a.attempted_at) as "date!: String",
                  COUNT(*) as "count!: i64"
           FROM attempts a
           JOIN student_techniques st ON st.id = a.student_technique_id
           WHERE st.student_id = ?
             AND date(a.attempted_at) >= ?
             AND date(a.attempted_at) <= ?
           GROUP BY date(a.attempted_at)
           ORDER BY 1"#,
        student_id,
        from_str,
        to_str,
    )
    .fetch_all(pool)
    .await?;

    Ok(rows
        .into_iter()
        .filter_map(|r| {
            chrono::NaiveDate::parse_from_str(&r.date, "%Y-%m-%d")
                .ok()
                .map(|date| AttemptBucket {
                    date,
                    count: r.count,
                })
        })
        .collect())
}

#[instrument]
pub async fn attempt_weekly_buckets_for_technique(
    pool: &Pool<Sqlite>,
    student_technique_id: i64,
    weeks: i64,
) -> Result<Vec<AttemptBucket>, AppError> {
    // Bucket by ISO week (year-week). We resolve buckets to the Monday of each
    // week so the frontend can lay them out on a timeline.
    let start_clause = format!("-{} days", weeks * 7);
    let rows = sqlx::query!(
        r#"SELECT date(a.attempted_at, 'weekday 0', '-6 days') as "week_start!: String",
                  COUNT(*) as "count!: i64"
           FROM attempts a
           WHERE a.student_technique_id = ?
             AND a.attempted_at >= datetime('now', ?)
           GROUP BY date(a.attempted_at, 'weekday 0', '-6 days')
           ORDER BY 1"#,
        student_technique_id,
        start_clause,
    )
    .fetch_all(pool)
    .await?;

    Ok(rows
        .into_iter()
        .filter_map(|r| {
            chrono::NaiveDate::parse_from_str(&r.week_start, "%Y-%m-%d")
                .ok()
                .map(|date| AttemptBucket {
                    date,
                    count: r.count,
                })
        })
        .collect())
}

#[instrument(skip(pool))]
pub async fn next_video_position(pool: &Pool<Sqlite>, technique_id: i64) -> Result<i64, AppError> {
    let row = sqlx::query!(
        "SELECT COALESCE(MAX(position), -1) AS max_position
         FROM videos
         WHERE technique_id = ?",
        technique_id
    )
    .fetch_one(pool)
    .await?;
    Ok(row.max_position + 1)
}

#[instrument(skip(pool))]
pub async fn create_processing_video(
    pool: &Pool<Sqlite>,
    technique_id: i64,
    title: &str,
    description: Option<&str>,
    uploaded_by_id: i64,
) -> Result<i64, AppError> {
    info!("Creating processing video");
    let position = next_video_position(pool, technique_id).await?;
    let kind = VideoKind::Native.as_str();
    let status = ProcessingStatus::Processing.as_str();
    let res = sqlx::query!(
        "INSERT INTO videos (
            technique_id, title, description, position, kind, processing_status,
            uploaded_by_id
         ) VALUES (?, ?, ?, ?, ?, ?, ?)",
        technique_id,
        title,
        description,
        position,
        kind,
        status,
        uploaded_by_id,
    )
    .execute(pool)
    .await?;
    Ok(res.last_insert_rowid())
}

pub struct NewExternalVideo<'a> {
    pub technique_id: i64,
    pub title: &'a str,
    pub description: Option<&'a str>,
    pub uploaded_by_id: i64,
    pub kind: VideoKind,
    pub external_url: &'a str,
    pub external_host: Option<&'a str>,
    pub external_video_id: Option<&'a str>,
}

#[instrument(skip(pool, input), fields(technique_id = input.technique_id))]
pub async fn create_external_video(
    pool: &Pool<Sqlite>,
    input: NewExternalVideo<'_>,
) -> Result<i64, AppError> {
    info!("Creating external video");
    let position = next_video_position(pool, input.technique_id).await?;
    let kind_str = input.kind.as_str();
    let status = ProcessingStatus::Ready.as_str();
    let res = sqlx::query!(
        "INSERT INTO videos (
            technique_id, title, description, position, kind, processing_status,
            external_url, external_host, external_video_id, uploaded_by_id
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        input.technique_id,
        input.title,
        input.description,
        position,
        kind_str,
        status,
        input.external_url,
        input.external_host,
        input.external_video_id,
        input.uploaded_by_id,
    )
    .execute(pool)
    .await?;
    Ok(res.last_insert_rowid())
}

#[instrument(skip(pool))]
pub async fn finalize_video_ready(
    pool: &Pool<Sqlite>,
    id: i64,
    storage_key: &str,
    bytes: i64,
    duration_seconds: i64,
    width: Option<i64>,
    height: Option<i64>,
) -> Result<(), AppError> {
    let status = ProcessingStatus::Ready.as_str();
    let now = Utc::now();
    sqlx::query!(
        "UPDATE videos
         SET processing_status = ?,
             processing_error = NULL,
             storage_key = ?,
             bytes = ?,
             duration_seconds = ?,
             width = ?,
             height = ?,
             updated_at = ?
         WHERE id = ?",
        status,
        storage_key,
        bytes,
        duration_seconds,
        width,
        height,
        now,
        id,
    )
    .execute(pool)
    .await?;
    Ok(())
}

#[instrument(skip(pool))]
pub async fn mark_video_failed(
    pool: &Pool<Sqlite>,
    id: i64,
    error: &str,
) -> Result<(), AppError> {
    let status = ProcessingStatus::Failed.as_str();
    let now = Utc::now();
    sqlx::query!(
        "UPDATE videos
         SET processing_status = ?, processing_error = ?, updated_at = ?
         WHERE id = ?",
        status,
        error,
        now,
        id,
    )
    .execute(pool)
    .await?;
    Ok(())
}

#[instrument(skip(pool))]
pub async fn get_db_video(pool: &Pool<Sqlite>, id: i64) -> Result<Option<DbVideo>, AppError> {
    let row = sqlx::query_as!(
        DbVideo,
        "SELECT id, technique_id, title, description, position, kind,
                processing_status, processing_error, storage_key, bytes,
                duration_seconds, width, height,
                external_url, external_host, external_video_id, uploaded_by_id,
                created_at, updated_at
         FROM videos
         WHERE id = ?",
        id
    )
    .fetch_optional(pool)
    .await?;
    Ok(row)
}

#[instrument(skip(pool))]
pub async fn get_video(pool: &Pool<Sqlite>, id: i64) -> Result<Option<Video>, AppError> {
    Ok(get_db_video(pool, id).await?.map(Video::from))
}

#[instrument(skip(pool))]
pub async fn list_videos_for_technique(
    pool: &Pool<Sqlite>,
    technique_id: i64,
) -> Result<Vec<Video>, AppError> {
    let rows = sqlx::query_as!(
        DbVideo,
        "SELECT id, technique_id, title, description, position, kind,
                processing_status, processing_error, storage_key, bytes,
                duration_seconds, width, height,
                external_url, external_host, external_video_id, uploaded_by_id,
                created_at, updated_at
         FROM videos
         WHERE technique_id = ?
         ORDER BY position ASC, id ASC",
        technique_id
    )
    .fetch_all(pool)
    .await?;
    Ok(rows.into_iter().map(Video::from).collect())
}

#[instrument(skip(pool))]
pub async fn update_video_metadata(
    pool: &Pool<Sqlite>,
    id: i64,
    title: Option<&str>,
    description: Option<Option<&str>>,
    position: Option<i64>,
) -> Result<(), AppError> {
    let now = Utc::now();
    if let Some(title) = title {
        sqlx::query!("UPDATE videos SET title = ?, updated_at = ? WHERE id = ?", title, now, id)
            .execute(pool)
            .await?;
    }
    if let Some(description) = description {
        sqlx::query!(
            "UPDATE videos SET description = ?, updated_at = ? WHERE id = ?",
            description,
            now,
            id,
        )
        .execute(pool)
        .await?;
    }
    if let Some(position) = position {
        sqlx::query!(
            "UPDATE videos SET position = ?, updated_at = ? WHERE id = ?",
            position,
            now,
            id,
        )
        .execute(pool)
        .await?;
    }
    Ok(())
}

#[instrument(skip(pool))]
pub async fn reorder_videos(
    pool: &Pool<Sqlite>,
    technique_id: i64,
    ordered_ids: &[i64],
) -> Result<(), AppError> {
    let mut tx = pool.begin().await?;
    let now = Utc::now();
    for (index, video_id) in ordered_ids.iter().enumerate() {
        let position = index as i64;
        sqlx::query!(
            "UPDATE videos
             SET position = ?, updated_at = ?
             WHERE id = ? AND technique_id = ?",
            position,
            now,
            video_id,
            technique_id,
        )
        .execute(&mut *tx)
        .await?;
    }
    tx.commit().await?;
    Ok(())
}

#[instrument(skip(pool))]
pub async fn delete_video(pool: &Pool<Sqlite>, id: i64) -> Result<Option<String>, AppError> {
    let row = sqlx::query!("SELECT storage_key FROM videos WHERE id = ?", id)
        .fetch_optional(pool)
        .await?;
    let storage_key = row.and_then(|r| r.storage_key);
    sqlx::query!("DELETE FROM videos WHERE id = ?", id)
        .execute(pool)
        .await?;
    Ok(storage_key)
}

#[instrument(skip(pool))]
pub async fn reset_video_to_processing(
    pool: &Pool<Sqlite>,
    id: i64,
) -> Result<(), AppError> {
    let status = ProcessingStatus::Processing.as_str();
    let kind = VideoKind::Native.as_str();
    let now = Utc::now();
    sqlx::query!(
        "UPDATE videos
         SET processing_status = ?,
             processing_error = NULL,
             kind = ?,
             external_url = NULL,
             external_host = NULL,
             external_video_id = NULL,
             updated_at = ?
         WHERE id = ?",
        status,
        kind,
        now,
        id,
    )
    .execute(pool)
    .await?;
    Ok(())
}

#[instrument(skip(pool))]
pub async fn clear_video_watch_state(pool: &Pool<Sqlite>, video_id: i64) -> Result<(), AppError> {
    let mut tx = pool.begin().await?;
    sqlx::query!("DELETE FROM video_watch_events WHERE video_id = ?", video_id)
        .execute(&mut *tx)
        .await?;
    sqlx::query!("DELETE FROM video_watch_aggregates WHERE video_id = ?", video_id)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(())
}

#[instrument(skip(pool))]
pub async fn total_video_storage_bytes(pool: &Pool<Sqlite>) -> Result<i64, AppError> {
    let row = sqlx::query!(
        "SELECT COALESCE(SUM(bytes), 0) AS total
         FROM videos
         WHERE storage_key IS NOT NULL"
    )
    .fetch_one(pool)
    .await?;
    Ok(row.total)
}

#[instrument(skip(pool))]
pub async fn total_video_objects(pool: &Pool<Sqlite>) -> Result<i64, AppError> {
    let row = sqlx::query!(
        "SELECT COUNT(*) AS count
         FROM videos
         WHERE storage_key IS NOT NULL"
    )
    .fetch_one(pool)
    .await?;
    Ok(row.count)
}

#[derive(Debug, Clone)]
pub struct WatchEventInput {
    pub event: String,
    pub seconds_watched: Option<i64>,
}

#[instrument(skip(pool, events))]
pub async fn ingest_watch_events(
    pool: &Pool<Sqlite>,
    video_id: i64,
    user_id: i64,
    play_id: &str,
    events: &[WatchEventInput],
) -> Result<(), AppError> {
    if events.is_empty() {
        return Ok(());
    }
    let mut tx = pool.begin().await?;

    // Compute deltas against state BEFORE inserting this batch so we don't
    // double-count the batch's own events as prior state.
    let prior_started = sqlx::query!(
        "SELECT COUNT(*) AS count
         FROM video_watch_events
         WHERE video_id = ? AND user_id = ? AND play_id = ? AND event = 'started'",
        video_id,
        user_id,
        play_id,
    )
    .fetch_one(&mut *tx)
    .await?
    .count;
    let prior_completed = sqlx::query!(
        "SELECT COUNT(*) AS count
         FROM video_watch_events
         WHERE video_id = ? AND user_id = ? AND play_id = ? AND event = 'completed'",
        video_id,
        user_id,
        play_id,
    )
    .fetch_one(&mut *tx)
    .await?
    .count;
    let prior_max_seconds = sqlx::query!(
        "SELECT COALESCE(MAX(seconds_watched), 0) AS prior_max
         FROM video_watch_events
         WHERE video_id = ? AND user_id = ? AND play_id = ?
           AND seconds_watched IS NOT NULL",
        video_id,
        user_id,
        play_id,
    )
    .fetch_one(&mut *tx)
    .await?
    .prior_max;

    let has_new_play =
        prior_started == 0 && events.iter().any(|e| e.event == "started");
    let has_new_completed =
        prior_completed == 0 && events.iter().any(|e| e.event == "completed");
    let batch_max_seconds = events
        .iter()
        .filter_map(|e| e.seconds_watched)
        .max()
        .unwrap_or(0);
    let seconds_delta = if batch_max_seconds > prior_max_seconds {
        batch_max_seconds - prior_max_seconds
    } else {
        0
    };

    // Persist raw event rows. Duplicates are allowed; the prior-state checks
    // above already deduped what matters for the aggregate.
    for input in events {
        sqlx::query!(
            "INSERT INTO video_watch_events
                (video_id, user_id, event, seconds_watched, play_id)
             VALUES (?, ?, ?, ?, ?)",
            video_id,
            user_id,
            input.event,
            input.seconds_watched,
            play_id,
        )
        .execute(&mut *tx)
        .await?;
    }

    let now = Utc::now();
    let play_increment: i64 = if has_new_play { 1 } else { 0 };
    let completed_increment: i64 = if has_new_completed { 1 } else { 0 };
    sqlx::query!(
        "INSERT INTO video_watch_aggregates
            (video_id, user_id, play_count, completed_count, total_seconds_watched,
             first_watched_at, last_watched_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (video_id, user_id) DO UPDATE SET
             play_count = play_count + excluded.play_count,
             completed_count = completed_count + excluded.completed_count,
             total_seconds_watched = total_seconds_watched + excluded.total_seconds_watched,
             first_watched_at = COALESCE(first_watched_at, excluded.first_watched_at),
             last_watched_at = excluded.last_watched_at",
        video_id,
        user_id,
        play_increment,
        completed_increment,
        seconds_delta,
        now,
        now,
    )
    .execute(&mut *tx)
    .await?;

    tx.commit().await?;
    Ok(())
}

#[derive(Debug, Clone, Serialize)]
pub struct WatchAggregateRow {
    pub play_count: i64,
    pub completed_count: i64,
    pub total_seconds_watched: i64,
}

#[instrument(skip(pool))]
pub async fn get_my_watch_state(
    pool: &Pool<Sqlite>,
    user_id: i64,
    video_ids: &[i64],
) -> Result<HashMap<i64, WatchAggregateRow>, AppError> {
    let mut result = HashMap::new();
    if video_ids.is_empty() {
        return Ok(result);
    }
    let placeholders = vec!["?"; video_ids.len()].join(",");
    let query = format!(
        "SELECT video_id, play_count, completed_count, total_seconds_watched
         FROM video_watch_aggregates
         WHERE user_id = ? AND video_id IN ({})",
        placeholders
    );
    let mut q = sqlx::query_as::<_, (i64, i64, i64, i64)>(&query).bind(user_id);
    for id in video_ids {
        q = q.bind(*id);
    }
    let rows = q.fetch_all(pool).await?;
    for (video_id, play_count, completed_count, total_seconds_watched) in rows {
        result.insert(
            video_id,
            WatchAggregateRow {
                play_count,
                completed_count,
                total_seconds_watched,
            },
        );
    }
    Ok(result)
}

#[instrument(skip(pool))]
pub async fn has_privacy_ack(pool: &Pool<Sqlite>, user_id: i64) -> Result<bool, AppError> {
    let row = sqlx::query!(
        "SELECT user_id FROM video_privacy_acks WHERE user_id = ?",
        user_id
    )
    .fetch_optional(pool)
    .await?;
    Ok(row.is_some())
}

#[instrument(skip(pool))]
pub async fn record_privacy_ack(pool: &Pool<Sqlite>, user_id: i64) -> Result<(), AppError> {
    sqlx::query!(
        "INSERT INTO video_privacy_acks (user_id)
         VALUES (?)
         ON CONFLICT (user_id) DO NOTHING",
        user_id
    )
    .execute(pool)
    .await?;
    Ok(())
}

#[derive(Debug, Clone, Serialize)]
pub struct VideoStatsSnapshot {
    pub video_id: i64,
    pub unique_viewers: i64,
    pub total_plays: i64,
    pub completed_plays: i64,
    pub total_seconds_watched: i64,
    pub completion_rate: f64,
}

#[instrument(skip(pool))]
pub async fn get_video_stats(
    pool: &Pool<Sqlite>,
    video_id: i64,
) -> Result<VideoStatsSnapshot, AppError> {
    let row = sqlx::query!(
        "SELECT
            COUNT(*) AS viewer_count,
            COALESCE(SUM(play_count), 0) AS total_plays,
            COALESCE(SUM(completed_count), 0) AS completed_plays,
            COALESCE(SUM(total_seconds_watched), 0) AS total_seconds_watched
         FROM video_watch_aggregates
         WHERE video_id = ?",
        video_id
    )
    .fetch_one(pool)
    .await?;
    let completion_rate = if row.total_plays > 0 {
        row.completed_plays as f64 / row.total_plays as f64
    } else {
        0.0
    };
    Ok(VideoStatsSnapshot {
        video_id,
        unique_viewers: row.viewer_count,
        total_plays: row.total_plays,
        completed_plays: row.completed_plays,
        total_seconds_watched: row.total_seconds_watched,
        completion_rate,
    })
}

#[derive(Debug, Clone, Serialize)]
pub struct StudentWatchActivityRow {
    pub video_id: i64,
    pub video_title: String,
    pub technique_id: i64,
    pub technique_name: String,
    pub play_count: i64,
    pub completed_count: i64,
    pub total_seconds_watched: i64,
    pub last_watched_at: Option<DateTime<Utc>>,
}

#[instrument(skip(pool))]
pub async fn get_student_watch_activity(
    pool: &Pool<Sqlite>,
    student_id: i64,
    since: DateTime<Utc>,
) -> Result<Vec<StudentWatchActivityRow>, AppError> {
    let rows = sqlx::query!(
        r#"SELECT v.id AS "video_id!: i64",
                  v.title AS "video_title!: String",
                  v.technique_id AS "technique_id!: i64",
                  t.name AS "technique_name!: String",
                  a.play_count AS "play_count!: i64",
                  a.completed_count AS "completed_count!: i64",
                  a.total_seconds_watched AS "total_seconds_watched!: i64",
                  a.last_watched_at AS "last_watched_at: NaiveDateTime"
           FROM video_watch_aggregates a
           JOIN videos v ON v.id = a.video_id
           JOIN techniques t ON t.id = v.technique_id
           WHERE a.user_id = ? AND a.last_watched_at >= ?
           ORDER BY a.last_watched_at DESC
           LIMIT 50"#,
        student_id,
        since,
    )
    .fetch_all(pool)
    .await?;
    Ok(rows
        .into_iter()
        .map(|r| StudentWatchActivityRow {
            video_id: r.video_id,
            video_title: r.video_title,
            technique_id: r.technique_id,
            technique_name: r.technique_name,
            play_count: r.play_count,
            completed_count: r.completed_count,
            total_seconds_watched: r.total_seconds_watched,
            last_watched_at: r.last_watched_at.map(naive_to_utc),
        })
        .collect())
}

#[derive(Debug, Clone, Serialize)]
pub struct DashboardVideoRow {
    pub video_id: i64,
    pub video_title: String,
    pub technique_id: i64,
    pub technique_name: String,
    pub plays_this_window: i64,
    pub unique_viewers: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct DashboardVideoOverview {
    pub total_seconds_watched: i64,
    pub videos_processing: i64,
    pub top_videos: Vec<DashboardVideoRow>,
}

#[instrument(skip(pool))]
pub async fn get_dashboard_video_overview(
    pool: &Pool<Sqlite>,
    since: DateTime<Utc>,
) -> Result<DashboardVideoOverview, AppError> {
    let totals_row = sqlx::query!(
        "SELECT COALESCE(SUM(seconds_watched), 0) AS seconds
         FROM video_watch_events
         WHERE event != 'opened' AND seconds_watched IS NOT NULL AND created_at >= ?",
        since
    )
    .fetch_one(pool)
    .await?;
    let processing_row = sqlx::query!(
        "SELECT COUNT(*) AS count FROM videos WHERE processing_status = 'processing'"
    )
    .fetch_one(pool)
    .await?;
    let top_rows = sqlx::query!(
        r#"SELECT v.id AS "video_id!: i64",
                  v.title AS "video_title!: String",
                  v.technique_id AS "technique_id!: i64",
                  t.name AS "technique_name!: String",
                  COUNT(*) AS "plays_this_window!: i64",
                  COUNT(DISTINCT e.user_id) AS "unique_viewers!: i64"
           FROM video_watch_events e
           JOIN videos v ON v.id = e.video_id
           JOIN techniques t ON t.id = v.technique_id
           WHERE e.event = 'started' AND e.created_at >= ?
           GROUP BY v.id
           ORDER BY COUNT(*) DESC, v.id DESC
           LIMIT 5"#,
        since,
    )
    .fetch_all(pool)
    .await?;
    Ok(DashboardVideoOverview {
        total_seconds_watched: totals_row.seconds,
        videos_processing: processing_row.count,
        top_videos: top_rows
            .into_iter()
            .map(|r| DashboardVideoRow {
                video_id: r.video_id,
                video_title: r.video_title,
                technique_id: r.technique_id,
                technique_name: r.technique_name,
                plays_this_window: r.plays_this_window,
                unique_viewers: r.unique_viewers,
            })
            .collect(),
    })
}

#[derive(Debug, Clone, Serialize)]
pub struct StorageObjectRow {
    pub video_id: i64,
    pub title: String,
    pub technique_id: i64,
    pub technique_name: String,
    pub bytes: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct StorageOverview {
    pub total_bytes: i64,
    pub total_objects: i64,
    pub top_objects: Vec<StorageObjectRow>,
}

#[instrument(skip(pool))]
pub async fn get_storage_overview(
    pool: &Pool<Sqlite>,
    top: i64,
) -> Result<StorageOverview, AppError> {
    let total_bytes = total_video_storage_bytes(pool).await?;
    let total_objects = total_video_objects(pool).await?;
    let top_rows = sqlx::query!(
        r#"SELECT v.id AS "video_id!: i64",
                  v.title AS "title!: String",
                  v.technique_id AS "technique_id!: i64",
                  t.name AS "technique_name!: String",
                  v.bytes AS "bytes!: i64"
           FROM videos v
           JOIN techniques t ON t.id = v.technique_id
           WHERE v.bytes IS NOT NULL AND v.storage_key IS NOT NULL
           ORDER BY v.bytes DESC
           LIMIT ?"#,
        top,
    )
    .fetch_all(pool)
    .await?;
    Ok(StorageOverview {
        total_bytes,
        total_objects,
        top_objects: top_rows
            .into_iter()
            .map(|r| StorageObjectRow {
                video_id: r.video_id,
                title: r.title,
                technique_id: r.technique_id,
                technique_name: r.technique_name,
                bytes: r.bytes,
            })
            .collect(),
    })
}
