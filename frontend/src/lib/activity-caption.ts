import { activityLine, type ActivityRow } from "./activity-line";
import { STATUS_LABELS, type Status } from "./status";

/**
 * The minimal verb caption for a feed tile. Because the breadcrumb header names
 * the actor, target student, and context surface, and the embedded tile shows
 * the technique/thread itself, the caption only needs the bare verb (and, for a
 * status change, the new status). It deliberately omits the technique and
 * syllabus names that the tile and breadcrumb already carry.
 *
 * Pure; never throws. Falls back to the compact `activityLine` verb for any verb
 * without a tailored caption.
 */
export interface ActivityCaption {
  text: string;
  /** For status changes: the user-facing label (New/Doing/Done). */
  statusLabel?: string;
  /** The status value driving the dot colour. */
  statusColor?: Status;
}

interface StatusPayload {
  to: Status;
}

function parsePayload<T>(json: string | null): T | null {
  if (!json) return null;
  try {
    return JSON.parse(json) as T;
  } catch {
    return null;
  }
}

export function activityCaption(row: ActivityRow): ActivityCaption {
  switch (row.verb) {
    case "sst_status_changed": {
      const payload = parsePayload<StatusPayload>(row.payload_json);
      if (payload?.to && STATUS_LABELS[payload.to]) {
        return { text: "Set to", statusLabel: STATUS_LABELS[payload.to], statusColor: payload.to };
      }
      return { text: "Updated status" };
    }
    case "attempt_logged":
      return { text: "Logged an attempt" };
    case "attempt_edited":
      return { text: "Edited an attempt" };
    case "attempt_deleted":
      return { text: "Deleted an attempt" };
    case "video_watched":
      return { text: row.video_title ? `Watched ${row.video_title}` : "Watched a video" };
    case "video_added":
      return { text: row.video_title ? `Added ${row.video_title}` : "Added a video" };
    case "video_visibility_set":
      return { text: "Changed video visibility" };
    case "sst_student_notes_edited":
      return { text: "Updated student notes" };
    case "sst_coach_notes_edited":
      return { text: "Updated coach notes" };
    case "technique_pinned":
      return { text: "Pinned" };
    case "technique_unpinned":
      return { text: "Unpinned" };
    case "sst_unhidden":
      return { text: "Made visible" };
    case "sst_hidden":
      return { text: "Hidden" };
    // Technique-into-container verbs: the container (syllabus) is named + linked
    // by the breadcrumb and the technique sits in the embedded row, so the
    // caption is just the bare verb.
    case "sst_added":
      return { text: "Added" };
    case "syllabus_technique_added":
      return { text: "Added" };
    case "syllabus_technique_removed":
      return { text: "Removed" };
    case "technique_edited":
      return { text: "Edited" };
    // Syllabus-wide events: the syllabus is named + linked by the breadcrumb,
    // so the caption is just the bare verb.
    case "syllabus_assigned":
      return { text: "Assigned" };
    case "syllabus_unassigned":
      return { text: "Unassigned" };
    case "syllabus_graduated":
      return { text: "Graduated" };
    case "camp_technique_added":
      // The technique is shown in the embedded row; the camp is named in the
      // breadcrumb. Caption is just the bare verb.
      return { text: "Added" };
    case "thread_comment_posted":
      return { text: "Commented" };
    // Camp / competition / match epic: the camp or competition is named + linked
    // by the breadcrumb, so the caption is a clean past-tense verb (the narrative
    // activityLine verbs dangle a preposition once their trailing noun is dropped).
    case "camp_created":
      return { text: "Started" };
    case "camp_archived":
      return { text: "Archived" };
    case "competition_created":
      return { text: "Created" };
    case "student_registered":
      return { text: "Registered" };
    case "camp_promoted_to_competition":
      return { text: "Promoted a camp" };
    case "match_logged":
      return { text: "Logged a match" };
    case "match_technique_linked":
      return { text: "Linked to a match" };
    default:
      // Plain narrative verb fallback for any verb without a tailored caption.
      return { text: activityLine(row).verb };
  }
}
