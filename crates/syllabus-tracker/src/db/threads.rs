//! Threads and comments: anchor-agnostic conversation primitive. Owns the
//! anchor/visibility vocabulary, the (kind, visibility) allow-matrix, and the
//! CRUD SQL. Activity-feed emission is handled here (PR5).

use chrono::NaiveDateTime;
use serde::Serialize;
use sqlx::{Pool, Sqlite};
use tracing::{info, instrument};

use crate::db::activity::{emit, NewActivity, Verb};
use crate::error::AppError;
use crate::models::{ProcessingStatus, Video};

/// The kinds of thing a thread can anchor to. Mirrors the `anchor_kind` CHECK
/// in `config/schema.sql` and (later) the shared frontend EntityRef union.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AnchorKind {
    StudentProfile,
    Technique,
    Video,
    VideoTimestamp,
    Sst,
    PinnedTechnique,
    Camp,
    CampTechnique,
}

impl AnchorKind {
    pub fn as_str(self) -> &'static str {
        match self {
            AnchorKind::StudentProfile => "student_profile",
            AnchorKind::Technique => "technique",
            AnchorKind::Video => "video",
            AnchorKind::VideoTimestamp => "video_timestamp",
            AnchorKind::Sst => "sst",
            AnchorKind::PinnedTechnique => "pinned_technique",
            AnchorKind::Camp => "camp",
            AnchorKind::CampTechnique => "camp_technique",
        }
    }

    pub fn from_str_kind(s: &str) -> Option<AnchorKind> {
        match s {
            "student_profile" => Some(AnchorKind::StudentProfile),
            "technique" => Some(AnchorKind::Technique),
            "video" => Some(AnchorKind::Video),
            "video_timestamp" => Some(AnchorKind::VideoTimestamp),
            "sst" => Some(AnchorKind::Sst),
            "pinned_technique" => Some(AnchorKind::PinnedTechnique),
            "camp" => Some(AnchorKind::Camp),
            "camp_technique" => Some(AnchorKind::CampTechnique),
            _ => None,
        }
    }

    /// Whether a `broadcast` thread is legal on this anchor (global/library
    /// anchors only). Mirrors the third CHECK in the schema and spec D4.
    pub fn allows_broadcast(self) -> bool {
        matches!(
            self,
            AnchorKind::Technique | AnchorKind::Video | AnchorKind::VideoTimestamp
        )
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ThreadVisibility {
    Broadcast,
    Private,
}

impl ThreadVisibility {
    pub fn as_str(self) -> &'static str {
        match self {
            ThreadVisibility::Broadcast => "broadcast",
            ThreadVisibility::Private => "private",
        }
    }
}

/// A fully-specified anchor: the kind plus the single id that kind addresses
/// (and a seconds offset for `video_timestamp`).
#[derive(Debug, Clone, Copy)]
pub struct Anchor {
    pub kind: AnchorKind,
    /// The id of the anchored entity (student id / technique id / video id /
    /// sst id). For `pinned_technique` this is the technique id; the student is
    /// carried separately in `pinned_student_id`.
    pub id: i64,
    pub video_ts_seconds: Option<i64>,
    /// Only set for `pinned_technique` (its anchor is the (student, technique)
    /// pair, so both ids are needed).
    pub pinned_student_id: Option<i64>,
    /// Only set for `camp_technique`: the (camp, technique) pair. `id` carries
    /// the technique; this carries the camp.
    pub camp_id: Option<i64>,
}

/// Input for creating a thread (the root post).
pub struct NewThread {
    pub author_id: i64,
    pub anchor: Anchor,
    pub visibility: ThreadVisibility,
    /// Required iff `visibility == Private`.
    pub scope_student_id: Option<i64>,
    pub body: String,
    /// Optional video to attach to the root post.
    ///
    /// When `attached_video_is_reference` is `false` (the default): the video
    /// must be an unattached draft belonging to `author_id`; it will be
    /// re-parented onto the new thread (existing behaviour).
    ///
    /// When `true`: the video is an existing library/camp/syllabus video that
    /// is simply *linked* — it is NOT re-parented. The video must be visible
    /// to `scope_student_id` at write time (enforced by
    /// `validate_attachable_reference`).
    pub attached_video_id: Option<i64>,
    /// `true` to link an existing video by reference (no reparent).
    /// `false` (default) to use the original draft-upload path.
    pub attached_video_is_reference: bool,
    /// Required (non-empty) when referencing a video whose title is currently
    /// empty. Silently ignored if the video already has a non-empty title.
    pub attached_video_title: Option<String>,
}

/// Resolve an `Anchor` into the six typed columns the `threads` table stores.
/// Returns (student_id, technique_id, video_id, video_ts_seconds, sst_id, camp_id).
#[allow(clippy::type_complexity)]
fn anchor_columns(
    anchor: &Anchor,
) -> (Option<i64>, Option<i64>, Option<i64>, Option<i64>, Option<i64>, Option<i64>) {
    match anchor.kind {
        AnchorKind::StudentProfile => (Some(anchor.id), None, None, None, None, None),
        AnchorKind::Technique => (None, Some(anchor.id), None, None, None, None),
        AnchorKind::Video => (None, None, Some(anchor.id), None, None, None),
        AnchorKind::VideoTimestamp => (None, None, Some(anchor.id), anchor.video_ts_seconds, None, None),
        AnchorKind::Sst => (None, None, None, None, Some(anchor.id), None),
        AnchorKind::PinnedTechnique => (anchor.pinned_student_id, Some(anchor.id), None, None, None, None),
        AnchorKind::Camp => (None, None, None, None, None, Some(anchor.id)),
        AnchorKind::CampTechnique => (None, Some(anchor.id), None, None, None, anchor.camp_id),
    }
}

