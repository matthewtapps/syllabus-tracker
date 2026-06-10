import { useTechniqueRow } from "./technique-row-context";

const MESSAGE =
  "This syllabus is graduated for the student. Edits go through immediately. Continue?";

/**
 * Returns a guard function. Coach call sites should invoke it before
 * firing any mutation that writes to a graduated assignment; it returns
 * `true` when the operation may proceed, `false` when the user cancelled.
 * Non-coach viewers can't reach these mutations (backend rejects), so
 * the guard simply returns `true` for them. Outside student-syllabus
 * context the guard is also a no-op.
 *
 * This is intentionally a window.confirm prompt rather than a styled
 * dialog. The flow is rare (coaches only, only on graduated assignments)
 * and per-mutation confirmation is what the plan calls for. A polished
 * dialog can replace this later without changing call sites.
 */
export function useGraduatedConfirm(): () => boolean {
  const { context, role } = useTechniqueRow();
  const isCoach = role === "coach" || role === "admin";
  const graduatedAt =
    context.kind === "student-syllabus" ? context.graduatedAt : null;
  return () => {
    if (!isCoach || !graduatedAt) return true;
    if (typeof window === "undefined") return true;
    return window.confirm(MESSAGE);
  };
}
