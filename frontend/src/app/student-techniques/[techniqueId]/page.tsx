import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  ArrowLeft,
  MoreVerticalIcon,
  PencilIcon,
  XIcon,
} from "lucide-react";
import { toast } from "sonner";
import {
  type Attempt,
  type SingleStudentTechnique,
  type Tag,
  type Technique,
  type TechniqueUpdate,
  type User,
  deleteAttempt,
  getAllTags,
  getStudentTechniqueDetail,
  listAttempts,
  removeTagFromTechnique,
  updateAttempt,
  updateTechnique,
} from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { Skeleton } from "@/components/ui/skeleton";
import { StatusPill } from "@/components/status-pill";
import { StatusToggle } from "@/components/status-toggle";
import TechniqueEditForm from "@/components/technique-edit-form";
import { AddVideoButton } from "@/components/videos/add-video-button";
import { VideoList } from "@/components/videos/video-list";
import { useCapabilities } from "@/context/capabilities";
import { WeeklyAttemptBars } from "@/components/weekly-attempt-bars";
import { formatRelative } from "@/lib/dates";
import type { Status } from "@/lib/status";
import { AttemptButton } from "../components/attempt-button";
import { NotesEditor } from "../components/notes-editor";
import { TagRemoveDialog } from "../components/tag-remove-dialog";
import { TagsEditor } from "../components/tags-editor";

interface StudentTechniqueDetailProps {
  user: User;
}

const RECENT_WINDOW_DAYS = 30;

