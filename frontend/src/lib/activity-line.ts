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
import { STATUS_LABELS, type Status } from "./status";

/** Canonical ActivityRow type. Exported so api.ts and callers can import it
 *  rather than re-declaring an identical shape. */
export interface ActivityRow {
  id: number;
  occurred_at: string;
  verb: string;
  actor_user_id: number;
  actor_name: string | null;
  target_student_id: number | null;
  target_student_name: string | null;
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
  camp_id: number | null;
  camp_name: string | null;
  competition_id: number | null;
  competition_name: string | null;
  match_id: number | null;
  /** Coalesced thread_comment_posted rows: comment events on the thread (opener
   *  + replies). 1 for a lone thread, 0 for non-thread verbs. */
  comment_count: number;
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
  /** When true, the feed should not render the syllabus surface chip (the
   *  syllabus is already named inline). */
  suppressSurface?: boolean;
  /** For status-change lines: the user-facing status label rendered after the
   *  verb, preceded by a colour dot. */
  statusLabel?: string;
  /** The status value driving the dot colour (New=grey, Doing=amber, Done=green). */
  statusColor?: Status;
}

export type ActivityScope =
  | { kind: "gym" }
  | { kind: "student"; studentId: number };

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

function syllabusTechniqueHref(row: ActivityRow): string | undefined {
  if (row.syllabus_id == null || row.technique_id == null) return undefined;
  return `/syllabi/${row.syllabus_id}?focus=${refToken({ type: "technique", id: row.technique_id })}`;
}

function studentSyllabusHref(row: ActivityRow): string | undefined {
  if (row.target_student_id == null || row.syllabus_id == null) return undefined;
  return `/student/${row.target_student_id}/syllabi/${row.syllabus_id}`;
}

