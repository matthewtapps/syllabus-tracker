import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, MoreVerticalIcon, PencilIcon } from "lucide-react";
import {
  type Attempt,
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
import { cn } from "@/lib/utils";
import { formatRelative } from "@/lib/dates";

interface AttemptsPanelProps {
  studentTechniqueId: number;
  studentId: number;
  currentUserId: number;
  isCoachOrAdmin: boolean;
  /** Source of truth for the attempt list. Null = still loading. */
  attempts: Attempt[] | null;
  error: string | null;
  /** Suppress the panel's own "Attempts" heading row when the parent renders one. */
  hideHeader?: boolean;
  onAttemptUpdated: (updated: Attempt) => void;
  onAttemptRemoved: (id: number) => void;
}

const HISTORY_PREVIEW_LIMIT = 5;
const RECENT_WINDOW_DAYS = 30;

export function AttemptsPanel({
  studentTechniqueId,
  studentId,
  currentUserId,
  isCoachOrAdmin,
  attempts,
  error,
  hideHeader = false,
  onAttemptUpdated,
  onAttemptRemoved,
}: AttemptsPanelProps) {
  const stats = useMemo(() => summariseRecency(attempts), [attempts]);

  const previewed = attempts?.slice(0, HISTORY_PREVIEW_LIMIT) ?? [];
  const overflow = (attempts?.length ?? 0) - previewed.length;
  const detailHref = `/student/${studentId}/technique/${studentTechniqueId}`;

  return (
    <section className="space-y-3">
      {!hideHeader && (
        <div className="flex items-baseline justify-between gap-3">
          <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Attempts
          </h3>
          {stats && (
            <p className="text-xs text-muted-foreground">
              <span className="font-medium text-foreground">{stats.recentCount}</span>{" "}
              in last {RECENT_WINDOW_DAYS} days
              {stats.lastLabel && (
                <>
                  {" "}
                  <span aria-hidden>·</span> last {stats.lastLabel}
                </>
              )}
            </p>
          )}
        </div>
      )}
      {hideHeader && stats && (
        <p className="text-xs text-muted-foreground">
          <span className="font-medium text-foreground">{stats.recentCount}</span>{" "}
          in last {RECENT_WINDOW_DAYS} days
          {stats.lastLabel && (
            <>
              {" "}
              <span aria-hidden>·</span> last {stats.lastLabel}
            </>
          )}
        </p>
      )}

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
        <ul className="divide-y divide-border rounded-md border border-border">
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
          <Button asChild variant="link" size="sm" className="h-auto gap-1 p-0 text-xs">
            <Link to={detailHref}>
              View all {attempts?.length} attempts
              <ArrowRight className="h-3 w-3" aria-hidden />
            </Link>
          </Button>
        </div>
      )}
    </section>
  );
}

function summariseRecency(
  attempts: Attempt[] | null,
): { recentCount: number; lastLabel: string | null } | null {
  if (!attempts || attempts.length === 0) return null;
  const now = Date.now();
  const cutoff = now - RECENT_WINDOW_DAYS * 86_400_000;
  let recentCount = 0;
  let mostRecent = 0;
  for (const a of attempts) {
    const t = Date.parse(a.attempted_at);
    if (!Number.isFinite(t)) continue;
    if (t >= cutoff) recentCount += 1;
    if (t > mostRecent) mostRecent = t;
  }
  return {
    recentCount,
    lastLabel: mostRecent > 0 ? formatRelative(new Date(mostRecent).toISOString()) : null,
  };
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

  const hasNotes = !!(attempt.student_note || attempt.coach_note);

  return (
    <li className="px-3 py-1.5 text-sm">
      <div
        className={cn(
          "flex justify-between gap-2",
          hasNotes ? "items-start" : "items-center",
        )}
      >
        <div className="min-w-0 flex-1">
          <p className="text-xs text-muted-foreground">
            {formatRelative(attempt.attempted_at)}
            {attempt.recorded_by_name && ` · ${attempt.recorded_by_name}`}
          </p>
          {attempt.student_note && (
            <p className="mt-1 whitespace-pre-wrap text-sm leading-snug">
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Student:
              </span>{" "}
              {attempt.student_note}
            </p>
          )}
          {attempt.coach_note && (
            <p className="mt-1 whitespace-pre-wrap text-sm leading-snug">
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Coach:
              </span>{" "}
              {attempt.coach_note}
            </p>
          )}
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="-mr-1.5 h-6 w-6 text-muted-foreground"
            >
              <MoreVerticalIcon className="h-3.5 w-3.5" aria-hidden />
              <span className="sr-only">Attempt actions</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              onSelect={() => setTimeout(() => setEditingNote(true), 0)}
            >
              <PencilIcon className="mr-2 h-3.5 w-3.5" aria-hidden />
              {myNote ? "Edit my note" : "Add my note"}
            </DropdownMenuItem>
            {canEditDate && (
              <DropdownMenuItem
                onSelect={() => setTimeout(() => setEditingDate(true), 0)}
              >
                Edit date
              </DropdownMenuItem>
            )}
            {canDelete && (
              <DropdownMenuItem
                onSelect={() => setTimeout(handleDelete, 0)}
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
    <div className="mt-2 space-y-2">
      <Label className="text-xs">Attempt date</Label>
      <Input
        type="date"
        value={value}
        onChange={(e) => setValue(e.target.value)}
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

