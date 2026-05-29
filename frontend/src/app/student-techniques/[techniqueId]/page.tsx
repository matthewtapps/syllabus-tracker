import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, MoreVerticalIcon, PencilIcon } from "lucide-react";
import { toast } from "sonner";
import {
  type Attempt,
  type AttemptBucket,
  type SingleStudentTechnique,
  deleteAttempt,
  getAttemptSparkline,
  getStudentTechniqueDetail,
  listAttempts,
  updateAttempt,
  type User,
} from "@/lib/api";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { PageHeader } from "@/components/page-header";
import { StatusPill } from "@/components/status-pill";
import { Skeleton } from "@/components/ui/skeleton";
import { formatRelative } from "@/lib/dates";
import type { Status } from "@/lib/status";

interface StudentTechniqueDetailProps {
  user: User;
}

export default function StudentTechniqueDetail({
  user,
}: StudentTechniqueDetailProps) {
  const { id, techniqueId } = useParams<{ id: string; techniqueId: string }>();
  const studentId = parseInt(id ?? "0", 10);
  const stId = parseInt(techniqueId ?? "0", 10);

  const [detail, setDetail] = useState<SingleStudentTechnique | null>(null);
  const [attempts, setAttempts] = useState<Attempt[] | null>(null);
  const [buckets, setBuckets] = useState<AttemptBucket[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [d, list, weekly] = await Promise.all([
          getStudentTechniqueDetail(stId),
          listAttempts(stId),
          getAttemptSparkline(stId, 52),
        ]);
        if (cancelled) return;
        setDetail(d);
        setAttempts(list);
        setBuckets(weekly);
      } catch (err) {
        if (cancelled) return;
        console.error(err);
        setError("Could not load technique");
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [stId]);

  const isCoachOrAdmin = !!detail?.can_edit_all_techniques;

  if (error) {
    return (
      <div className="container mx-auto px-4 py-6 sm:px-6 md:py-8">
        <p className="text-sm text-destructive">{error}</p>
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="container mx-auto space-y-4 px-4 py-6 sm:px-6 md:py-8">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  const technique = detail.technique;
  const status = technique.status as Status;

  function applyUpdate(next: Attempt) {
    setAttempts((prev) =>
      prev ? prev.map((a) => (a.id === next.id ? next : a)) : prev,
    );
  }

  function removeAttempt(id: number) {
    setAttempts((prev) => (prev ? prev.filter((a) => a.id !== id) : prev));
  }

  return (
    <div className="container mx-auto max-w-3xl px-4 py-6 sm:px-6 md:py-8">
      <div className="mb-4">
        <Button asChild variant="ghost" size="sm" className="-ml-3 h-8 gap-1.5 text-muted-foreground">
          <Link to={`/student/${studentId}?focus=${technique.id}`}>
            <ArrowLeft className="h-4 w-4" aria-hidden />
            Back to syllabus
          </Link>
        </Button>
      </div>

      <PageHeader
        title={technique.technique_name}
        actions={<StatusPill status={status} variant="solid" />}
      />

      <p className="mb-6 whitespace-pre-wrap text-sm text-muted-foreground">
        {technique.technique_description}
      </p>

      <section className="mb-8 space-y-2">
        <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Activity (last year)
        </h2>
        <YearBars buckets={buckets} />
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold">
          {attempts?.length ?? 0} {attempts?.length === 1 ? "attempt" : "attempts"}
        </h2>
        {attempts === null && (
          <p className="text-sm text-muted-foreground">Loading attempts...</p>
        )}
        {attempts !== null && attempts.length === 0 && (
          <p className="text-sm italic text-muted-foreground">
            No attempts logged yet.
          </p>
        )}
        {attempts && attempts.length > 0 && (
          <ul className="space-y-2">
            {attempts.map((a) => (
              <DetailAttemptRow
                key={a.id}
                attempt={a}
                currentUserId={user.id}
                isCoachOrAdmin={isCoachOrAdmin}
                onUpdate={applyUpdate}
                onRemoved={() => removeAttempt(a.id)}
              />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function YearBars({ buckets }: { buckets: AttemptBucket[] }) {
  const series = useMemo(() => {
    const map = new Map(buckets.map((b) => [b.date, b.count]));
    const today = new Date();
    const start = new Date(today);
    start.setUTCDate(start.getUTCDate() - 52 * 7);
    const day = start.getUTCDay();
    const diff = day === 0 ? -6 : 1 - day;
    start.setUTCDate(start.getUTCDate() + diff);
    const out: { key: string; count: number }[] = [];
    for (let i = 0; i < 52; i++) {
      const d = new Date(start);
      d.setUTCDate(d.getUTCDate() + i * 7);
      const key = d.toISOString().slice(0, 10);
      out.push({ key, count: map.get(key) ?? 0 });
    }
    return out;
  }, [buckets]);

  const max = Math.max(1, ...series.map((s) => s.count));
  const width = 52 * 10 + 51 * 2;
  const height = 60;

  return (
    <div className="overflow-x-auto">
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        className="text-primary"
        role="img"
        aria-label="Weekly attempts over the last year"
      >
        {series.map((s, i) => {
          const h = (s.count / max) * height;
          return (
            <rect
              key={s.key}
              x={i * 12}
              y={height - h}
              width={10}
              height={h || 1}
              rx={1}
              className={s.count > 0 ? "fill-current" : "fill-muted-foreground/20"}
            >
              <title>
                {s.count} {s.count === 1 ? "attempt" : "attempts"} (week of{" "}
                {s.key})
              </title>
            </rect>
          );
        })}
      </svg>
    </div>
  );
}

interface DetailAttemptRowProps {
  attempt: Attempt;
  currentUserId: number;
  isCoachOrAdmin: boolean;
  onUpdate: (next: Attempt) => void;
  onRemoved: () => void;
}

function DetailAttemptRow({
  attempt,
  currentUserId,
  isCoachOrAdmin,
  onUpdate,
  onRemoved,
}: DetailAttemptRowProps) {
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
    <li className="rounded-md border border-border bg-card p-3 text-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-xs text-muted-foreground">
            {formatRelative(attempt.attempted_at)} ·{" "}
            {new Date(attempt.attempted_at).toLocaleDateString()}
            {attempt.recorded_by_name && ` · ${attempt.recorded_by_name}`}
          </p>
          {attempt.student_note && (
            <p className="mt-1 whitespace-pre-wrap">
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Student:
              </span>{" "}
              {attempt.student_note}
            </p>
          )}
          {attempt.coach_note && (
            <p className="mt-1 whitespace-pre-wrap">
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
        <InlineNoteEditor
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
        <InlineDateEditor
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

interface InlineNoteEditorProps {
  attempt: Attempt;
  isCoachOrAdmin: boolean;
  onCancel: () => void;
  onSaved: (next: Attempt) => void;
}

function InlineNoteEditor({
  attempt,
  isCoachOrAdmin,
  onCancel,
  onSaved,
}: InlineNoteEditorProps) {
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

interface InlineDateEditorProps {
  attempt: Attempt;
  onCancel: () => void;
  onSaved: (next: Attempt) => void;
}

function InlineDateEditor({ attempt, onCancel, onSaved }: InlineDateEditorProps) {
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
