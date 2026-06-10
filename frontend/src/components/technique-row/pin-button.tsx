import { Pin, PinOff } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useUser } from "@/lib/current-user-context";
import { usePinTechnique, useUnpinTechnique } from "@/lib/mutations";
import { useTechniqueRow } from "./technique-row-context";

// Renders for global-library and student-pinned surfaces. Resolves the
// owning student: in student-pinned and student-syllabus contexts the
// studentId is on the context. In global-library context the visibility
// registry only renders this block for student viewers, so the owning
// student is the viewer.
export function PinButton() {
  const { context, technique, viewerIsOwner } = useTechniqueRow();
  const user = useUser();
  const studentId =
    context.kind === "student-pinned" || context.kind === "student-syllabus"
      ? context.studentId
      : user.id;

  const pinMutation = usePinTechnique(studentId);
  const unpinMutation = useUnpinTechnique(studentId);

  if (!viewerIsOwner) return null;

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