export default function StudentTechniqueDetail({
  user,
}: StudentTechniqueDetailProps) {
  const { id, techniqueId } = useParams<{ id: string; techniqueId: string }>();
  const studentId = parseInt(id ?? "0", 10);
  const stId = parseInt(techniqueId ?? "0", 10);

  const [detail, setDetail] = useState<SingleStudentTechnique | null>(null);
  const [attempts, setAttempts] = useState<Attempt[] | null>(null);
  const [allTags, setAllTags] = useState<Tag[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [tagToRemove, setTagToRemove] = useState<{
    technique: Technique;
    tag: Tag;
  } | null>(null);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [videoReloadKey, setVideoReloadKey] = useState(0);
  const { videos: videosEnabled } = useCapabilities();

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [d, list, tags] = await Promise.all([
          getStudentTechniqueDetail(stId),
          listAttempts(stId),
          getAllTags(),
        ]);
        if (cancelled) return;
        setDetail(d);
        setAttempts(list);
        setAllTags(tags);
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

  if (error) {
    return (
      <div className="container mx-auto px-4 py-6 sm:px-6 md:py-8">
        <p className="text-sm text-destructive">{error}</p>
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="container mx-auto max-w-3xl space-y-4 px-4 py-6 sm:px-6 md:py-8">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  const technique = detail.technique;
  const status = technique.status as Status;
  const canEditAll = detail.can_edit_all_techniques;
  const isOwnTechnique = user.id === detail.student.id;
  const canEditStudentNotes = isOwnTechnique;
  const canManageTagsOnRow = canEditAll || detail.can_manage_tags;
  const canLogAttempts = isOwnTechnique || canEditAll;

  function applyTechniqueUpdate(patch: Partial<Technique>) {
    setDetail((prev) =>
      prev ? { ...prev, technique: { ...prev.technique, ...patch } } : prev,
    );
  }

  async function handleStatusChange(next: Status) {
    if (next === status) return;
    const response = await updateTechnique(technique.id, { status: next });
    if (!response.ok) {
      toast.error("Could not update status");
      return;
    }
    applyTechniqueUpdate({ status: next });
  }

  function handleTagAdded(tag: Tag, allAfter: Tag[]) {
    const updated = [...technique.tags, tag].sort((a, b) =>
      a.name.localeCompare(b.name),
    );
    applyTechniqueUpdate({ tags: updated });
    setAllTags(allAfter);
    toast.success("Tag added");
  }

  async function executeTagRemoval() {
    if (!tagToRemove) return;
    const { tag } = tagToRemove;
    try {
      const response = await removeTagFromTechnique(
        technique.technique_id,
        tag.id,
      );
      if (!response.ok) {
        toast.error("Failed to remove tag");
        return;
      }
      applyTechniqueUpdate({
        tags: technique.tags.filter((t) => t.id !== tag.id),
      });
      toast.success(`Removed tag "${tag.name}"`);
    } finally {
      setTagToRemove(null);
    }
  }

  async function handleEditDefinitionSubmit(updates: TechniqueUpdate) {
    const response = await updateTechnique(technique.id, updates);
    if (!response.ok) {
      toast.error("Failed to save changes");
      return;
    }
    applyTechniqueUpdate({
      technique_name: updates.technique_name ?? technique.technique_name,
      technique_description:
        updates.technique_description ?? technique.technique_description,
    });
    toast.success("Changes saved");
    setEditDialogOpen(false);
  }

  function applyAttemptUpdate(next: Attempt) {
    setAttempts((prev) =>
      prev ? prev.map((a) => (a.id === next.id ? next : a)) : prev,
    );
  }

  function removeAttempt(id: number) {
    setAttempts((prev) => (prev ? prev.filter((a) => a.id !== id) : prev));
    applyTechniqueUpdate({
      attempt_count: Math.max(0, technique.attempt_count - 1),
    });
  }

  const totalAttempts = attempts?.length ?? technique.attempt_count;
  const recentStats = computeRecency(attempts);

  return (
    <div className="container mx-auto max-w-3xl px-4 py-6 sm:px-6 md:py-8">
      <div className="mb-4">
        <Button
          asChild
          variant="ghost"
          size="sm"
          className="-ml-3 h-8 gap-1.5 text-muted-foreground"
        >
          <Link to={`/student/${studentId}?focus=${technique.id}`}>
            <ArrowLeft className="h-4 w-4" aria-hidden />
            Back to syllabus
          </Link>
        </Button>
      </div>

      <PageHeader
        title={technique.technique_name}
        subtitle={
          isOwnTechnique
            ? "From your syllabus"
            : `From ${detail.student.display_name || detail.student.username}'s syllabus`
        }
        actions={
          <div className="flex items-center gap-2">
            <StatusPill status={status} variant="solid" />
            {canLogAttempts && (
              <AttemptButton
                studentTechniqueId={technique.id}
                techniqueStatus={status}
                onLogged={(result) => {
                  setAttempts((prev) =>
                    prev
                      ? [
                          result.attempt,
                          ...prev.filter((a) => a.id !== result.attempt.id),
                        ]
                      : prev,
                  );
                  applyTechniqueUpdate({
                    attempt_count: technique.attempt_count + 1,
                    last_attempt_at: result.attempt.attempted_at,
                  });
                }}
                onStatusChange={(next) => applyTechniqueUpdate({ status: next })}
              />
            )}
          </div>
        }
      />

      <div className="space-y-8">
        <section className="space-y-3">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Recent activity
            </h2>
            {recentStats && (
              <p className="text-xs text-muted-foreground">
                <span className="font-medium text-foreground">
                  {recentStats.recentCount}
                </span>{" "}
                in last {RECENT_WINDOW_DAYS} days
                {recentStats.lastLabel && (
                  <>
                    {" "}
                    <span aria-hidden>·</span> last {recentStats.lastLabel}
                  </>
                )}
              </p>
            )}
          </div>
          {attempts && attempts.length > 0 ? (
            <div className="overflow-x-auto">
              <WeeklyAttemptBars attempts={attempts} weeks={8} />
            </div>
          ) : (
            <p className="text-sm italic text-muted-foreground">
              No attempts logged yet.
            </p>
          )}
        </section>

        <section className="space-y-2">
          <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Status
          </h2>
          {canEditAll ? (
            <StatusToggle value={status} onChange={handleStatusChange} size="sm" />
          ) : (
            <StatusPill status={status} variant="solid" />
          )}
        </section>

        {(canEditAll || (!canEditStudentNotes && technique.coach_notes)) && (
          <NotesEditor
            techniqueId={technique.id}
            field="coach_notes"
            label="Coach notes"
            value={technique.coach_notes}
            canEdit={canEditAll}
            onSave={(v) => applyTechniqueUpdate({ coach_notes: v })}
          />
        )}

        {(canEditStudentNotes || canEditAll || technique.student_notes) && (
          <NotesEditor
            techniqueId={technique.id}
            field="student_notes"
            label={isOwnTechnique ? "My notes" : "Student notes"}
            value={technique.student_notes}
            canEdit={canEditStudentNotes || canEditAll}
            onSave={(v) => applyTechniqueUpdate({ student_notes: v })}
          />
        )}

        <section className="space-y-2">
          <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Description
          </h2>
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">
            {technique.technique_description}
          </p>
        </section>

        {videosEnabled && (
          <section className="space-y-3">
            <div className="flex items-start justify-between gap-3">
              <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Videos
              </h2>
              {canEditAll && (
                <AddVideoButton
                  techniqueId={technique.technique_id}
                  onAdded={() => setVideoReloadKey((k) => k + 1)}
                />
              )}
            </div>
            <VideoList
              techniqueId={technique.technique_id}
              canManage={canEditAll}
              reloadKey={videoReloadKey}
            />
          </section>
        )}

        <section className="space-y-2">
          <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Tags
          </h2>
          <div className="flex flex-wrap items-center gap-1.5">
            {technique.tags.map((tag) => (
              <Badge
                key={tag.id}
                variant="secondary"
                className="gap-1.5 pr-1.5 text-xs"
              >
                {tag.name}
                {canManageTagsOnRow && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-5 w-5 rounded-full text-muted-foreground hover:bg-background hover:text-foreground"
                    onClick={() => setTagToRemove({ technique, tag })}
                  >
                    <XIcon className="h-3 w-3" aria-hidden />
                    <span className="sr-only">Remove tag {tag.name}</span>
                  </Button>
                )}
              </Badge>
            ))}
            {canManageTagsOnRow && (
              <TagsEditor
                techniqueId={technique.technique_id}
                assignedTags={technique.tags}
                allTags={allTags}
                onTagAdded={handleTagAdded}
              />
            )}
            {technique.tags.length === 0 && !canManageTagsOnRow && (
              <span className="text-sm italic text-muted-foreground">
                No tags
              </span>
            )}
          </div>
        </section>

        {(canEditAll ||
          technique.last_coach_update_at ||
          technique.last_student_update_at) && (
          <section className="grid gap-3 text-xs text-muted-foreground sm:grid-cols-2">
            {technique.last_coach_update_at && (
              <div>
                <span className="block text-[10px] font-medium uppercase tracking-wide">
                  Last coach update
                </span>
                <span>
                  {formatRelative(technique.last_coach_update_at)}
                  {technique.last_coach_update_by_name &&
                    ` · ${technique.last_coach_update_by_name}`}
                </span>
              </div>
            )}
            {technique.last_student_update_at && (
              <div>
                <span className="block text-[10px] font-medium uppercase tracking-wide">
                  Last student update
                </span>
                <span>
                  {formatRelative(technique.last_student_update_at)}
                  {technique.last_student_update_by_name &&
                    ` · ${technique.last_student_update_by_name}`}
                </span>
              </div>
            )}
          </section>
        )}

        <section className="space-y-3">
          <h2 className="text-sm font-semibold">
            All attempts ({totalAttempts})
          </h2>
          {attempts === null && (
            <p className="text-sm text-muted-foreground">
              Loading attempts...
            </p>
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
                  isCoachOrAdmin={canEditAll}
                  onUpdate={applyAttemptUpdate}
                  onRemoved={() => removeAttempt(a.id)}
                />
              ))}
            </ul>
          )}
        </section>

        {canEditAll && (
          <div className="flex justify-end pt-4">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setEditDialogOpen(true)}
            >
              Edit technique definition
            </Button>
          </div>
        )}
      </div>

      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent className="max-h-[85vh] w-[calc(100vw-1rem)] max-w-md overflow-y-auto p-4 sm:p-6">
          <DialogHeader>
            <DialogTitle>Edit technique definition</DialogTitle>
            <DialogDescription>
              Changes to the name or description affect every student assigned
              this technique.
            </DialogDescription>
          </DialogHeader>
          <TechniqueEditForm
            technique={technique}
            canEditAll={canEditAll}
            currentUserId={user.id}
            studentId={detail.student.id}
            onSubmit={handleEditDefinitionSubmit}
          />
        </DialogContent>
      </Dialog>

      <TagRemoveDialog
        open={!!tagToRemove}
        onOpenChange={(open) => !open && setTagToRemove(null)}
        tagName={tagToRemove?.tag.name ?? null}
        onConfirm={executeTagRemoval}
      />
    </div>
  );
}

function computeRecency(
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
    lastLabel:
      mostRecent > 0
        ? formatRelative(new Date(mostRecent).toISOString())
        : null,
  };
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

function InlineDateEditor({
  attempt,
  onCancel,
  onSaved,
}: InlineDateEditorProps) {
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
