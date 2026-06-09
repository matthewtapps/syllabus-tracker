use std::collections::{HashMap, hash_map::Entry};

use chrono::{NaiveDateTime, Utc};
use sqlx::{Pool, Sqlite};
use tracing::{info, instrument};

use crate::auth::{Role, User};
use crate::error::AppError;
use crate::models::{
    DbStudentTechnique, DbTag, StudentTechnique, Tag, Technique, naive_to_utc,
};

#[instrument]
pub async fn assign_technique_to_student(
    pool: &Pool<Sqlite>,
    technique_id: i64,
    student_id: i64,
    syllabus_id: Option<i64>,
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
        // If the caller is assigning into a specific syllabus, move the
        // existing assignment into that syllabus. Status and notes are
        // preserved. Loose-assign (syllabus_id = None) leaves it alone.
        // SQL column `collection_id` is the legacy name (M4.5 / decision #19).
        if let Some(sid) = syllabus_id {
            sqlx::query!(
                "UPDATE student_techniques SET collection_id = ? WHERE id = ?",
                sid,
                row.id
            )
            .execute(pool)
            .await?;
        }
        return Ok(row.id);
    }

    // Stamp the coach-update timestamps on creation so the assignment itself
    // counts as a coach action; the student sees an "unseen activity" dot
    // until they open it.
    let now = Utc::now().naive_utc();
    let res = sqlx::query!(
        "INSERT INTO student_techniques
     (student_id, student_notes, coach_notes, technique_id, technique_name, technique_description, collection_id, last_coach_update_at, last_coach_update_by_id)
     SELECT ?, '', '', t.id, t.name, t.description, ?, ?, ?
     FROM techniques t WHERE t.id = ?",
        student_id,
        syllabus_id,
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

    // Dual-read on notes (M6 / SD-004): COALESCE the shared `technique_notes`
    // row over the legacy `student_techniques.{student,coach}_notes` columns.
    // Writer still hits the legacy columns this milestone; the new table is
    // empty until the writer-cutover PR, at which point this COALESCE
    // silently flips to the new source. Same pattern for the per-actor
    // `last_*_update_at/by_id` fields.
    let rows = sqlx::query!(
        r#"
        SELECT st.id, st.technique_id, st.technique_name, st.technique_description,
               st.student_id, st.status,
               COALESCE(tn.student_notes, st.student_notes) as student_notes,
               COALESCE(tn.coach_notes, st.coach_notes) as coach_notes,
               st.created_at, st.updated_at,
               COALESCE(tn.last_coach_update_at, st.last_coach_update_at) as "last_coach_update_at?: NaiveDateTime",
               COALESCE(tn.last_coach_update_by_id, st.last_coach_update_by_id) as "last_coach_update_by_id?: i64",
               COALESCE(tn.last_student_update_at, st.last_student_update_at) as "last_student_update_at?: NaiveDateTime",
               COALESCE(tn.last_student_update_by_id, st.last_student_update_by_id) as "last_student_update_by_id?: i64",
               st.collection_id as "syllabus_id?",
               cu.display_name as coach_updater_display_name,
               cu.username as coach_updater_username,
               su.display_name as student_updater_display_name,
               su.username as student_updater_username,
               coll.name as "syllabus_name?",
               tag.id as "tag_id?: i64", tag.name as "tag_name?: String",
               COALESCE(att.attempt_count, 0) as "attempt_count!: i64",
               att.last_attempt_at as "last_attempt_at?: NaiveDateTime",
               stv.seen_at as "viewer_seen_at?: NaiveDateTime"
        FROM student_techniques st
        LEFT JOIN technique_notes tn
               ON tn.student_id = st.student_id AND tn.technique_id = st.technique_id
        LEFT JOIN users cu
               ON COALESCE(tn.last_coach_update_by_id, st.last_coach_update_by_id) = cu.id
        LEFT JOIN users su
               ON COALESCE(tn.last_student_update_by_id, st.last_student_update_by_id) = su.id
        -- SQL identifier `collections` is the legacy table name (M4.5 / decision #19).
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
                syllabus_id: row.syllabus_id,
                syllabus_name: row.syllabus_name,
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

    // SQL column `collection_id` is the legacy name (M4.5 / decision #19);
    // aliased on the way out so `SELECT *` order would otherwise drop the
    // field. Notes dual-read (M6 / SD-004): COALESCE the shared
    // `technique_notes` row over the legacy `student_techniques.*` columns.
    let row = sqlx::query_as!(
        DbStudentTechnique,
        r#"SELECT st.id, st.technique_id, st.student_id, st.technique_name, st.technique_description,
                  st.status,
                  COALESCE(tn.student_notes, st.student_notes) AS student_notes,
                  COALESCE(tn.coach_notes, st.coach_notes) AS coach_notes,
                  st.created_at, st.updated_at,
                  COALESCE(tn.last_coach_update_at, st.last_coach_update_at) AS "last_coach_update_at?: chrono::NaiveDateTime",
                  COALESCE(tn.last_coach_update_by_id, st.last_coach_update_by_id) AS "last_coach_update_by_id?: i64",
                  COALESCE(tn.last_student_update_at, st.last_student_update_at) AS "last_student_update_at?: chrono::NaiveDateTime",
                  COALESCE(tn.last_student_update_by_id, st.last_student_update_by_id) AS "last_student_update_by_id?: i64",
                  st.collection_id AS "syllabus_id?"
           FROM student_techniques st
           LEFT JOIN technique_notes tn
                  ON tn.student_id = st.student_id AND tn.technique_id = st.technique_id
           WHERE st.id = ?"#,
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

/// Look up the (student_id, technique_id) pair owned by a `student_techniques`
/// row. M6 writers need this pair to address the shared `technique_notes` row.
async fn lookup_student_technique_keys(
    pool: &Pool<Sqlite>,
    student_technique_id: i64,
) -> Result<(i64, i64), AppError> {
    let row = sqlx::query!(
        "SELECT student_id, technique_id FROM student_techniques WHERE id = ?",
        student_technique_id
    )
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| {
        AppError::NotFound(format!("student_technique {}", student_technique_id))
    })?;
    let student_id = row.student_id.ok_or_else(|| {
        AppError::Internal("student_technique row is missing student_id".into())
    })?;
    let technique_id = row.technique_id.ok_or_else(|| {
        AppError::Internal("student_technique row is missing technique_id".into())
    })?;
    Ok((student_id, technique_id))
}

/// Upsert the shared `technique_notes` row for a (student, technique) pair,
/// writing notes and stamping the actor's per-role activity slot. M6 writer
/// cutover (SD-004): legacy `student_techniques.{student,coach}_notes` and
/// `last_*_update_*` columns are NOT touched here. The dual-read shim added
/// in PR #18 means existing readers automatically pick this up.
pub(crate) async fn upsert_technique_notes(
    pool: &Pool<Sqlite>,
    student_id: i64,
    technique_id: i64,
    actor: &User,
    student_notes: &str,
    coach_notes: &str,
    now: NaiveDateTime,
) -> Result<(), AppError> {
    let actor_id = actor.id;
    match actor.role {
        Role::Coach | Role::Admin => {
            sqlx::query!(
                "INSERT INTO technique_notes
                     (student_id, technique_id, student_notes, coach_notes,
                      last_coach_update_at, last_coach_update_by_id)
                 VALUES (?, ?, ?, ?, ?, ?)
                 ON CONFLICT(student_id, technique_id) DO UPDATE SET
                     student_notes = excluded.student_notes,
                     coach_notes = excluded.coach_notes,
                     last_coach_update_at = excluded.last_coach_update_at,
                     last_coach_update_by_id = excluded.last_coach_update_by_id",
                student_id,
                technique_id,
                student_notes,
                coach_notes,
                now,
                actor_id,
            )
            .execute(pool)
            .await?;
        }
        Role::Student | Role::FootageSubmitterStudent => {
            sqlx::query!(
                "INSERT INTO technique_notes
                     (student_id, technique_id, student_notes, coach_notes,
                      last_student_update_at, last_student_update_by_id)
                 VALUES (?, ?, ?, ?, ?, ?)
                 ON CONFLICT(student_id, technique_id) DO UPDATE SET
                     student_notes = excluded.student_notes,
                     coach_notes = excluded.coach_notes,
                     last_student_update_at = excluded.last_student_update_at,
                     last_student_update_by_id = excluded.last_student_update_by_id",
                student_id,
                technique_id,
                student_notes,
                coach_notes,
                now,
                actor_id,
            )
            .execute(pool)
            .await?;
        }
    }
    Ok(())
}

/// Stamp only the activity timestamp on the shared `technique_notes` row,
/// without touching the notes text. Used by attempt-create / -update where
/// activity bumps don't carry note edits.
pub(crate) async fn bump_technique_notes_activity_tx(
    tx: &mut sqlx::Transaction<'_, Sqlite>,
    student_id: i64,
    technique_id: i64,
    actor: &User,
    now: NaiveDateTime,
) -> Result<(), AppError> {
    let actor_id = actor.id;
    match actor.role {
        Role::Coach | Role::Admin => {
            sqlx::query!(
                "INSERT INTO technique_notes
                     (student_id, technique_id, last_coach_update_at, last_coach_update_by_id)
                 VALUES (?, ?, ?, ?)
                 ON CONFLICT(student_id, technique_id) DO UPDATE SET
                     last_coach_update_at = excluded.last_coach_update_at,
                     last_coach_update_by_id = excluded.last_coach_update_by_id",
                student_id,
                technique_id,
                now,
                actor_id,
            )
            .execute(&mut **tx)
            .await?;
        }
        Role::Student | Role::FootageSubmitterStudent => {
            sqlx::query!(
                "INSERT INTO technique_notes
                     (student_id, technique_id, last_student_update_at, last_student_update_by_id)
                 VALUES (?, ?, ?, ?)
                 ON CONFLICT(student_id, technique_id) DO UPDATE SET
                     last_student_update_at = excluded.last_student_update_at,
                     last_student_update_by_id = excluded.last_student_update_by_id",
                student_id,
                technique_id,
                now,
                actor_id,
            )
            .execute(&mut **tx)
            .await?;
        }
    }
    Ok(())
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
    let now = Utc::now().naive_utc();
    let (student_id, technique_id) = lookup_student_technique_keys(pool, id).await?;

    // Status + updated_at live on student_techniques. Notes + per-actor
    // activity stamps moved to the shared technique_notes row (M6 cutover).
    sqlx::query!(
        "UPDATE student_techniques
         SET status = ?, updated_at = ?
         WHERE id = ?",
        status,
        now,
        id,
    )
    .execute(pool)
    .await?;

    upsert_technique_notes(pool, student_id, technique_id, actor, student_notes, coach_notes, now)
        .await?;

    Ok(())
}

#[instrument(skip(actor))]
pub async fn update_student_notes(
    pool: &Pool<Sqlite>,
    id: i64,
    actor: &User,
    student_notes: &str,
) -> Result<(), AppError> {
    info!("Updating student notes");
    let now = Utc::now().naive_utc();
    let (student_id, technique_id) = lookup_student_technique_keys(pool, id).await?;

    // Preserve coach_notes when the caller only sends new student_notes. Read
    // through dual-read so we pick up whatever side currently owns it.
    let existing = sqlx::query!(
        r#"SELECT COALESCE(tn.coach_notes, st.coach_notes) AS coach_notes
           FROM student_techniques st
           LEFT JOIN technique_notes tn
                  ON tn.student_id = st.student_id AND tn.technique_id = st.technique_id
           WHERE st.id = ?"#,
        id,
    )
    .fetch_one(pool)
    .await?;
    let coach_notes = existing.coach_notes.unwrap_or_default();

    sqlx::query!(
        "UPDATE student_techniques SET updated_at = ? WHERE id = ?",
        now,
        id,
    )
    .execute(pool)
    .await?;

    upsert_technique_notes(pool, student_id, technique_id, actor, student_notes, &coach_notes, now)
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

    let techniques: Vec<Technique> = techniques_map.into_values().collect();
    Ok(techniques)
}

#[instrument]
pub async fn add_techniques_to_student(
    pool: &Pool<Sqlite>,
    student_id: i64,
    technique_ids: Vec<i64>,
    syllabus_id: Option<i64>,
    actor_id: i64,
) -> Result<(), AppError> {
    info!("Adding techniques to student");
    for technique_id in technique_ids {
        assign_technique_to_student(pool, technique_id, student_id, syllabus_id, actor_id)
            .await?;
    }

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

