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
    };

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
}

const SYLLABUS_SCOPED_VERBS = new Set([
  "attempt_logged",
  "attempt_edited",
  "attempt_deleted",
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
  if (row.verb === "video_watched") {
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
  if (SYLLABUS_SCOPED_VERBS.has(row.verb)) {
    return syllabusContext(row);
  }
  return null;
}
