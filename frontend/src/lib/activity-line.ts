/**
 * Shared per-verb activity renderer.
 *
 * Maps an ActivityRow (verb + joined entity names + parsed payload_json) to a
 * display line used by the dashboard, student recent-activity surface, and the
 * full activity page. Pure function; does not throw.
 *
 * ActivityLine shape:
 *   verb    - bold phrase, e.g. "logged an attempt on"
 *   subject - trailing entity name in normal weight (when copy ends with it)
 *   href    - deep-link URL (computed via rowToViewContext, with verb-specific
 *             fallbacks for pins and assignment/curation verbs)
 */

import { rowToViewContext, viewContextHref } from "./view-context";
import { refToken } from "./entity-ref";

/** Canonical ActivityRow type. Exported so api.ts and callers can import it
 *  rather than re-declaring an identical shape. */
export interface ActivityRow {
  id: number;
  occurred_at: string;
  verb: string;
  actor_user_id: number;
  actor_name: string | null;
  target_student_id: number | null;
  technique_id: number | null;
  technique_name: string | null;
  syllabus_id: number | null;
  syllabus_name: string | null;
  sst_id: number | null;
  video_id: number | null;
  video_title: string | null;
  payload_json: string | null;
  unread: boolean;
  context_kind: string | null;
  thread_id: number | null;
}

export interface ActivityLine {
  /** Bold phrase, e.g. "logged an attempt on". */
  verb: string;
  /** Trailing entity name in normal weight, when the copy ends with it. */
  subject?: string;
  /** Secondary line under the verb (e.g. the video title for "added a video
   *  to {technique}"). Rendered on its own line by the feed. */
  detail?: string;
  href?: string;
}

// Payload shapes mirror the Rust payload constructors in db/activity.rs.
interface SstStatusChangedPayload {
  from: "red" | "amber" | "green";
  to: "red" | "amber" | "green";
}

function parsePayload<T>(json: string | null): T | null {
  if (!json) return null;
  try {
    return JSON.parse(json) as T;
  } catch {
    return null;
  }
}

/** Deep-link href for a row: the typed ViewContext when resolvable, else the
 *  verb-specific fallback. */
function contextHref(row: ActivityRow): string | undefined {
  const ctx = rowToViewContext(row);
  return ctx ? viewContextHref(ctx) : undefined;
}

function pinnedHref(row: ActivityRow): string | undefined {
  if (row.target_student_id == null) return undefined;
  const base = `/student/${row.target_student_id}/pinned`;
  // Deep-link to the specific technique row so the pinned page expands and
  // scrolls to it (matches the syllabus/library deep links).
  return row.technique_id != null
    ? `${base}?focus=${refToken({ type: "technique", id: row.technique_id })}`
    : base;
}

function syllabusHref(row: ActivityRow): string | undefined {
  return row.syllabus_id != null ? `/syllabi/${row.syllabus_id}` : undefined;
}

/** Library deep-link for a video that is not tied to a watch context (added /
 *  visibility changed). Mirrors the pre-existing behavior in the new token form. */
function libraryVideoHref(row: ActivityRow): string | undefined {
  if (row.video_id == null) return undefined;
  if (row.technique_id != null) {
    return `/library?focus=technique:${row.technique_id}&video=${row.video_id}`;
  }
  return "/library";
}

/**
 * Maps an ActivityRow to a display line (verb + optional subject + optional
 * deep-link href). Never throws; falls back to plain copy when payload is
 * missing or malformed.
 */
