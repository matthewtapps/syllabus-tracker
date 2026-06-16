import { Eye, EyeOff } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useSetSstHidden } from "@/lib/mutations";
import { useGraduatedConfirm } from "./graduated-guard";
import { useTechniqueRow } from "./technique-row-context";

// Coach-only hidden toggle for a student-syllabus row. Renders next to
// the chevron alongside any other chrome controls. Students never see
// this button; their listing already filters hidden SSTs server-side.
export function HiddenToggleButton() {
  const { context, role } = useTechniqueRow();
  const mutation = useSetSstHidden();
  const confirmGraduated = useGraduatedConfirm();
  if (context.kind !== "student-syllabus") return null;
  if (role !== "coach" && role !== "admin") return null;
  const { sst, studentId, syllabusId } = context;
  const hidden = sst.hidden_at !== null;

  async function handleClick(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!(await confirmGraduated())) return;
    try {
      await mutation.mutateAsync({
        sstId: sst.id,
        studentId,
        syllabusId,
        hidden: !hidden,
      });
      toast.success(
        hidden
          ? `Showing ${sst.technique_name} for this student`
          : `Hidden ${sst.technique_name} for this student`,
      );
    } catch {
      toast.error("Failed to update visibility");
    }
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      onClick={handleClick}
      disabled={mutation.isPending}
      aria-label={
        hidden
          ? `Show ${sst.technique_name} for this student`
          : `Hide ${sst.technique_name} for this student`
      }
      className="h-8 w-8 text-muted-foreground hover:text-foreground"
    >
      {hidden ? (
        <EyeOff className="h-4 w-4" aria-hidden />
      ) : (
        <Eye className="h-4 w-4" aria-hidden />
      )}
    </Button>
  );
}
