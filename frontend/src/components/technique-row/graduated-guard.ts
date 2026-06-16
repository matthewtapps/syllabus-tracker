import { useConfirm } from "@/components/confirm-context";
import { useTechniqueRow } from "./technique-row-context";

/**
 * Returns an async guard function. Coach call sites should await it before
 * firing any mutation that writes to a graduated assignment; it resolves
 * true when the operation may proceed, false when the user cancelled.
 * Non-coach viewers cannot reach these mutations (backend rejects), so
 * the guard resolves true immediately for them. Outside student-syllabus
 * context the guard is also a no-op.
 *
 * Uses the app-wide ConfirmProvider (mounted in AuthedAppShell) to show a
 * styled AlertDialog instead of a browser-native window.confirm prompt.
 */
export function useGraduatedConfirm(): () => Promise<boolean> {
  const { context, role } = useTechniqueRow();
  const confirm = useConfirm();
  const isCoach = role === "coach" || role === "admin";
  const graduatedAt =
    context.kind === "student-syllabus" ? context.graduatedAt : null;
  return () => {
    if (!isCoach || !graduatedAt) return Promise.resolve(true);
    return confirm({
      title: "Edit a graduated syllabus?",
      description:
        "This student has graduated this syllabus. Any changes you make apply to their completed record right away.",
      confirmLabel: "Edit anyway",
      cancelLabel: "Cancel",
    });
  };
}
