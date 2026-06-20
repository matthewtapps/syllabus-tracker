import type { EntityRef } from "./entity-ref";
import { refToken } from "./entity-ref";

/**
 * The surface a student was on when an activity happened (ActivityStreams
 * `context`). The discriminant picks the route; the refs fill the path and the
 * focus token. Add a member when a new surface arrives (camp, video_thread,
 * ...); the switch in viewContextHref then fails to compile until the new arm
 * is added.
 */
export type ViewContext =
  | { kind: "library"; technique: EntityRef; video?: EntityRef }
  | {
      kind: "syllabus";
      /** The student whose assignment this is. Omitted for gym-template edits
       *  (syllabus_technique_added/removed) that act on the syllabus itself. */
      student?: EntityRef;
      syllabus: EntityRef;
      /** The technique row to scroll to. Omitted for syllabus-level events
       *  (assignment/graduation) that target the surface, not one technique. */
      sst?: EntityRef;
      video?: EntityRef;
    }
  | { kind: "camp"; camp: EntityRef; video?: EntityRef };

/** The one place deep-link routing lives. Pure. */
export function viewContextHref(ctx: ViewContext): string {
  switch (ctx.kind) {
    case "library": {
      const video = ctx.video ? `&video=${ctx.video.id}` : "";
      return `/library?focus=${refToken(ctx.technique)}${video}`;
    }
    case "syllabus": {
      // Gym-template edits carry no student: link to the syllabus template page.
      const base = ctx.student
        ? `/student/${ctx.student.id}/syllabi/${ctx.syllabus.id}`
        : `/syllabi/${ctx.syllabus.id}`;
      // Syllabus-level events (assignment/graduation) carry no sst to focus.
      if (!ctx.sst) return base;
      const video = ctx.video ? `&video=${ctx.video.id}` : "";
      return `${base}?focus=${refToken(ctx.sst)}${video}`;
    }
    case "camp": {
      const video = ctx.video ? `&video=${ctx.video.id}` : "";
      return `/camps/${ctx.camp.id}?focus=${refToken(ctx.camp)}${video}`;
    }
  }
}

/** The bare surface a context lives on, WITHOUT the focus token that scrolls to
 *  a specific technique. Used by the feed's breadcrumb chip: clicking "White
 *  Belt Fundamentals" should land on the syllabus, not deep-link to the one
 *  technique the row acted on (the embedded tile already carries that). */
export function viewContextSurfaceHref(ctx: ViewContext): string {
  switch (ctx.kind) {
    case "library":
      return "/library";
    case "syllabus":
      return ctx.student
        ? `/student/${ctx.student.id}/syllabi/${ctx.syllabus.id}`
        : `/syllabi/${ctx.syllabus.id}`;
    case "camp":
      return `/camps/${ctx.camp.id}`;
  }
}

/** Minimal structural view of an ActivityRow, so this module does not depend
 *  on the full row type (avoids a cycle with activity-line.ts). */
export interface ViewContextRow {
  verb: string;
  context_kind: string | null;
  target_student_id: number | null;
  syllabus_id: number | null;
  sst_id: number | null;
  technique_id: number | null;
  video_id: number | null;
  camp_id: number | null;
}

const SYLLABUS_SCOPED_VERBS = new Set([
  "attempt_logged",
  "attempt_edited",
  "attempt_deleted",
  "sst_added",
  "sst_hidden",
  "sst_unhidden",
  "sst_status_changed",
  "sst_student_notes_edited",
  "sst_coach_notes_edited",
]);

/** Gym-template syllabus context for fanout edits (technique added to / removed
 *  from a syllabus template) that act on the syllabus itself, no student. */
function gymSyllabusContext(row: ViewContextRow): ViewContext | null {
  if (row.syllabus_id == null) return null;
  return { kind: "syllabus", syllabus: { type: "syllabus", id: row.syllabus_id } };
}

/** Surface-level syllabus context for syllabus-wide events (assignment,
 *  graduation) that target the student's syllabus, not one technique row. */
function syllabusSurfaceContext(row: ViewContextRow): ViewContext | null {
  if (row.target_student_id == null || row.syllabus_id == null) return null;
  return {
    kind: "syllabus",
    student: { type: "student", id: row.target_student_id },
    syllabus: { type: "syllabus", id: row.syllabus_id },
  };
}

