import { useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useSyllabusAttempts } from "@/lib/queries";
import {
  useCreateSyllabusAttempt,
  useDeleteSyllabusAttempt,
} from "@/lib/mutations";
import { useTechniqueRow } from "./technique-row-context";
import type { SyllabusAttempt } from "@/lib/api";

// Attempts logged against an SST. Coaches see notes from both sides;
// students see their own student_note plus any coach_note.
export function AttemptsBlock() {
  const { context, role } = useTechniqueRow();
  const sstId = context.kind === "student-syllabus" ? context.sst.id : 0;
  const isCoach = role === "coach" || role === "admin";
  const attemptsQuery = useSyllabusAttempts(
    context.kind === "student-syllabus" ? sstId : undefined,
  );
  const attempts = useMemo(
    () => attemptsQuery.data ?? [],
    [attemptsQuery.data],
  );
  const [adding, setAdding] = useState(false);
  if (context.kind !== "student-syllabus") return null;
  const sst = context.sst;

  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Attempts
        </h3>
        {!adding && (
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5"
            onClick={() => setAdding(true)}
          >
            <Plus className="h-3.5 w-3.5" aria-hidden />
            Attempt
          </Button>
        )}
      </div>
      {adding && (
        <AddAttemptForm
          sstId={sst.id}
          isCoach={isCoach}
          onDone={() => setAdding(false)}
        />
      )}
      {attemptsQuery.isLoading ? (
        <p className="text-xs text-muted-foreground">Loading...</p>
      ) : attempts.length === 0 ? (
        <p className="text-xs italic text-muted-foreground">
          No attempts logged yet.
        </p>
      ) : (
        <ul className="divide-y divide-border rounded-md border border-border">
          {attempts.map((a) => (
            <AttemptRow key={a.id} attempt={a} />
          ))}
        </ul>
      )}
    </section>
  );
}

function AddAttemptForm({
  sstId,
  isCoach,
  onDone,
}: {
  sstId: number;
  isCoach: boolean;
  onDone: () => void;
}) {
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const [date, setDate] = useState(today);
  const [note, setNote] = useState("");
  const mutation = useCreateSyllabusAttempt();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    try {
      // Local-midnight ISO so the date the user picked is the date the
      // server records, regardless of their UTC offset.
      const local = new Date(`${date}T00:00:00`);
      const attempted = local.toISOString();
      const payload: {
        attempted_at: string;
        coach_note?: string;
        student_note?: string;
      } = { attempted_at: attempted };
      if (note.trim()) {
        if (isCoach) payload.coach_note = note.trim();
        else payload.student_note = note.trim();
      }
      await mutation.mutateAsync({ sstId, data: payload });
      onDone();
    } catch {
      toast.error("Failed to log attempt");
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-2 rounded-md border border-border bg-card p-3"
    >
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <label className="space-y-1 text-xs">
          <span className="text-muted-foreground">When</span>
          <Input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            max={today}
            required
          />
        </label>
      </div>
      <label className="space-y-1 text-xs">
        <span className="text-muted-foreground">
          {isCoach ? "Coach note" : "Note"}
        </span>
        <Textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={3}
        />
      </label>
      <div className="flex justify-end gap-2">
        <Button type="button" size="sm" variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button size="sm" type="submit" disabled={mutation.isPending}>
          {mutation.isPending ? "Saving..." : "Log attempt"}
        </Button>
      </div>
    </form>
  );
}

function AttemptRow({ attempt }: { attempt: SyllabusAttempt }) {
  const { context } = useTechniqueRow();
  const deleteMutation = useDeleteSyllabusAttempt();
  const dateLabel = useMemo(() => {
    const d = new Date(attempt.attempted_at);
    return d.toLocaleDateString();
  }, [attempt.attempted_at]);
  if (context.kind !== "student-syllabus") return null;

  async function handleDelete() {
    try {
      await deleteMutation.mutateAsync({
        attemptId: attempt.id,
        sstId: context.kind === "student-syllabus" ? context.sst.id : 0,
      });
    } catch {
      toast.error("Failed to delete attempt");
    }
  }

  return (
    <li className="flex items-start justify-between gap-2 px-3 py-2 text-sm">
      <div className="min-w-0 flex-1 space-y-1">
        <p className="text-xs font-medium text-muted-foreground">{dateLabel}</p>
        {attempt.coach_note && (
          <p className="whitespace-pre-wrap text-sm">
            <span className="text-xs text-muted-foreground">Coach:</span>{" "}
            {attempt.coach_note}
          </p>
        )}
        {attempt.student_note && (
          <p className="whitespace-pre-wrap text-sm">
            <span className="text-xs text-muted-foreground">Student:</span>{" "}
            {attempt.student_note}
          </p>
        )}
      </div>
      <Button
        size="icon"
        variant="ghost"
        className="h-7 w-7 text-muted-foreground hover:text-destructive"
        onClick={handleDelete}
        aria-label="Delete attempt"
        disabled={deleteMutation.isPending}
      >
        <Trash2 className="h-3.5 w-3.5" aria-hidden />
      </Button>
    </li>
  );
}
