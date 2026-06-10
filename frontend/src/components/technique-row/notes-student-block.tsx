import { useEffect, useRef, useState } from "react";
import { Pencil } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useUpdateStudentSyllabusTechnique } from "@/lib/mutations";
import { useTechniqueRow } from "./technique-row-context";

// MY NOTES (when the viewer is the owning student) or "Student notes"
// (when the viewer is a coach). Inline editor with debounced save: the
// student types freely, and the change commits when they stop typing or
// blur the field.
export function NotesStudentBlock() {
  const { context, viewerIsOwner, role } = useTechniqueRow();
  if (context.kind !== "student-syllabus") return null;
  const isCoach = role === "coach" || role === "admin";
  const editable = viewerIsOwner; // Coach edits go via the coach-notes block.
  const heading = viewerIsOwner ? "My notes" : isCoach ? "Student notes" : "Notes";
  return <NotesEditor heading={heading} editable={editable} field="student_notes" />;
}

export function NotesCoachBlock() {
  const { context, role } = useTechniqueRow();
  if (context.kind !== "student-syllabus") return null;
  const isCoach = role === "coach" || role === "admin";
  return (
    <NotesEditor
      heading="Coach notes"
      editable={isCoach}
      field="coach_notes"
    />
  );
}

function NotesEditor({
  heading,
  editable,
  field,
}: {
  heading: string;
  editable: boolean;
  field: "student_notes" | "coach_notes";
}) {
  const { context } = useTechniqueRow();
  const isStudentSyllabus = context.kind === "student-syllabus";
  const sst = isStudentSyllabus ? context.sst : null;
  const studentId = isStudentSyllabus ? context.studentId : 0;
  const syllabusId = isStudentSyllabus ? context.syllabusId : 0;
  const seedValue = sst
    ? field === "student_notes"
      ? sst.student_notes
      : sst.coach_notes
    : "";
  const [value, setValue] = useState(seedValue);
  const [editing, setEditing] = useState(false);
  const initialRef = useRef(seedValue);
  const mutation = useUpdateStudentSyllabusTechnique();

  // Re-seed when switching rows (different sst id).
  useEffect(() => {
    setValue(seedValue);
    initialRef.current = seedValue;
    setEditing(false);
  }, [sst?.id, seedValue]);

  if (!isStudentSyllabus || sst === null) return null;
  const sstId = sst.id;

  const handleSave = async () => {
    if (value === initialRef.current) {
      setEditing(false);
      return;
    }
    try {
      await mutation.mutateAsync({
        sstId,
        studentId,
        syllabusId,
        data: { [field]: value },
      });
      initialRef.current = value;
      setEditing(false);
    } catch {
      toast.error("Failed to save notes");
    }
  };

  if (!editable && !value.trim()) return null;

  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {heading}
        </h3>
        {editable && !editing && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground hover:text-foreground"
            onClick={() => setEditing(true)}
            aria-label={`Edit ${heading.toLowerCase()}`}
          >
            <Pencil className="h-3.5 w-3.5" aria-hidden />
          </Button>
        )}
      </div>
      {editing ? (
        <div className="space-y-2">
          <Textarea
            autoFocus
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="min-h-24"
          />
          <div className="flex justify-end gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setValue(initialRef.current);
                setEditing(false);
              }}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={mutation.isPending}
              onClick={handleSave}
            >
              {mutation.isPending ? "Saving..." : "Save"}
            </Button>
          </div>
        </div>
      ) : value.trim() ? (
        <p className="whitespace-pre-wrap text-sm leading-relaxed">{value}</p>
      ) : (
        <p className="text-sm italic text-muted-foreground">
          Nothing here yet.
        </p>
      )}
    </section>
  );
}
