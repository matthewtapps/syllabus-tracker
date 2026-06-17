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
      return { text: "Watched a video" };
    case "video_added":
      return { text: "Added a video" };
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
    case "sst_added":
      return { text: "Added to syllabus" };
    case "syllabus_technique_added":
      return { text: "Added to syllabus" };
    case "technique_edited":
      return { text: "Edited" };
    case "thread_comment_posted":
      return { text: "Commented" };
    default:
      // Plain narrative verb (covers syllabus assign/graduate, camp/competition,
      // etc. where there is no tile to lean on).
      return { text: activityLine(row).verb };
  }
}
