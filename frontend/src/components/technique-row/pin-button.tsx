import { Pin, PinOff } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useUser } from "@/lib/current-user-context";
import { usePinTechnique, useUnpinTechnique } from "@/lib/mutations";
import { useTechniqueRow } from "./technique-row-context";

// Icon-only pin/unpin toggle. Renders inside the row chrome (next to the
// chevron) for student viewers on:
//   - global-library: toggle pin state in place
//   - student-pinned: unpin only (everything in this list is already
//     pinned); the listing page intercepts via context.onUnpinIntent to
//     animate the row out and offer an Undo toast.
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
  const intercept =
    context.kind === "student-pinned" ? context.onUnpinIntent : undefined;

  async function handleClick(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    try {
      if (pinned) {
        if (intercept) {
          intercept(technique);
          return;
        }
        await unpinMutation.mutateAsync(technique.id);
        toast.success(`Unpinned ${technique.name}`, {
          action: {
            label: "Undo",
            onClick: () => {
              pinMutation.mutate(technique);
            },
          },
        });
      } else {
        await pinMutation.mutateAsync(technique);
        toast.success(`Pinned ${technique.name}`, {
          action: {
            label: "Undo",
            onClick: () => {
              unpinMutation.mutate(technique.id);
            },
          },
        });
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update pin");
    }
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      onClick={handleClick}
      disabled={busy}
      aria-pressed={pinned}
      aria-label={pinned ? "Unpin technique" : "Pin technique"}
      className="h-8 w-8 text-muted-foreground hover:text-foreground"
    >
      {pinned ? (
        <PinOff className="h-4 w-4" aria-hidden />
      ) : (
        <Pin className="h-4 w-4" aria-hidden />
      )}
    </Button>
  );
}