/// Confirm the anchored parent row exists. PR1 supports profile + technique;
/// the remaining kinds are enabled in their surface PRs.
#[instrument(skip(pool))]
async fn validate_anchor(pool: &Pool<Sqlite>, anchor: &Anchor) -> Result<(), AppError> {
    let exists = match anchor.kind {
        AnchorKind::StudentProfile => sqlx::query_scalar!(
            r#"SELECT EXISTS(SELECT 1 FROM users WHERE id = ? AND role = 'student') AS "e!: i64""#,
            anchor.id
        )
        .fetch_one(pool)
        .await?,
        AnchorKind::Technique => sqlx::query_scalar!(
            r#"SELECT EXISTS(SELECT 1 FROM techniques WHERE id = ?) AS "e!: i64""#,
            anchor.id
        )
        .fetch_one(pool)
        .await?,
        AnchorKind::Video | AnchorKind::VideoTimestamp => {
            // Read the live video's parent_kind so we can both confirm it exists
            // and enforce CX-010 below. A missing row falls through to the
            // shared not-found error at the end of this function.
            let row = sqlx::query!(
                r#"SELECT parent_kind
                   FROM videos
                   WHERE id = ? AND deleted_at IS NULL AND hidden_at IS NULL"#,
                anchor.id
            )
            .fetch_optional(pool)
            .await?;
            match row {
                // CX-010: a video that is itself a thread reply cannot anchor a
                // new thread (prevents endless reply chains).
                Some(r) if r.parent_kind == "thread" => {
                    return Err(AppError::Validation(
                        "cannot start a thread on a video that is a thread reply".to_string(),
                    ));
                }
                Some(_) => 1,
                None => 0,
            }
        }
        AnchorKind::Sst => sqlx::query_scalar!(
            r#"SELECT EXISTS(SELECT 1 FROM student_syllabus_techniques WHERE id = ?) AS "e!: i64""#,
            anchor.id
        )
        .fetch_one(pool)
        .await?,
        AnchorKind::PinnedTechnique => {
            let student_id = anchor.pinned_student_id.ok_or_else(|| {
                AppError::Validation("pinned anchor requires a student".to_string())
            })?;
            sqlx::query_scalar!(
                r#"SELECT EXISTS(
                      SELECT 1 FROM student_pinned_techniques
                      WHERE student_id = ? AND technique_id = ?
                   ) AS "e!: i64""#,
                student_id,
                anchor.id
            )
            .fetch_one(pool)
            .await?
        }
        // Existence only, no `archived_at` filter (unlike video upload, which
        // blocks archived camps): archived camps stay referenceable, so
        // post-camp discussion threads are intentionally still allowed.
        AnchorKind::Camp => sqlx::query_scalar!(
            r#"SELECT EXISTS(SELECT 1 FROM camps WHERE id = ?) AS "e!: i64""#,
            anchor.id
        )
        .fetch_one(pool)
        .await?,
        // Camp must exist, and the technique must be global (scoped_camp_id IS NULL)
        // or scoped to THIS camp. Posting the technique is the attach; no prior
        // camp_techniques membership is required.
        AnchorKind::CampTechnique => {
            let camp_id = anchor.camp_id.ok_or_else(|| {
                AppError::Validation("camp_technique anchor requires a camp".to_string())
            })?;
            sqlx::query_scalar!(
                r#"SELECT EXISTS(
                      SELECT 1 FROM techniques t
                      JOIN camps c ON c.id = ?
                      WHERE t.id = ?
                        AND (t.scoped_camp_id IS NULL OR t.scoped_camp_id = ?)
                   ) AS "e!: i64""#,
                camp_id,
                anchor.id,
                camp_id
            )
            .fetch_one(pool)
            .await?
        }
    };
    if exists == 0 {
        return Err(AppError::Validation(format!(
            "anchor {} #{} does not exist",
            anchor.kind.as_str(),
            anchor.id
        )));
    }
    Ok(())
}