export function activityLine(row: ActivityRow): ActivityLine {
  const tech = row.technique_name ?? undefined;
  const syll = row.syllabus_name ?? undefined;
  const vid = row.video_title ?? undefined;
  const deep = contextHref(row);

  switch (row.verb) {
    // --- attempt verbs ---
    case "attempt_logged":
      return tech
        ? { verb: "logged an attempt on", subject: tech, href: deep }
        : { verb: "logged an attempt" };
    case "attempt_edited":
      return tech
        ? { verb: "edited an attempt on", subject: tech, href: deep }
        : { verb: "edited an attempt" };
    case "attempt_deleted":
      return tech
        ? { verb: "deleted an attempt on", subject: tech, href: deep }
        : { verb: "deleted an attempt" };

    // --- video verbs ---
    case "video_watched":
      return vid
        ? { verb: "watched", subject: vid, href: deep }
        : { verb: "watched a video" };
    case "video_added":
      // Name the technique the video landed on, with the title on its own line.
      if (vid && tech)
        return { verb: "added a video to", subject: tech, detail: vid, href: libraryVideoHref(row) };
      if (vid) return { verb: "added a video", detail: vid, href: libraryVideoHref(row) };
      return { verb: "added a video" };
    case "video_visibility_set":
      return vid
        ? { verb: "changed visibility of", subject: vid, href: libraryVideoHref(row) }
        : { verb: "changed video visibility" };

    // --- sst status ---
    case "sst_status_changed": {
      const payload = parsePayload<SstStatusChangedPayload>(row.payload_json);
      if (payload?.to && tech) {
        return { verb: `went ${payload.to} on`, subject: tech, href: deep };
      }
      return tech
        ? { verb: "updated status on", subject: tech, href: deep }
        : { verb: "updated a technique status" };
    }

    // --- sst notes ---
    case "sst_student_notes_edited":
      return tech
        ? { verb: "updated student notes on", subject: tech, href: deep }
        : { verb: "updated student notes" };
    case "sst_coach_notes_edited":
      return tech
        ? { verb: "updated coach notes on", subject: tech, href: deep }
        : { verb: "updated coach notes" };

    // --- pin verbs ---
    case "technique_pinned":
      return tech
        ? { verb: "pinned", subject: tech, href: pinnedHref(row) }
        : { verb: "pinned a technique" };
    case "technique_unpinned":
      return tech
        ? { verb: "unpinned", subject: tech, href: pinnedHref(row) }
        : { verb: "unpinned a technique" };

    // --- syllabus assignment verbs ---
    case "syllabus_assigned":
      return syll
        ? { verb: "assigned to", subject: syll, href: syllabusHref(row) }
        : { verb: "assigned to a syllabus" };
    case "syllabus_unassigned":
      return syll
        ? { verb: "unassigned from", subject: syll, href: syllabusHref(row) }
        : { verb: "unassigned from a syllabus" };
    case "syllabus_graduated":
      return syll
        ? { verb: "graduated", subject: syll, href: syllabusHref(row) }
        : { verb: "graduated a syllabus" };

    // --- sst curation verbs ---
    case "sst_added":
      return tech
        ? { verb: `added ${tech} to syllabus`, href: syllabusHref(row) }
        : { verb: "added a technique to syllabus" };
    case "sst_hidden":
      return tech ? { verb: "hid", subject: tech } : { verb: "hid a technique" };
    case "sst_unhidden":
      return tech ? { verb: "unhid", subject: tech } : { verb: "unhid a technique" };

    // --- syllabus technique fanout verbs ---
    case "syllabus_technique_added":
      if (tech && syll) {
        // both names are essential; neither alone is the trailing subject
        return { verb: `added ${tech} to ${syll}`, href: syllabusHref(row) };
      }
      return tech
        ? { verb: `added ${tech} to a syllabus`, href: syllabusHref(row) }
        : { verb: "added a technique to a syllabus" };
    case "syllabus_technique_removed":
      if (tech && syll) {
        // both names are essential; neither alone is the trailing subject
        return { verb: `removed ${tech} from ${syll}`, href: syllabusHref(row) };
      }
      return tech
        ? { verb: `removed ${tech} from a syllabus`, href: syllabusHref(row) }
        : { verb: "removed a technique from a syllabus" };

    // --- technique edited fanout ---
    case "technique_edited":
      return tech ? { verb: "edited", subject: tech } : { verb: "edited a technique" };

    // --- thread verbs ---
    case "thread_comment_posted": {
      const ctx = rowToViewContext(row);
      // Land on the anchor surface, then target the specific thread. The
      // surface href always carries a `?focus=`, so `&thread=` is safe to
      // append. The receiving surface scrolls to and highlights the thread.
      let href = ctx ? viewContextHref(ctx) : undefined;
      if (href && row.thread_id != null) {
        href += `&thread=${row.thread_id}`;
      }
      return {
        verb: "commented on",
        // Prefer the video title for video comments (the comment names the
        // video, not its technique); fall back to the technique otherwise.
        subject: row.video_title ?? row.technique_name ?? undefined,
        href,
      };
    }

    default:
      return { verb: "performed an action" };
  }
}
