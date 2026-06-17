import type { ActivityRow } from "@/lib/activity-line";
import type { AnchorKind } from "@/lib/api";

/** Which tile (if any) a feed entry embeds, and for comments the thread anchor
 *  to hydrate from. `null` means header-only (no in-context noun to show). */
export type TileKind =
  | { kind: "technique" }
  | { kind: "comment"; anchorKind: AnchorKind; anchorId: number; threadId: number }
  | null;

// Verbs whose noun is a technique row (video verbs surface the video inside the
// row's video block). Kept in sync with the verb arms in activity-line.ts.
const TECHNIQUE_VERBS = new Set([
  "attempt_logged",
  "attempt_edited",
  "attempt_deleted",
  "sst_status_changed",
  "sst_student_notes_edited",
  "sst_coach_notes_edited",
  "technique_pinned",
  "technique_unpinned",
  "sst_added",
  "sst_hidden",
  "sst_unhidden",
  "syllabus_technique_added",
  "syllabus_technique_removed",
  "technique_edited",
  "video_watched",
  "video_added",
  "video_visibility_set",
]);

/**
 * Pick the tile for an activity row. Pure; never throws. The single place the
 * feed taxonomy lives, so the renderer stays a dumb dispatcher.
 *
 * A comment routes to the thread's anchor: a video comment anchors on the
 * video; a syllabus-context comment on the sst; otherwise on the technique.
 */
export function activityTileKind(row: ActivityRow): TileKind {
  if (row.verb === "thread_comment_posted") {
    if (row.thread_id == null) return null;
    if (row.video_id != null) {
      return { kind: "comment", anchorKind: "video", anchorId: row.video_id, threadId: row.thread_id };
    }
    if (row.context_kind === "syllabus" && row.sst_id != null) {
      return { kind: "comment", anchorKind: "sst", anchorId: row.sst_id, threadId: row.thread_id };
    }
    if (row.technique_id != null) {
      return { kind: "comment", anchorKind: "technique", anchorId: row.technique_id, threadId: row.thread_id };
    }
    return null;
  }
  // Camp/competition/match surfaces are gated off; no tile yet (clear seam).
  if (row.context_kind === "camp" || row.context_kind === "competition") return null;
  if (TECHNIQUE_VERBS.has(row.verb) && row.technique_id != null) return { kind: "technique" };
  return null;
}