#[instrument(skip(pool, new))]
pub async fn create_thread(pool: &Pool<Sqlite>, new: NewThread) -> Result<i64, AppError> {
    if new.visibility == ThreadVisibility::Broadcast && !new.anchor.kind.allows_broadcast() {
        return Err(AppError::Validation(
            "broadcast is only allowed on technique/video anchors".to_string(),
        ));
    }
    if new.visibility == ThreadVisibility::Private && new.scope_student_id.is_none() {
        return Err(AppError::Validation(
            "a private thread must name a scope student".to_string(),
        ));
    }
    if new.visibility == ThreadVisibility::Broadcast && new.scope_student_id.is_some() {
        return Err(AppError::Validation(
            "a broadcast thread must not name a scope student".to_string(),
        ));
    }
    // A root post needs content: text, a video, or both — EXCEPT for
    // camp_technique threads where the technique IS the content (the anchor
    // carries the noun; no body or video is required).
    if new.body.trim().is_empty()
        && new.attached_video_id.is_none()
        && new.anchor.kind != AnchorKind::CampTechnique
    {
        return Err(AppError::Validation("a thread needs text or a video".to_string()));
    }
    validate_anchor(pool, &new.anchor).await?;
    if let Some(vid) = new.attached_video_id {
        if new.attached_video_is_reference {
            // Reference path: video must be visible to the scope student.
            let scope_student_id = new.scope_student_id.ok_or_else(|| {
                AppError::Validation(
                    "attached_video_is_reference requires scope_student_id (camp thread only)".to_string(),
                )
            })?;
            validate_attachable_reference(pool, vid, scope_student_id).await?;
        } else {
            // Draft path: unchanged behaviour.
            validate_attachable_draft(pool, vid, new.author_id).await?;
        }
    }

    let (student_id, technique_id, video_id, video_ts, sst_id, camp_id) = anchor_columns(&new.anchor);
    let kind = new.anchor.kind.as_str();
    let visibility = new.visibility.as_str();

    info!(anchor_kind = kind, "creating thread");

    let mut tx = pool.begin().await?;

    let thread_id = sqlx::query_scalar!(
        r#"INSERT INTO threads
              (created_by_id, body, anchor_kind, student_id, technique_id, video_id,
               video_ts_seconds, sst_id, camp_id, attached_video_id, visibility, scope_student_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           RETURNING id AS "id!: i64""#,
        new.author_id,
        new.body,
        kind,
        student_id,
        technique_id,
        video_id,
        video_ts,
        sst_id,
        camp_id,
        new.attached_video_id,
        visibility,
        new.scope_student_id,
    )
    .fetch_one(&mut *tx)
    .await?;

    if let Some(vid) = new.attached_video_id {
        if new.attached_video_is_reference {
            // Reference path: title backfill only; do NOT reparent.
            let current_title: Option<String> = sqlx::query_scalar(
                "SELECT title FROM videos WHERE id = ?",
            )
            .bind(vid)
            .fetch_optional(&mut *tx)
            .await?;
            let needs_title = current_title.as_deref().map(|t| t.trim().is_empty()).unwrap_or(true);
            if needs_title {
                let provided = new.attached_video_title
                    .as_deref()
                    .map(|t| t.trim())
                    .filter(|t| !t.is_empty())
                    .ok_or_else(|| {
                        AppError::Validation(
                            "a title is required when referencing a video with no title".to_string(),
                        )
                    })?;
                sqlx::query!(
                    "UPDATE videos SET title = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
                    provided,
                    vid,
                )
                .execute(&mut *tx)
                .await?;
            }
            // If the video already has a title, attached_video_title is silently ignored.
        } else {
            // Draft path: reparent as before.
            reparent_draft_to_thread(&mut tx, vid, thread_id).await?;
        }
    }

    // Emit activity row. Private threads target the scope student's feed;
    // broadcast threads are coach-only (target_student_id = NULL, per spec D8).
    let target = match new.visibility {
        ThreadVisibility::Private => new.scope_student_id,
        ThreadVisibility::Broadcast => None,
    };
    let mut ev = NewActivity::new(Verb::ThreadCommentPosted, new.author_id).thread(thread_id);
    if let Some(t) = target {
        ev = ev.target_student(t);
    }
    // Map the anchor to its typed id, then denormalise the deep-link context.
    let (technique_id, video_id, sst_id) = match new.anchor.kind {
        AnchorKind::Technique | AnchorKind::PinnedTechnique => (Some(new.anchor.id), None, None),
        AnchorKind::Video | AnchorKind::VideoTimestamp => (None, Some(new.anchor.id), None),
        AnchorKind::Sst => (None, None, Some(new.anchor.id)),
        // target_student already identifies the subject for profile threads.
        AnchorKind::StudentProfile => (None, None, None),
        // Camp threads carry no technique/video/sst id but do carry camp context
        // for deep-linking back to the camp page.
        AnchorKind::Camp => (None, None, None),
        // Camp-technique threads carry the technique id so the feed can render
        // the technique card. The camp context (tagged below via
        // `.camp(camp_id).context_kind("camp")`) keeps the feed routing to the
        // camp surface rather than the library, so technique_id+camp_id together
        // are unambiguous.
        AnchorKind::CampTechnique => (Some(new.anchor.id), None, None),
    };
    let mut ev = apply_thread_anchor_context(&mut tx, ev, technique_id, video_id, sst_id).await?;
    if new.anchor.kind == AnchorKind::Camp {
        ev = ev.camp(new.anchor.id).context_kind("camp");
    }
    if new.anchor.kind == AnchorKind::CampTechnique {
        if let Some(camp_id) = new.anchor.camp_id {
            ev = ev.camp(camp_id).context_kind("camp");
        }
    }
    emit(&mut tx, ev).await?;

    tx.commit().await?;
    Ok(thread_id)
}

/// Denormalise a thread's deep-link context onto its activity row so the feed
/// can route to the surface the comment was made on, the same way the typed
/// id columns drive deep links for other verbs. Exactly one of the ids is set
/// per anchor. For an SST anchor we also resolve the owning syllabus (the SST
/// id alone cannot build the `/student/:id/syllabi/:id` URL). `target_student_id`
/// is deliberately left to the caller: it drives feed routing (broadcast
/// threads must stay coach-only), so a broadcast SST thread simply has no
/// student in its path and the frontend falls back to no deep link.
async fn apply_thread_anchor_context(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    ev: NewActivity,
    technique_id: Option<i64>,
    video_id: Option<i64>,
    sst_id: Option<i64>,
) -> Result<NewActivity, AppError> {
    if let Some(id) = sst_id {
        let syllabus_id = sqlx::query_scalar!(
            r#"SELECT a.syllabus_id AS "sid!: i64"
               FROM student_syllabus_techniques sst
               JOIN syllabus_assignments a ON a.id = sst.assignment_id
               WHERE sst.id = ?"#,
            id,
        )
        .fetch_optional(&mut **tx)
        .await?;
        let mut ev = ev.sst(id).context_kind("syllabus");
        if let Some(sid) = syllabus_id {
            ev = ev.syllabus(sid);
        }
        Ok(ev)
    } else if let Some(id) = technique_id {
        Ok(ev.technique(id).context_kind("library"))
    } else if let Some(id) = video_id {
        // Resolve the owning technique so the feed can name it and deep-link to
        // the library technique row, the same way a video_added row does.
        // Runtime query (not the macro) to stay out of the offline .sqlx cache.
        let technique_id: Option<i64> =
            sqlx::query_scalar::<_, i64>("SELECT technique_id FROM videos WHERE id = ?")
                .bind(id)
                .fetch_optional(&mut **tx)
                .await?;
        let mut ev = ev.video(id).context_kind("library");
        if let Some(tid) = technique_id {
            ev = ev.technique(tid);
        }
        Ok(ev)
    } else {
        Ok(ev)
    }
}

/// Who is asking. `is_coach` is true for Coach or Admin (gym-global role).
#[derive(Debug, Clone, Copy)]
pub struct Viewer {
    pub user_id: i64,
    pub is_coach: bool,
}

#[derive(Debug, Serialize)]
pub struct CommentView {
    pub id: i64,
    pub thread_id: i64,
    pub parent_comment_id: Option<i64>,
    pub author_id: i64,
    pub author_name: String,
    /// `None` when the comment is soft-deleted (tombstoned in the read layer).
    pub body: Option<String>,
    /// Optional video attached to this comment, rendered under the text. A
    /// still-processing video is only included for the comment's own author
    /// (others don't see the comment at all until it is playable).
    pub video: Option<Video>,
    /// Optional timestamp (seconds) into this comment's thread's attached video,
    /// for a reply pinned to a moment of the post's video. NULL = whole-video reply.
    pub video_ts_seconds: Option<i64>,
    pub created_at: NaiveDateTime,
    pub deleted_at: Option<NaiveDateTime>,
}

#[derive(Debug, Serialize)]
pub struct ThreadView {
    pub id: i64,
    pub anchor_kind: String,
    pub author_id: i64,
    pub author_name: String,
    pub visibility: String,
    pub scope_student_id: Option<i64>,
    /// Anchor seconds for `video_timestamp` threads; `None` for every other
    /// anchor kind (including whole-video `video` threads).
    pub video_ts_seconds: Option<i64>,
    pub body: Option<String>,
    /// Optional video attached to the root post, rendered under the body. Same
    /// author-only-until-ready rule as a comment's video (a thread whose root
    /// video is still processing is hidden from everyone but its author).
    pub video: Option<Video>,
    pub created_at: NaiveDateTime,
    pub deleted_at: Option<NaiveDateTime>,
    pub comments: Vec<CommentView>,
}

/// Validates that `video_id` is a live draft video the author may attach: it
/// must exist, not be soft-deleted, have been uploaded by `author_id`, sit in a
/// draft/thread parent (`loose` while still a draft, or `thread` if re-checked),
/// and not already be attached to another comment or thread root. Surface-level
/// permission (who may attach a video at all) is enforced at the route layer.
async fn validate_attachable_draft(
    pool: &Pool<Sqlite>,
    video_id: i64,
    author_id: i64,
) -> Result<(), AppError> {
    let v = sqlx::query!(
        r#"SELECT uploaded_by_id AS "uploaded_by_id!: i64", parent_kind,
                  (deleted_at IS NULL) AS "alive!: i64"
           FROM videos WHERE id = ?"#,
        video_id
    )
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| AppError::Validation("attached video not found".to_string()))?;
    if v.alive == 0 {
        return Err(AppError::Validation("attached video is deleted".to_string()));
    }
    if v.uploaded_by_id != author_id {
        return Err(AppError::Validation("cannot attach another user's video".to_string()));
    }
    if v.parent_kind != "loose" && v.parent_kind != "thread" {
        return Err(AppError::Validation("video is not a thread reply draft".to_string()));
    }
    let used = sqlx::query_scalar!(
        r#"SELECT (
              EXISTS(SELECT 1 FROM thread_comments WHERE video_id = ? AND deleted_at IS NULL)
              OR EXISTS(SELECT 1 FROM threads WHERE attached_video_id = ? AND deleted_at IS NULL)
           ) AS "e!: i64""#,
        video_id,
        video_id,
    )
    .fetch_one(pool)
    .await?;
    if used != 0 {
        return Err(AppError::Validation("video is already attached".to_string()));
    }
    Ok(())
}

