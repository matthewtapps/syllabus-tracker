import { Pin, PinOff } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { usePinTechnique, useUnpinTechnique } from "@/lib/mutations";
import { useTechniqueRow } from "./technique-row-context";

// Renders for global-library and student-pinned surfaces. Resolves the
// owning student from row context: in student-pinned the studentId is on
// the context, in global-library the viewer is the student (we never
// render pin-button for coaches per the visibility registry).
export function PinButton() {
  const { context, technique, viewerIsOwner } = useTechniqueRow();
  // student-syllabus contexts never render this block (registry filters
  // it out), but the type narrowing needs the discriminant.
  const studentId =
    context.kind === "student-pinned" || context.kind === "student-syllabus"
      ? context.studentId
      : null;

  const pinMutation = usePinTechnique(studentId ?? 0);
  const unpinMutation = useUnpinTechnique(studentId ?? 0);

  if (!viewerIsOwner) return null;
  if (studentId === null) return null;

  const pinned = technique.is_pinned;
  const busy = pinMutation.isPending || unpinMutation.isPending;

  async function handleClick(e: React.MouseEvent) {
    e.stopPropagation();
    try {
      if (pinned) {
        await unpinMutation.mutateAsync(technique.id);
      } else {
        await pinMutation.mutateAsync(technique);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update pin");
    }
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={handleClick}
      disabled={busy}
      aria-pressed={pinned}
      aria-label={pinned ? "Unpin technique" : "Pin technique"}
      className="gap-1.5"
    >
      {pinned ? (
        <PinOff className="h-3.5 w-3.5" aria-hidden />
      ) : (
        <Pin className="h-3.5 w-3.5" aria-hidden />
      )}
      <span>{pinned ? "Unpin" : "Pin"}</span>
    </Button>
  );
}
