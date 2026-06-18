import type { EntityRef } from "./entity-ref";
import { refToken } from "./entity-ref";

/**
 * The surface a student was on when an activity happened (ActivityStreams
 * `context`). The discriminant picks the route; the refs fill the path and the
 * focus token. Add a member when a new surface arrives (camp, match,
 * video_thread, ...); the switch in viewContextHref then fails to compile until
 * the new arm is added.
 */
export type ViewContext =
  | { kind: "library"; technique: EntityRef; video?: EntityRef }
  | {
      kind: "syllabus";
      student: EntityRef;
      syllabus: EntityRef;
      sst: EntityRef;
      video?: EntityRef;
    }
  | { kind: "camp"; camp: EntityRef; video?: EntityRef }
  | { kind: "competition"; competition: EntityRef }
  // `match` is carried for a deferred scroll-to-match anchor on the camp page (Chunk B); not read yet.
  | { kind: "match"; camp: EntityRef; match: EntityRef };

/** The one place deep-link routing lives. Pure. */
export function viewContextHref(ctx: ViewContext): string {
  switch (ctx.kind) {
    case "library": {
      const video = ctx.video ? `&video=${ctx.video.id}` : "";
      return `/library?focus=${refToken(ctx.technique)}${video}`;
    }
    case "syllabus": {
      const video = ctx.video ? `&video=${ctx.video.id}` : "";
      return `/student/${ctx.student.id}/syllabi/${ctx.syllabus.id}?focus=${refToken(
        ctx.sst,
      )}${video}`;
    }
    case "camp": {
      const video = ctx.video ? `&video=${ctx.video.id}` : "";
      return `/camps/${ctx.camp.id}?focus=${refToken(ctx.camp)}${video}`;
    }
    case "competition": {
      return `/competitions/${ctx.competition.id}`;
    }
    case "match": {
      return `/camps/${ctx.camp.id}`;
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
      return `/student/${ctx.student.id}/syllabi/${ctx.syllabus.id}`;
    case "camp":
      return `/camps/${ctx.camp.id}`;
    case "competition":
      return `/competitions/${ctx.competition.id}`;
    case "match":
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
  competition_id: number | null;
  match_id: number | null;
}

const SYLLABUS_SCOPED_VERBS = new Set([
  "attempt_logged",
  "attempt_edited",
  "attempt_deleted",
  "sst_added",
  "sst_status_changed",
  "sst_student_notes_edited",
  "sst_coach_notes_edited",
]);

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
  // Competition-scoped verbs: all 5 new verbs set context_kind="competition".
  // Dispatch by verb: match verbs -> owning camp page; camp_promoted -> camp
  // page (the camp_id column is populated); else -> competition page.
  if (row.context_kind === "competition") {
    if (
      (row.verb === "match_logged" || row.verb === "match_technique_linked") &&
      row.match_id != null &&
      row.camp_id != null
    ) {
      return {
        kind: "match",
        camp: { type: "camp", id: row.camp_id },
        match: { type: "match", id: row.match_id },
      };
    }
    if (row.verb === "camp_promoted_to_competition" && row.camp_id != null) {
      return {
        kind: "camp",
        camp: { type: "camp", id: row.camp_id },
      };
    }
    if (row.competition_id != null) {
      return {
        kind: "competition",
        competition: { type: "competition", id: row.competition_id },
      };
    }
    return null;
  }
  if (row.verb === "video_watched" || row.verb === "video_added") {
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
  row: ViewContextRow & { syllabus_name: string | null; camp_name?: string | null },
): ActivitySurface | null {
  const ctx = rowToViewContext(row);
  if (!ctx) return null;
  if (ctx.kind === "syllabus") {
    return { kind: "syllabus", label: row.syllabus_name ?? "Syllabus" };
  }
  if (ctx.kind === "camp") {
    return { kind: "camp", label: row.camp_name ?? "Camp" };
  }
  if (ctx.kind === "competition") {
    return { kind: "competition", label: "Competition" };
  }
  if (ctx.kind === "match") {
    return { kind: "match", label: "Match" };
  }
  return { kind: "library", label: "Global Technique Library" };
}

/**
 * Whether a row belongs to the camp/competition/match epic that is hidden on
 * production until the epic ships. The single predicate both feeds use, so the
 * gate can never drift between them.
 */
export function isGatedEpicRow(
  row: ViewContextRow & { syllabus_name: string | null; camp_name?: string | null },
): boolean {
  const kind = activitySurface(row)?.kind;
  return kind === "camp" || kind === "competition" || kind === "match";
}