/// Validates that `video_id` is an existing, live, ready video that is visible
/// to `scope_student_id` anywhere in their account. Unlike the draft path, this
/// does NOT check `uploaded_by_id` or `parent_kind` — the caller is linking a
/// library/camp/syllabus video, not uploading their own draft.
///
/// Returns `AppError::Validation` if the video is missing/deleted/hidden/not-ready,
/// and `AppError::Authorization` if the student cannot see it.
async fn validate_attachable_reference(
    pool: &Pool<Sqlite>,
    video_id: i64,
    scope_student_id: i64,
) -> Result<(), AppError> {
    use crate::db::video_visible_to_student_anywhere;
    // Check existence + liveness + ready status in one query.
    let row = sqlx::query!(
        r#"SELECT processing_status,
                  (deleted_at IS NOT NULL OR hidden_at IS NOT NULL) AS "gone!: i64"
           FROM videos WHERE id = ?"#,
        video_id
    )
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| AppError::Validation("referenced video not found".to_string()))?;

    if row.gone != 0 {
        return Err(AppError::Validation("referenced video is deleted or hidden".to_string()));
    }
    if row.processing_status != "ready" {
        return Err(AppError::Validation("referenced video is not ready for playback".to_string()));
    }

    // Write-time visibility guard: no back-door references at creation.
    let visible = video_visible_to_student_anywhere(pool, video_id, scope_student_id).await?;
    if !visible {
        return Err(AppError::Authorization(
            "referenced video is not visible to this student".to_string(),
        ));
    }
    Ok(())
}

