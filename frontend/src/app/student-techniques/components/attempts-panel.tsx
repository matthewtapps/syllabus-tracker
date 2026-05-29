import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { MoreVerticalIcon, PencilIcon } from "lucide-react";
import {
  type Attempt,
  type AttemptBucket,
  deleteAttempt,
  updateAttempt,
} from "@/lib/api";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { formatRelative } from "@/lib/dates";
import { AttemptSparkline } from "./attempt-sparkline";

interface AttemptsPanelProps {
  studentTechniqueId: number;
  studentId: number;
  currentUserId: number;
  isCoachOrAdmin: boolean;
  /** Source of truth for the attempt list. Null = still loading. */
  attempts: Attempt[] | null;
  error: string | null;
  onAttemptUpdated: (updated: Attempt) => void;
  onAttemptRemoved: (id: number) => void;
}

const HISTORY_PREVIEW_LIMIT = 5;

export function AttemptsPanel({
  studentTechniqueId,
  studentId,
  currentUserId,
  isCoachOrAdmin,
  attempts,
  error,
  onAttemptUpdated,
  onAttemptRemoved,
}: AttemptsPanelProps) {
  // Derive the sparkline from the same attempt list, so a newly logged attempt
  // shows up in the chart without a separate fetch.
  const buckets = useMemo<AttemptBucket[]>(
    () => deriveWeeklyBuckets(attempts ?? [], 12),
    [attempts],
  );

  const previewed = attempts?.slice(0, HISTORY_PREVIEW_LIMIT) ?? [];
  const overflow = (attempts?.length ?? 0) - previewed.length;

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Attempts
        </h3>
        <AttemptSparkline buckets={buckets} weeks={12} />
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}
      {!error && attempts === null && (
        <p className="text-sm text-muted-foreground">Loading attempts...</p>
      )}
      {!error && attempts !== null && attempts.length === 0 && (
        <p className="text-sm italic text-muted-foreground">
          No attempts logged yet.
        </p>
      )}

      {previewed.length > 0 && (
        <ul className="space-y-2">
          {previewed.map((a) => (
            <AttemptRow
              key={a.id}
              attempt={a}
              currentUserId={currentUserId}
              isCoachOrAdmin={isCoachOrAdmin}
              onUpdate={onAttemptUpdated}
              onRemoved={() => onAttemptRemoved(a.id)}
            />
          ))}
        </ul>
      )}

      {overflow > 0 && (
        <div className="text-right">
          <Button asChild variant="link" size="sm" className="h-auto p-0 text-xs">
            <Link
              to={`/student/${studentId}/technique/${studentTechniqueId}`}
            >
              View all {attempts?.length} attempts
            </Link>
          </Button>
        </div>
      )}
    </section>
  );
}

interface AttemptRowProps {
  attempt: Attempt;
  currentUserId: number;
  isCoachOrAdmin: boolean;
  onUpdate: (next: Attempt) => void;
  onRemoved: () => void;
}

