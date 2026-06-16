import { Library } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { usePromoteTechniqueToGlobal } from "@/lib/mutations";
import { useTechniqueRow } from "./technique-row-context";

// Coach-only action on a student's syllabus row, shown only for student-only
// (non-global) techniques: promotes the technique into the global library.
// Self-hides once the row refetches with is_global=true.
export function PromoteToLibraryButton() {
  const { context, role } = useTechniqueRow();
  const mutation = usePromoteTechniqueToGlobal();
  if (context.kind !== "student-syllabus") return null;
  if (role !== "coach" && role !== "admin") return null;
  if (context.sst.is_global) return null;

  const { sst, studentId, syllabusId } = context;

  async function handleClick(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    try {
      await mutation.mutateAsync({
        techniqueId: sst.technique_id,
        studentId,
        syllabusId,
      });
      toast.success(`${sst.technique_name} added to the library`);
    } catch {
      toast.error("Failed to add to library");
    }
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={mutation.isPending}
      onClick={handleClick}
    >
      <Library className="mr-2 h-4 w-4" aria-hidden />
      Move to global library
    </Button>
  );
}