/// Re-parents a draft (Loose) video onto a thread inside the caller's tx, so it
/// inherits thread visibility/playback rules.
async fn reparent_draft_to_thread(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    video_id: i64,
    thread_id: i64,
) -> Result<(), AppError> {
    sqlx::query!(
        "UPDATE videos SET parent_kind = 'thread', thread_id = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?",
        thread_id,
        video_id,
    )
    .execute(&mut **tx)
    .await?;
    Ok(())
}

/// Hard-deletes the comment or thread that attached `video_id`, used when the
/// video's processing fails: a reply whose clip never lands is cancelled so it
/// never surfaces. Idempotent. Called from the processing-result handler.
#[instrument(skip(pool))]
pub async fn cancel_for_failed_video(pool: &Pool<Sqlite>, video_id: i64) -> Result<(), AppError> {
    sqlx::query!("DELETE FROM thread_comments WHERE video_id = ?", video_id)
        .execute(pool)
        .await?;
    sqlx::query!("DELETE FROM threads WHERE attached_video_id = ?", video_id)
        .execute(pool)
        .await?;
    Ok(())
}

/// `video_is_reference`: when `true`, link `video_id` by reference (no reparent).
/// The video must be visible to the thread's scope student at write time.
/// When `false` (default): treat it as a draft upload (existing behaviour).
#[allow(clippy::too_many_arguments)]
#[instrument(skip(pool, body))]
pub async fn create_comment(
    pool: &Pool<Sqlite>,
    thread_id: i64,
    parent_comment_id: Option<i64>,
    author_id: i64,
    body: &str,
    video_id: Option<i64>,
    video_ts_seconds: Option<i64>,
    video_is_reference: bool,
) -> Result<i64, AppError> {
    // A reply needs content: text, a video, or both.
    if body.trim().is_empty() && video_id.is_none() {
        return Err(AppError::Validation("a reply needs text or a video".to_string()));
    }
    if let Some(vid) = video_id {
        if video_is_reference {
            // Defer reference validation until we've loaded the thread row so we
            // can use its scope_student_id. Validated below after thread_row fetch.
            let _ = vid; // suppress unused warning; actual check happens below
        } else {
            validate_attachable_draft(pool, vid, author_id).await?;
        }
    }
    // Fetch the thread's liveness, visibility, scope student, and anchor
    // details in one query so we can emit the activity row with the right
    // target_student_id and denormalised anchor column.
    let thread_row = sqlx::query!(
        r#"SELECT (deleted_at IS NULL)  AS "alive!: i64",
                  visibility,
                  scope_student_id      AS "scope_student_id?: i64",
                  anchor_kind,
                  technique_id          AS "technique_id?: i64",
                  video_id              AS "video_id?: i64",
                  sst_id                AS "sst_id?: i64",
                  camp_id               AS "camp_id?: i64"
           FROM threads WHERE id = ?"#,
        thread_id
    )
    .fetch_optional(pool)
    .await?;

    let thread_row = match thread_row {
        None => return Err(AppError::NotFound(format!("thread #{thread_id} not found"))),
        Some(r) if r.alive == 0 => return Err(AppError::Validation("thread is deleted".to_string())),
        Some(r) => r,
    };

    // Now that we have the thread's scope_student_id we can validate a reference
    // attachment. (Draft validation happened before the fetch above.)
    if let Some(vid) = video_id {
        if video_is_reference {
            let scope_student_id = thread_row.scope_student_id.ok_or_else(|| {
                AppError::Validation(
                    "cannot reference a video on a broadcast thread (no scope student)".to_string(),
                )
            })?;
            validate_attachable_reference(pool, vid, scope_student_id).await?;
        }
    }

    // One level of nesting: the parent (if any) must belong to THIS thread and
    // must itself be a top-level comment.
    if let Some(parent_id) = parent_comment_id {
        let parent = sqlx::query_scalar!(
            r#"SELECT (parent_comment_id IS NOT NULL) AS "is_reply!: i64"
               FROM thread_comments WHERE id = ? AND thread_id = ?"#,
            parent_id,
            thread_id,
        )
        .fetch_optional(pool)
        .await?;
        match parent {
            None => return Err(AppError::Validation("parent comment not found".to_string())),
            Some(1) => {
                return Err(AppError::Validation(
                    "cannot reply to a reply (one level of nesting)".to_string(),
                ));
            }
            _ => {}
        }
    }

    let mut tx = pool.begin().await?;

    let comment_id = sqlx::query_scalar!(
        r#"INSERT INTO thread_comments
              (thread_id, parent_comment_id, author_id, body, video_id, video_ts_seconds)
           VALUES (?, ?, ?, ?, ?, ?)
           RETURNING id AS "id!: i64""#,
        thread_id,
        parent_comment_id,
        author_id,
        body,
        video_id,
        video_ts_seconds,
    )
    .fetch_one(&mut *tx)
    .await?;

    if let Some(vid) = video_id {
        if video_is_reference {
            // Reference path: the video stays where it lives; do NOT reparent.
        } else {
            // Draft path: reparent as before.
            reparent_draft_to_thread(&mut tx, vid, thread_id).await?;
        }
    }

    sqlx::query!(
        "UPDATE threads SET last_activity_at = CURRENT_TIMESTAMP WHERE id = ?",
        thread_id
    )
    .execute(&mut *tx)
    .await?;

    // Emit activity: private threads target the scope student; broadcast = None.
    let target = if thread_row.visibility == "private" {
        thread_row.scope_student_id
    } else {
        None
    };
    let mut ev = NewActivity::new(Verb::ThreadCommentPosted, author_id).thread(thread_id);
    if let Some(t) = target {
        ev = ev.target_student(t);
    }
    // Denormalise the deep-link context from this thread's anchor columns.
    let mut ev = apply_thread_anchor_context(
        &mut tx,
        ev,
        thread_row.technique_id,
        thread_row.video_id,
        thread_row.sst_id,
    )
    .await?;
    // Camp anchors carry no technique/video/sst id; tag the camp context here so
    // a reply on a camp thread deep-links back to the camp (mirrors create_thread).
    if let Some(camp_id) = thread_row.camp_id {
        ev = ev.camp(camp_id).context_kind("camp");
    }
    emit(&mut tx, ev).await?;

    tx.commit().await?;
    Ok(comment_id)
}