function syllabusContext(row: ViewContextRow): ViewContext | null {
  if (
    row.target_student_id == null ||
    row.syllabus_id == null ||
    row.sst_id == null
  ) {
    return null;
  }
  return {
    kind: "syllabus",
    student: { type: "student", id: row.target_student_id },
    syllabus: { type: "syllabus", id: row.syllabus_id },
    sst: { type: "sst", id: row.sst_id },
    video: row.video_id != null ? { type: "video", id: row.video_id } : undefined,
  };
}

/**
 * Build a ViewContext from an activity row, or null when the row has no
 * resolvable deep-link target (the caller then falls back). Pure.
 */
export function rowToViewContext(row: ViewContextRow): ViewContext | null {
  // Camp rows carry context_kind="camp" regardless of verb (including
  // video_added), so this must be checked before the verb dispatch below or a
  // camp video row would fall into the library branch and misroute.
  if (row.context_kind === "camp" && row.camp_id != null) {
    return {
      kind: "camp",
      camp: { type: "camp", id: row.camp_id },
      video: row.video_id != null ? { type: "video", id: row.video_id } : undefined,
    };
  }
  if (
    row.verb === "video_watched" ||
    row.verb === "video_added" ||
    row.verb === "video_visibility_set"
  ) {
    if (row.context_kind === "syllabus") {
      return syllabusContext(row);
    }
    // library (or unspecified): needs the video's technique
    if (row.technique_id == null) return null;
    return {
      kind: "library",
      technique: { type: "technique", id: row.technique_id },
      video: row.video_id != null ? { type: "video", id: row.video_id } : undefined,
    };
  }
  // A library technique edit surfaces the global library technique row.
  if (row.verb === "technique_edited" && row.technique_id != null) {
    return {
      kind: "library",
      technique: { type: "technique", id: row.technique_id },
    };
  }
  // A thread comment routes to the surface its anchor lives on, tagged by the
  // backend via context_kind: "syllabus" -> the student's syllabus sst row,
  // "library" -> the library technique row. A broadcast sst thread carries no
  // student on the row, so syllabusContext returns null and the caller falls
  // back to no deep link.
  if (row.verb === "thread_comment_posted") {
    if (row.context_kind === "syllabus") {
      return syllabusContext(row);
    }
    if (row.context_kind === "library") {
      if (row.technique_id == null) return null;
      return {
        kind: "library",
        technique: { type: "technique", id: row.technique_id },
        video: row.video_id != null ? { type: "video", id: row.video_id } : undefined,
      };
    }
    return null;
  }
  if (SYLLABUS_SCOPED_VERBS.has(row.verb)) {
    return syllabusContext(row);
  }
  // Syllabus-wide events carry no sst; deep-link to the student's syllabus page
  // so the feed breadcrumb names and links the syllabus.
  if (
    row.verb === "syllabus_assigned" ||
    row.verb === "syllabus_unassigned" ||
    row.verb === "syllabus_graduated"
  ) {
    return syllabusSurfaceContext(row);
  }
  // Gym-template curation: name + link the syllabus the technique moved in/out of.
  if (
    row.verb === "syllabus_technique_added" ||
    row.verb === "syllabus_technique_removed"
  ) {
    return gymSyllabusContext(row);
  }
  return null;
}

export interface ActivitySurface {
  kind: ViewContext["kind"];
  /** Display label: the syllabus name for syllabus actions, "Global Technique
   *  Library" for global. */
  label: string;
}

/**
 * The surface chip for an activity row: derived from the same ViewContext model
 * so it stays consistent with the deep link, and extends with new kinds. Returns
 * null when there is no resolvable surface (no chip shown).
 */
export function activitySurface(
  row: ViewContextRow & {
    syllabus_name: string | null;
    camp_name?: string | null;
  },
): ActivitySurface | null {
  const ctx = rowToViewContext(row);
  if (!ctx) return null;
  if (ctx.kind === "syllabus") {
    return { kind: "syllabus", label: row.syllabus_name ?? "Syllabus" };
  }
  if (ctx.kind === "camp") {
    return { kind: "camp", label: row.camp_name ?? "Camp" };
  }
  return { kind: "library", label: "Global Technique Library" };
}

/**
 * Whether a row belongs to the camp epic that is hidden on production until the
 * epic ships. The single predicate both feeds use, so the gate can never drift
 * between them.
 */
export function isGatedEpicRow(
  row: ViewContextRow & { syllabus_name: string | null; camp_name?: string | null },
): boolean {
  return activitySurface(row)?.kind === "camp";
}
