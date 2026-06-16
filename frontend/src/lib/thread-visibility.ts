import type { User } from "@/lib/api";
import type { ThreadVisibility } from "@/lib/api";

/**
 * Which surface a video player was opened on, as far as thread visibility is
 * concerned. Only one bit matters: is there a specific student in context.
 *  - library: global library or coach syllabus authoring (no student)
 *  - student: a student's pinned or syllabus view of the technique
 */
export type VideoThreadSurface =
  | { kind: "library" }
  | { kind: "student"; studentId: number };

export interface DerivedVisibility {
  visibility: ThreadVisibility;
  scope_student_id: number | null;
}

/**
 * Derive a new thread's visibility from the surface and the author's role.
 * Students always post privately scoped to themselves. Coaches broadcast on
 * the library (an announcement to everyone who can see the video) and post
 * privately scoped to the student on a student surface. Replies are not
 * covered here; they inherit the parent thread's visibility server-side.
 */
export function deriveThreadVisibility(
  surface: VideoThreadSurface,
  user: User,
): DerivedVisibility {
  if (user.role === "student") {
    return { visibility: "private", scope_student_id: user.id };
  }
  if (surface.kind === "student") {
    return { visibility: "private", scope_student_id: surface.studentId };
  }
  return { visibility: "broadcast", scope_student_id: null };
}