fn viewer_can_see(viewer: &Viewer, visibility: &str, scope_student_id: Option<i64>) -> bool {
    viewer.is_coach || visibility == "broadcast" || scope_student_id == Some(viewer.user_id)
}

/// Counts, per video, the comment threads anchored to it (`video` and
/// `video_timestamp`) that `viewer` may see -- the count mirrors
/// [`viewer_can_see`]: a coach sees every thread, a student sees broadcast
/// threads plus their own private ones. Returns `video_id -> count` for the
/// given ids; videos with no visible threads are absent from the map.
///
/// Uses a runtime `QueryBuilder` (not the `query!` macro) for the dynamic
/// `IN (...)` list, matching `list_video_syllabus_overrides`; this also keeps
/// it out of the offline `.sqlx` cache.
#[instrument(skip(pool, video_ids))]
pub async fn count_video_comments_visible(
    pool: &Pool<Sqlite>,
    video_ids: &[i64],
    viewer: Viewer,
) -> Result<std::collections::HashMap<i64, i64>, AppError> {
    use std::collections::HashMap;
    if video_ids.is_empty() {
        return Ok(HashMap::new());
    }
    let mut qb = sqlx::QueryBuilder::<sqlx::Sqlite>::new(
        "SELECT video_id, COUNT(*) AS n FROM threads \
         WHERE deleted_at IS NULL \
           AND anchor_kind IN ('video', 'video_timestamp') \
           AND video_id IN (",
    );
    let mut sep = qb.separated(", ");
    for id in video_ids {
        sep.push_bind(*id);
    }
    qb.push(")");
    if !viewer.is_coach {
        qb.push(" AND (visibility = 'broadcast' OR scope_student_id = ");
        qb.push_bind(viewer.user_id);
        qb.push(")");
    }
    qb.push(" GROUP BY video_id");
    let rows = qb.build().fetch_all(pool).await?;
    let mut map: HashMap<i64, i64> = HashMap::new();
    for row in rows {
        use sqlx::Row;
        let video_id: i64 = row.try_get("video_id")?;
        let n: i64 = row.try_get("n")?;
        map.insert(video_id, n);
    }
    Ok(map)
}