/** Library deep-link to a technique row (no video context). */
function libraryTechniqueHref(row: ActivityRow): string | undefined {
  if (row.technique_id == null) return undefined;
  return `/library?focus=${refToken({ type: "technique", id: row.technique_id })}`;
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
export function activityLine(row: ActivityRow, scope: ActivityScope = { kind: "gym" }): ActivityLine {
  const tech = row.technique_name ?? undefined;
  const syll = row.syllabus_name ?? undefined;
  const vid = row.video_title ?? undefined;
  const deep = contextHref(row);

  const isCoachAction =
    row.target_student_id != null && row.target_student_id !== row.actor_user_id;
  const surfaceImplicit =
    scope.kind === "student" && scope.studentId === row.target_student_id;
  const studentName =
    isCoachAction && row.target_student_name && !surfaceImplicit
      ? row.target_student_name
      : undefined;

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
      // Name the technique the video lives on (on its own line) so a bare
      // video title isn't left without context.
      if (vid && tech) return { verb: "watched", subject: vid, detail: `on ${tech}`, href: deep };
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
      const label = payload?.to ? STATUS_LABELS[payload.to] : undefined;
      if (label && tech && payload?.to) {
        if (studentName && syll) {
          return { verb: `set ${tech} to`, statusLabel: label, statusColor: payload.to, subject: `${studentName}'s ${syll}`, href: deep, suppressSurface: true };
        }
        return { verb: `set ${tech} to`, statusLabel: label, statusColor: payload.to, href: deep };
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
    case "syllabus_assigned": {
      const href = studentSyllabusHref(row) ?? syllabusHref(row);
      if (studentName && syll) {
        // Coach assigned a syllabus to a student (gym-wide surface names them).
        return { verb: `assigned ${syll} to`, subject: studentName, href };
      }
      return syll
        ? { verb: "assigned to", subject: syll, href }
        : { verb: "assigned to a syllabus" };
    }
    case "syllabus_unassigned":
      return syll
        ? { verb: "unassigned from", subject: syll, href: syllabusHref(row) }
        : { verb: "unassigned from a syllabus" };
    case "syllabus_graduated": {
      const href = studentSyllabusHref(row) ?? syllabusHref(row);
      if (studentName && syll) return { verb: "graduated", subject: `${studentName}'s ${syll}`, href };
      return syll
        ? { verb: "graduated", subject: syll, href }
        : { verb: "graduated a syllabus" };
    }

    // --- sst curation verbs ---
    case "sst_added":
      return tech
        ? { verb: `added ${tech} to syllabus`, href: deep ?? syllabusHref(row) }
        : { verb: "added a technique to syllabus" };
    case "sst_hidden":
      return tech ? { verb: "hid", subject: tech } : { verb: "hid a technique" };
    case "sst_unhidden":
      return tech ? { verb: "unhid", subject: tech } : { verb: "unhid a technique" };

    // --- syllabus technique fanout verbs ---
    case "syllabus_technique_added":
      if (tech && syll) {
        // both names are essential; neither alone is the trailing subject
        return { verb: `added ${tech} to ${syll}`, href: syllabusTechniqueHref(row) ?? syllabusHref(row) };
      }
      return tech
        ? { verb: `added ${tech} to a syllabus`, href: syllabusTechniqueHref(row) ?? syllabusHref(row) }
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
      return tech ? { verb: "edited", subject: tech, href: libraryTechniqueHref(row) } : { verb: "edited a technique" };

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
      // Prefer the video title for video comments (the comment names the
      // video, not its technique); fall back to the technique otherwise.
      const anchor = row.video_title ?? row.technique_name ?? undefined;
      if (anchor) {
        return { verb: "commented on", subject: anchor, href };
      }
      // Profile/broadcast comment: no technique or video anchor. Name the
      // student's profile when a coach acts from a mixed feed, otherwise just
      // say "left a comment" so the verb never dangles with a trailing "on".
      return studentName
        ? { verb: "commented on", subject: `${studentName}'s profile`, href }
        : { verb: "left a comment", href };
    }

    // --- camp verbs --- (camp_name comes from the read-layer join)
    case "camp_created": {
      const camp = row.camp_name ?? undefined;
      return camp
        ? { verb: "started", subject: camp, href: deep }
        : { verb: "started a camp", href: deep };
    }
    case "camp_technique_added": {
      const camp = row.camp_name ?? undefined;
      if (tech && camp) return { verb: `added ${tech} to`, subject: camp, href: deep };
      return camp
        ? { verb: "added a technique to", subject: camp, href: deep }
        : { verb: "added a technique to a camp", href: deep };
    }
    case "camp_archived": {
      const camp = row.camp_name ?? undefined;
      return camp
        ? { verb: "archived", subject: camp, href: deep }
        : { verb: "archived a camp", href: deep };
    }

    // --- competition verbs --- (competition_name comes from the read-layer join)
    case "competition_created": {
      const comp = row.competition_name ?? undefined;
      return comp
        ? { verb: "created", subject: comp, href: deep }
        : { verb: "created a competition", href: deep };
    }
    case "student_registered": {
      const comp = row.competition_name ?? undefined;
      return comp
        ? { verb: "registered for", subject: comp, href: deep }
        : { verb: "registered for a competition", href: deep };
    }
    case "camp_promoted_to_competition": {
      const comp = row.competition_name ?? undefined;
      return comp
        ? { verb: "linked a camp to", subject: comp, href: deep }
        : { verb: "linked camp to competition", href: deep };
    }

    // --- match verbs ---
    case "match_logged": {
      const comp = row.competition_name ?? undefined;
      return comp
        ? { verb: "logged a match at", subject: comp, href: deep }
        : { verb: "logged a match", href: deep };
    }
    case "match_technique_linked":
      return tech
        ? { verb: "linked", subject: tech, detail: "to a match", href: deep }
        : { verb: "linked a technique to a match", href: deep };

    default:
      return { verb: "performed an action" };
  }
}
