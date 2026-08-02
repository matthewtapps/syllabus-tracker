//! The component read behind a camp page: the camp's content as one row per
//! component, ordered by last touch. A component exists because the entity
//! exists (an attached technique, a camp note, camp-owned footage), not because
//! an event fired, and a technique component exists with no discussion at all.

use serde::Serialize;
use sqlx::{Pool, Sqlite};
use tracing::instrument;

use crate::db::techniques::{list_camp_techniques, LibraryTechniqueRow};
use crate::db::threads::{get_thread, list_threads_for_anchor, Anchor, AnchorKind, ThreadView, Viewer};
use crate::db::videos::list_videos_for_camp;
use crate::error::AppError;
use crate::models::Video;

/// Where a page of components ended, for the next request's keyset. The tuple
/// is (last_touch, kind, id) because ids only order within a kind.
#[derive(Debug, Clone, Serialize)]
pub struct CampComponentCursor {
    pub last_touch: String,
    pub kind: String,
    pub id: i64,
}

/// One component of a camp, hydrated deeply enough that the camp page can
/// render it fully expanded without a follow-up fetch per component.
#[derive(Debug, Serialize)]
pub struct CampComponent {
    /// `technique` | `note` | `video`.
    pub kind: String,
    /// The technique, thread or video id, per kind.
    pub id: i64,
    pub last_touch: String,
    pub technique: Option<LibraryTechniqueRow>,
    /// The note itself, for `note` components.
    pub thread: Option<ThreadView>,
    pub video: Option<Video>,
    /// The component's discussion: the camp_technique threads for a technique,
    /// the video's threads for a camp video, empty for a note (whose own thread
    /// is the component).
    pub threads: Vec<ThreadView>,
}

struct ComponentRef {
    kind: String,
    id: i64,
    last_touch: String,
}