#[instrument(skip(pool))]
pub async fn get_thread(
    pool: &Pool<Sqlite>,
    thread_id: i64,
    viewer: Viewer,
) -> Result<Option<ThreadView>, AppError> {
    let row = sqlx::query!(
        r#"SELECT t.id AS "id!: i64",
                  t.anchor_kind,
                  t.created_by_id AS "author_id!: i64",
                  COALESCE(u.display_name, u.username, '?') AS "author_name!: String",
                  t.visibility,
                  t.scope_student_id AS "scope_student_id?: i64",
                  t.video_ts_seconds AS "video_ts_seconds?: i64",
                  t.attached_video_id AS "attached_video_id?: i64",
                  t.body,
                  t.created_at AS "created_at!: NaiveDateTime",
                  t.deleted_at AS "deleted_at?: NaiveDateTime"
           FROM threads t
           JOIN users u ON u.id = t.created_by_id
           WHERE t.id = ?"#,
        thread_id
    )
    .fetch_optional(pool)
    .await?;

    let row = match row {
        None => return Ok(None),
        Some(r) => r,
    };

    if !viewer_can_see(&viewer, &row.visibility, row.scope_student_id) {
        return Ok(None);
    }

    // Resolve the root's attached video. A root whose video is still processing
    // (or has failed) is hidden from everyone but its author until it is
    // playable, mirroring the per-comment rule.
    let root_video = match row.attached_video_id {
        Some(vid) => crate::db::get_video(pool, vid).await?,
        None => None,
    };
    if let Some(v) = &root_video {
        if v.processing_status != ProcessingStatus::Ready && row.author_id != viewer.user_id {
            return Ok(None);
        }
    }

    let comment_rows = sqlx::query!(
        r#"SELECT c.id AS "id!: i64",
                  c.thread_id AS "thread_id!: i64",
                  c.parent_comment_id AS "parent_comment_id?: i64",
                  c.author_id AS "author_id!: i64",
                  COALESCE(u.display_name, u.username, '?') AS "author_name!: String",
                  c.body,
                  c.video_id AS "video_id?: i64",
                  c.video_ts_seconds AS "video_ts_seconds?: i64",
                  c.created_at AS "created_at!: NaiveDateTime",
                  c.deleted_at AS "deleted_at?: NaiveDateTime"
           FROM thread_comments c
           JOIN users u ON u.id = c.author_id
           WHERE c.thread_id = ?
           ORDER BY c.created_at, c.id"#,
        thread_id
    )
    .fetch_all(pool)
    .await?;

    let mut comments = Vec::with_capacity(comment_rows.len());
    for c in comment_rows {
        let deleted = c.deleted_at.is_some();
        // A tombstoned comment drops its video; otherwise resolve it.
        let video = match (deleted, c.video_id) {
            (false, Some(vid)) => crate::db::get_video(pool, vid).await?,
            _ => None,
        };
        // Author-only-until-ready: a comment whose video is still processing
        // (or failed) is hidden from everyone but the author.
        if let Some(v) = &video {
            if v.processing_status != ProcessingStatus::Ready && c.author_id != viewer.user_id {
                continue;
            }
        }
        comments.push(CommentView {
            id: c.id,
            thread_id: c.thread_id,
            parent_comment_id: c.parent_comment_id,
            author_id: c.author_id,
            author_name: c.author_name,
            body: if deleted { None } else { Some(c.body) },
            video,
            video_ts_seconds: c.video_ts_seconds,
            created_at: c.created_at,
            deleted_at: c.deleted_at,
        });
    }

    let thread_body = if row.deleted_at.is_some() { None } else { Some(row.body) };
    let root_video = if row.deleted_at.is_some() { None } else { root_video };

    Ok(Some(ThreadView {
        id: row.id,
        anchor_kind: row.anchor_kind,
        author_id: row.author_id,
        author_name: row.author_name,
        visibility: row.visibility,
        scope_student_id: row.scope_student_id,
        video_ts_seconds: row.video_ts_seconds,
        body: thread_body,
        video: root_video,
        created_at: row.created_at,
        deleted_at: row.deleted_at,
        comments,
    }))
}

