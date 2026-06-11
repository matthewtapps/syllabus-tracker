import { toast } from "sonner";
import { StatusToggle } from "@/components/status-toggle";
import { useUpdateStudentSyllabusTechnique } from "@/lib/mutations";
import type { Status } from "@/lib/status";
import { useGraduatedConfirm } from "./graduated-guard";
import { useTechniqueRow } from "./technique-row-context";

// Status toggle for student-syllabus rows. The owning student and any
// coach can flip status; backend gates it (the SST PATCH route applies
// the per-field permission policy).
export function StatusBlock() {
  const { context, role } = useTechniqueRow();
  const mutation = useUpdateStudentSyllabusTechnique();
  const confirmGraduated = useGraduatedConfirm();
  if (context.kind !== "student-syllabus") return null;
  // Status is coach-controlled: students cannot self-assess their
  // progression. The backend rejects student PATCH with status set.
  if (role === "student") return null;
  const { sst, studentId, syllabusId } = context;

  async function handleChange(next: Status) {
    if (!(await confirmGraduated())) return;
    try {
      await mutation.mutateAsync({
        sstId: sst.id,
        studentId,
        syllabusId,
        data: { status: next },
      });
    } catch {
      toast.error("Failed to update status");
    }
  }

  return (
    <StatusToggle
      value={sst.status as Status}
      onChange={handleChange}
      disabled={mutation.isPending}
      size="sm"
    />
  );
}