function AttemptRow({
  attempt,
  currentUserId,
  isCoachOrAdmin,
  onUpdate,
  onRemoved,
}: AttemptRowProps) {
  const [editingNote, setEditingNote] = useState(false);
  const [editingDate, setEditingDate] = useState(false);

  const canEditDate = isCoachOrAdmin || attempt.recorded_by_id === currentUserId;
  const canDelete = isCoachOrAdmin || attempt.recorded_by_id === currentUserId;
  const myNote = isCoachOrAdmin ? attempt.coach_note : attempt.student_note;

  async function handleDelete() {
    const response = await deleteAttempt(attempt.id);
    if (response.ok) {
      onRemoved();
    } else {
      toast.error("Could not remove attempt");
    }
  }

  return (
    <li className="rounded-md border border-border bg-background/40 px-3 py-2 text-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-xs text-muted-foreground">
            {formatRelative(attempt.attempted_at)}
            {attempt.recorded_by_name && ` · ${attempt.recorded_by_name}`}
          </p>
          {attempt.student_note && (
            <p className="mt-1 whitespace-pre-wrap text-sm">
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Student:
              </span>{" "}
              {attempt.student_note}
            </p>
          )}
          {attempt.coach_note && (
            <p className="mt-1 whitespace-pre-wrap text-sm">
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Coach:
              </span>{" "}
              {attempt.coach_note}
            </p>
          )}
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-7 w-7">
              <MoreVerticalIcon className="h-3.5 w-3.5" aria-hidden />
              <span className="sr-only">Attempt actions</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => setEditingNote(true)}>
              <PencilIcon className="mr-2 h-3.5 w-3.5" aria-hidden />
              {myNote ? "Edit my note" : "Add my note"}
            </DropdownMenuItem>
            {canEditDate && (
              <DropdownMenuItem onClick={() => setEditingDate(true)}>
                Edit date
              </DropdownMenuItem>
            )}
            {canDelete && (
              <DropdownMenuItem
                onClick={handleDelete}
                className="text-destructive"
              >
                Remove
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {editingNote && (
        <NoteEditor
          attempt={attempt}
          isCoachOrAdmin={isCoachOrAdmin}
          onCancel={() => setEditingNote(false)}
          onSaved={(next) => {
            onUpdate(next);
            setEditingNote(false);
          }}
        />
      )}

      {editingDate && (
        <DateEditor
          attempt={attempt}
          onCancel={() => setEditingDate(false)}
          onSaved={(next) => {
            onUpdate(next);
            setEditingDate(false);
          }}
        />
      )}
    </li>
  );
}

interface NoteEditorProps {
  attempt: Attempt;
  isCoachOrAdmin: boolean;
  onCancel: () => void;
  onSaved: (next: Attempt) => void;
}

function NoteEditor({ attempt, isCoachOrAdmin, onCancel, onSaved }: NoteEditorProps) {
  const existing = isCoachOrAdmin
    ? attempt.coach_note ?? ""
    : attempt.student_note ?? "";
  const [value, setValue] = useState(existing);
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    if (saving) return;
    setSaving(true);
    const trimmed = value.trim();
    const response = await updateAttempt(attempt.id, {
      note: trimmed,
      clear_note: trimmed.length === 0,
    });
    setSaving(false);
    if (!response.ok) {
      toast.error("Could not save note");
      return;
    }
    const next: Attempt = isCoachOrAdmin
      ? { ...attempt, coach_note: trimmed || null }
      : { ...attempt, student_note: trimmed || null };
    onSaved(next);
  }

  return (
    <div className="mt-2 space-y-2">
      <Label className="text-xs">Your note</Label>
      <Textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        rows={3}
        autoFocus
      />
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="button" size="sm" disabled={saving} onClick={handleSave}>
          {saving ? "Saving..." : "Save"}
        </Button>
      </div>
    </div>
  );
}

interface DateEditorProps {
  attempt: Attempt;
  onCancel: () => void;
  onSaved: (next: Attempt) => void;
}

function DateEditor({ attempt, onCancel, onSaved }: DateEditorProps) {
  const initial = attempt.attempted_at.slice(0, 10);
  const [value, setValue] = useState(initial);
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    if (saving) return;
    setSaving(true);
    const iso = new Date(`${value}T12:00:00Z`).toISOString();
    const response = await updateAttempt(attempt.id, { attempted_at: iso });
    setSaving(false);
    if (!response.ok) {
      toast.error("Could not update date");
      return;
    }
    onSaved({ ...attempt, attempted_at: iso });
  }

  return (
    <div className="mt-2 flex items-end gap-2">
      <div className="space-y-1">
        <Label className="text-xs">Attempt date</Label>
        <Input
          type="date"
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
      </div>
      <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
        Cancel
      </Button>
      <Button type="button" size="sm" disabled={saving} onClick={handleSave}>
        {saving ? "Saving..." : "Save"}
      </Button>
    </div>
  );
}

function deriveWeeklyBuckets(attempts: Attempt[], weeks: number): AttemptBucket[] {
  if (attempts.length === 0) return [];
  const counts = new Map<string, number>();
  for (const a of attempts) {
    const d = new Date(a.attempted_at);
    const monday = isoWeekMondayUtc(d);
    const key = monday.toISOString().slice(0, 10);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  // Only keep buckets within the last `weeks` weeks so we don't ship the whole
  // history to a sparkline that only renders 12 columns.
  const cutoff = isoWeekMondayUtc(new Date());
  cutoff.setUTCDate(cutoff.getUTCDate() - (weeks - 1) * 7);
  const result: AttemptBucket[] = [];
  for (const [date, count] of counts) {
    if (new Date(date) >= cutoff) result.push({ date, count });
  }
  result.sort((a, b) => a.date.localeCompare(b.date));
  return result;
}

function isoWeekMondayUtc(d: Date): Date {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = date.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  date.setUTCDate(date.getUTCDate() + diff);
  return date;
}