#[instrument(skip(pool))]
pub async fn list_threads_for_anchor(
    pool: &Pool<Sqlite>,
    anchor: Anchor,
    viewer: Viewer,
) -> Result<Vec<ThreadView>, AppError> {
    let (student_id, technique_id, video_id, _video_ts, sst_id, camp_id) = anchor_columns(&anchor);

    let thread_ids: Vec<i64> = match anchor.kind {
        AnchorKind::StudentProfile => {
            sqlx::query_scalar!(
                r#"SELECT id AS "id!: i64" FROM threads
                   WHERE anchor_kind = 'student_profile' AND student_id = ? AND deleted_at IS NULL
                   ORDER BY last_activity_at DESC"#,
                student_id
            )
            .fetch_all(pool)
            .await?
        }
        AnchorKind::Technique => {
            sqlx::query_scalar!(
                r#"SELECT id AS "id!: i64" FROM threads
                   WHERE anchor_kind = 'technique' AND technique_id = ? AND deleted_at IS NULL
                   ORDER BY last_activity_at DESC"#,
                technique_id
            )
            .fetch_all(pool)
            .await?
        }
        AnchorKind::Video | AnchorKind::VideoTimestamp => {
            sqlx::query_scalar!(
                r#"SELECT id AS "id!: i64" FROM threads
                   WHERE video_id = ?
                     AND anchor_kind IN ('video', 'video_timestamp')
                     AND deleted_at IS NULL
                   ORDER BY COALESCE(video_ts_seconds, 0), last_activity_at DESC"#,
                video_id
            )
            .fetch_all(pool)
            .await?
        }
        AnchorKind::Sst => {
            sqlx::query_scalar!(
                r#"SELECT id AS "id!: i64" FROM threads
                   WHERE anchor_kind = 'sst' AND sst_id = ? AND deleted_at IS NULL
                   ORDER BY last_activity_at DESC"#,
                sst_id
            )
            .fetch_all(pool)
            .await?
        }
        AnchorKind::PinnedTechnique => {
            sqlx::query_scalar!(
                r#"SELECT id AS "id!: i64" FROM threads
                   WHERE anchor_kind = 'pinned_technique'
                     AND student_id = ? AND technique_id = ?
                     AND deleted_at IS NULL
                   ORDER BY last_activity_at DESC"#,
                student_id,
                technique_id
            )
            .fetch_all(pool)
            .await?
        }
        AnchorKind::Camp => {
            sqlx::query_scalar!(
                r#"SELECT id AS "id!: i64" FROM threads
                   WHERE anchor_kind = 'camp' AND camp_id = ? AND deleted_at IS NULL
                   ORDER BY last_activity_at DESC"#,
                camp_id
            )
            .fetch_all(pool)
            .await?
        }
        AnchorKind::CampTechnique => {
            sqlx::query_scalar!(
                r#"SELECT id AS "id!: i64" FROM threads
                   WHERE anchor_kind = 'camp_technique'
                     AND camp_id = ? AND technique_id = ?
                     AND deleted_at IS NULL
                   ORDER BY last_activity_at DESC"#,
                camp_id,
                technique_id
            )
            .fetch_all(pool)
            .await?
        }
    };

    let mut views = Vec::with_capacity(thread_ids.len());
    for id in thread_ids {
        if let Some(view) = get_thread(pool, id, viewer).await? {
            views.push(view);
        }
    }
    Ok(views)
}

#[instrument(skip(pool))]
pub async fn soft_delete_comment(pool: &Pool<Sqlite>, comment_id: i64, actor_id: i64) -> Result<(), AppError> {
    let affected = sqlx::query!(
        "UPDATE thread_comments SET deleted_at = CURRENT_TIMESTAMP, deleted_by_id = ?
         WHERE id = ? AND deleted_at IS NULL",
        actor_id,
        comment_id,
    )
    .execute(pool)
    .await?
    .rows_affected();
    if affected == 0 {
        return Err(AppError::NotFound(format!(
            "comment #{comment_id} not found or already deleted"
        )));
    }
    Ok(())
}

#[instrument(skip(pool))]
pub async fn soft_delete_thread(pool: &Pool<Sqlite>, thread_id: i64, actor_id: i64) -> Result<(), AppError> {
    let affected = sqlx::query!(
        "UPDATE threads SET deleted_at = CURRENT_TIMESTAMP, deleted_by_id = ?
         WHERE id = ? AND deleted_at IS NULL",
        actor_id,
        thread_id,
    )
    .execute(pool)
    .await?
    .rows_affected();
    if affected == 0 {
        return Err(AppError::NotFound(format!(
            "thread #{thread_id} not found or already deleted"
        )));
    }
    Ok(())
}

#[cfg(test)]
mod type_tests {
    use super::{AnchorKind, ThreadVisibility};

    #[test]
    fn anchor_kind_str_roundtrips() {
        for kind in [
            AnchorKind::StudentProfile,
            AnchorKind::Technique,
            AnchorKind::Video,
            AnchorKind::VideoTimestamp,
            AnchorKind::Sst,
            AnchorKind::PinnedTechnique,
            AnchorKind::Camp,
            AnchorKind::CampTechnique,
        ] {
            assert_eq!(AnchorKind::from_str_kind(kind.as_str()), Some(kind));
        }
        assert_eq!(AnchorKind::from_str_kind("nope"), None);
    }

    #[test]
    fn only_global_anchors_allow_broadcast() {
        assert!(AnchorKind::Technique.allows_broadcast());
        assert!(AnchorKind::Video.allows_broadcast());
        assert!(AnchorKind::VideoTimestamp.allows_broadcast());
        assert!(!AnchorKind::StudentProfile.allows_broadcast());
        assert!(!AnchorKind::Sst.allows_broadcast());
        assert!(!AnchorKind::PinnedTechnique.allows_broadcast());
        assert!(!AnchorKind::Camp.allows_broadcast());
        assert!(!AnchorKind::CampTechnique.allows_broadcast());
    }

    #[test]
    fn visibility_str() {
        assert_eq!(ThreadVisibility::Broadcast.as_str(), "broadcast");
        assert_eq!(ThreadVisibility::Private.as_str(), "private");
    }
}