/// A page of a camp's components, newest touch first, plus the cursor to
/// continue from (`None` when this was the last page).
///
/// A component whose content the viewer cannot see is dropped after the page is
/// cut, so a page may return fewer components than `limit` while still having a
/// cursor.
#[instrument(skip(pool))]
pub async fn list_camp_components(
    pool: &Pool<Sqlite>,
    camp_id: i64,
    viewer: Viewer,
    before: Option<CampComponentCursor>,
    limit: i64,
) -> Result<(Vec<CampComponent>, Option<CampComponentCursor>), AppError> {
    let (before_ts, before_kind, before_id) = match &before {
        Some(c) => (Some(c.last_touch.clone()), Some(c.kind.clone()), Some(c.id)),
        None => (None, None, None),
    };

    let rows = sqlx::query!(
        r#"WITH member AS (
               -- A technique is in the camp because it was attached to it.
               -- Camps predating camp_techniques hold theirs through the
               -- camp_technique threads that attaching used to post.
               SELECT ct.technique_id AS technique_id, ct.added_at AS since
               FROM camp_techniques ct
               WHERE ct.camp_id = ?1

               UNION

               SELECT th.technique_id, MIN(th.last_activity_at)
               FROM threads th
               WHERE th.anchor_kind = 'camp_technique'
                 AND th.camp_id = ?1
                 AND th.deleted_at IS NULL
                 AND th.technique_id IS NOT NULL
               GROUP BY th.technique_id
           ),
           comps AS (
               -- Any activity on the technique inside this camp is a touch,
               -- not just its conversation.
               SELECT 'technique' AS kind,
                      m.technique_id AS entity_id,
                      MAX(
                          MAX(m.since),
                          COALESCE(
                              (SELECT MAX(th.last_activity_at) FROM threads th
                               WHERE th.anchor_kind = 'camp_technique'
                                 AND th.camp_id = ?1
                                 AND th.deleted_at IS NULL
                                 AND th.technique_id = m.technique_id),
                              MAX(m.since)
                          ),
                          COALESCE(
                              (SELECT MAX(act.occurred_at) FROM activity act
                               WHERE act.camp_id = ?1
                                 AND act.technique_id = m.technique_id),
                              MAX(m.since)
                          )
                      ) AS last_touch
               FROM member m
               GROUP BY m.technique_id

               UNION ALL

               SELECT 'note', th.id, th.last_activity_at
               FROM threads th
               WHERE th.anchor_kind = 'camp'
                 AND th.camp_id = ?1
                 AND th.deleted_at IS NULL

               UNION ALL

               -- Camp-owned footage, bumped by any conversation on the clip.
               -- CC-015 visibility is applied by the hydration step, which
               -- reads the camp's video list.
               SELECT 'video', v.id,
                      MAX(
                          v.created_at,
                          COALESCE(
                              (SELECT MAX(vt.last_activity_at) FROM threads vt
                               WHERE vt.video_id = v.id AND vt.deleted_at IS NULL),
                              v.created_at
                          )
                      )
               FROM videos v
               WHERE v.parent_kind = 'camp'
                 AND v.camp_id = ?1
                 AND v.deleted_at IS NULL
           )
           SELECT kind AS "kind!: String",
                  entity_id AS "entity_id!: i64",
                  last_touch AS "last_touch!: String"
           FROM comps
           WHERE (?2 IS NULL OR (last_touch, kind, entity_id) < (?2, ?3, ?4))
           ORDER BY last_touch DESC, kind DESC, entity_id DESC
           LIMIT ?5"#,
        camp_id,
        before_ts,
        before_kind,
        before_id,
        limit,
    )
    .fetch_all(pool)
    .await?;

    let refs: Vec<ComponentRef> = rows
        .into_iter()
        .map(|r| ComponentRef {
            kind: r.kind,
            id: r.entity_id,
            last_touch: r.last_touch,
        })
        .collect();

    let next_cursor = if refs.len() as i64 == limit {
        refs.last().map(|r| CampComponentCursor {
            last_touch: r.last_touch.clone(),
            kind: r.kind.clone(),
            id: r.id,
        })
    } else {
        None
    };

    let needs_techniques = refs.iter().any(|r| r.kind == "technique");
    let needs_videos = refs.iter().any(|r| r.kind == "video");
    let techniques = if needs_techniques {
        list_camp_techniques(pool, camp_id).await?
    } else {
        Vec::new()
    };
    let videos = if needs_videos {
        list_videos_for_camp(pool, camp_id).await?
    } else {
        Vec::new()
    };

    let mut components = Vec::with_capacity(refs.len());
    for r in refs {
        let component = match r.kind.as_str() {
            "technique" => {
                let technique = techniques.iter().find(|t| t.id == r.id);
                let Some(technique) = technique else { continue };
                let threads = list_threads_for_anchor(
                    pool,
                    Anchor {
                        kind: AnchorKind::CampTechnique,
                        id: r.id,
                        video_ts_seconds: None,
                        pinned_student_id: None,
                        camp_id: Some(camp_id),
                    },
                    viewer,
                )
                .await?;
                CampComponent {
                    kind: r.kind,
                    id: r.id,
                    last_touch: r.last_touch,
                    technique: Some(technique.clone()),
                    thread: None,
                    video: None,
                    threads,
                }
            }
            "note" => {
                let Some(thread) = get_thread(pool, r.id, viewer).await? else { continue };
                CampComponent {
                    kind: r.kind,
                    id: r.id,
                    last_touch: r.last_touch,
                    technique: None,
                    thread: Some(thread),
                    video: None,
                    threads: Vec::new(),
                }
            }
            "video" => {
                let video = videos.iter().find(|v| v.id == r.id);
                let Some(video) = video else { continue };
                let threads = list_threads_for_anchor(
                    pool,
                    Anchor {
                        kind: AnchorKind::Video,
                        id: r.id,
                        video_ts_seconds: None,
                        pinned_student_id: None,
                        camp_id: None,
                    },
                    viewer,
                )
                .await?;
                CampComponent {
                    kind: r.kind,
                    id: r.id,
                    last_touch: r.last_touch,
                    technique: None,
                    thread: None,
                    video: Some(video.clone()),
                    threads,
                }
            }
            _ => continue,
        };
        components.push(component);
    }

    Ok((components, next_cursor))
}
