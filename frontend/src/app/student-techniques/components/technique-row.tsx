import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowUpRight,
  ChevronDownIcon,
  ChevronUpIcon,
  XIcon,
} from "lucide-react";
import type { Attempt, Tag, Technique } from "@/lib/api";
import { listAttempts, updateTechnique } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/status-pill";
import { StatusToggle } from "@/components/status-toggle";
import { cn } from "@/lib/utils";
import { formatRelative } from "@/lib/dates";
import {
  statusToBorderClass,
  statusToDotClass,
  type Status,
} from "@/lib/status";
import { NotesEditor } from "./notes-editor";
import { TagsEditor } from "./tags-editor";
import { AttemptButton } from "./attempt-button";
import { AttemptsPanel } from "./attempts-panel";

interface TechniqueRowProps {
  technique: Technique;
  canEditAll: boolean;
  canManageTags: boolean;
  isOwnTechnique: boolean;
  studentId: number;
  currentUserId: number;
  defaultExpanded?: boolean;
  showCollectionChip?: boolean;
  allTags: Tag[];
  selectedTagFilter: string[];
  onTechniqueUpdate: (technique: Technique) => void;
  onTagsChange: (technique: Technique, newTags: Tag[], allTagsAfter?: Tag[]) => void;
  onRequestTagRemoval: (technique: Technique, tag: Tag) => void;
  onEditDefinition: (technique: Technique) => void;
}

export function TechniqueRow({
  technique,
  canEditAll,
  canManageTags,
  isOwnTechnique,
  studentId,
  currentUserId,
  defaultExpanded = false,
  showCollectionChip = false,
  allTags,
  selectedTagFilter,
  onTechniqueUpdate,
  onTagsChange,
  onRequestTagRemoval,
  onEditDefinition,
}: TechniqueRowProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [attempts, setAttempts] = useState<Attempt[] | null>(null);
  const [attemptsError, setAttemptsError] = useState<string | null>(null);
  const status = technique.status as Status;
  const canEditStudentNotes = isOwnTechnique;
  const canManageTagsOnRow = canEditAll || canManageTags;
  const canLogAttempts = isOwnTechnique || canEditAll;

  // Lazy-load the attempt history the first time the row is expanded. We keep
  // the list in this component so newly logged attempts (from the inline
  // button) show up in the panel without a refetch.
  useEffect(() => {
    if (!expanded || attempts !== null || attemptsError) return;
    let cancelled = false;
    (async () => {
      try {
        const list = await listAttempts(technique.id);
        if (!cancelled) setAttempts(list);
      } catch (err) {
        console.error(err);
        if (!cancelled) setAttemptsError("Could not load attempts");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [expanded, attempts, attemptsError, technique.id]);

  async function handleStatusChange(next: Status) {
    if (next === status) return;
    const response = await updateTechnique(technique.id, { status: next });
    if (!response.ok) return;
    onTechniqueUpdate({ ...technique, status: next });
  }

  function handleTagAdded(tag: Tag, _allAfter: Tag[]) {
    const updated = [...technique.tags, tag].sort((a, b) =>
      a.name.localeCompare(b.name),
    );
    onTagsChange({ ...technique, tags: updated }, updated, _allAfter);
  }

  return (
    <div
      id={`technique-row-${technique.id}`}
      className={cn(
        "border-l-4 border-l-transparent transition-colors scroll-mt-20",
        expanded ? "bg-muted/20" : "hover:bg-muted/20",
        expanded && statusToBorderClass(status),
      )}
    >
      <div
        role="button"
        tabIndex={0}
        onClick={() => setExpanded((v) => !v)}
        onKeyDown={(e) => {
          if (e.target !== e.currentTarget) return;
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setExpanded((v) => !v);
          }
        }}
        className="flex w-full items-center gap-3 px-4 py-3 text-left focus-visible:outline-none focus-visible:bg-muted/30 cursor-pointer sm:gap-4"
        aria-expanded={expanded}
      >
        <span
          className={cn("h-2.5 w-2.5 shrink-0 rounded-full", statusToDotClass(status))}
          aria-hidden
        />

        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{technique.technique_name}</span>
            <Link
              to={`/student/${studentId}/technique/${technique.id}`}
              onClick={(e) => e.stopPropagation()}
              title="Open detail page"
              aria-label="Open detail page"
              className="inline-flex h-5 w-5 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
            </Link>
            {technique.has_new_student_activity && (
              <span
                className="inline-flex h-1.5 w-1.5 rounded-full bg-primary"
                aria-label="New student activity"
                title="Student edited after your last update"
              />
            )}
            {!expanded && technique.attempt_count > 0 && (
              <Badge variant="outline" className="text-[10px] font-normal">
                {technique.attempt_count}{" "}
                {technique.attempt_count === 1 ? "attempt" : "attempts"}
              </Badge>
            )}
          </div>
          {!expanded && (technique.tags.length > 0 || (showCollectionChip && technique.collection_name)) && (
            <div className="flex flex-wrap gap-1">
              {showCollectionChip && technique.collection_name && (
                <Badge variant="secondary" className="text-xs">
                  {technique.collection_name}
                </Badge>
              )}
              {technique.tags.slice(0, 4).map((tag) => (
                <Badge
                  key={tag.id}
                  variant={selectedTagFilter.includes(tag.name) ? "default" : "outline"}
                  className="text-xs"
                >
                  {tag.name}
                </Badge>
              ))}
              {technique.tags.length > 4 && (
                <Badge variant="outline" className="text-xs">
                  +{technique.tags.length - 4}
                </Badge>
              )}
            </div>
          )}
        </div>

        <div className="hidden shrink-0 text-xs text-muted-foreground sm:block">
          {formatRelative(technique.updated_at)}
        </div>

        {canLogAttempts && (
          <AttemptButton
            studentTechniqueId={technique.id}
            techniqueStatus={status}
            onLogged={(result) => {
              setAttempts((prev) =>
                prev
                  ? [result.attempt, ...prev.filter((a) => a.id !== result.attempt.id)]
                  : prev,
              );
              onTechniqueUpdate({
                ...technique,
                attempt_count: technique.attempt_count + 1,
                last_attempt_at: result.attempt.attempted_at,
              });
            }}
            onStatusChange={(next) =>
              onTechniqueUpdate({ ...technique, status: next })
            }
          />
        )}

        {expanded ? (
          <ChevronUpIcon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        ) : (
          <ChevronDownIcon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        )}
      </div>

      {expanded && (
        <div className="space-y-6 px-4 pb-6 pt-2">
          {canEditAll && (
            <section className="space-y-2">
              <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Status
              </h3>
              <StatusToggle value={status} onChange={handleStatusChange} size="sm" />
            </section>
          )}

          {!canEditAll && (
            <section className="space-y-2">
              <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Status
              </h3>
              <StatusPill status={status} variant="solid" />
            </section>
          )}

          {(canEditAll || (!canEditStudentNotes && technique.coach_notes)) && (
            <NotesEditor
              techniqueId={technique.id}
              field="coach_notes"
              label="Coach notes"
              value={technique.coach_notes}
              canEdit={canEditAll}
              onSave={(v) =>
                onTechniqueUpdate({ ...technique, coach_notes: v })
              }
            />
          )}

          {(canEditStudentNotes || canEditAll || technique.student_notes) && (
            <NotesEditor
              techniqueId={technique.id}
              field="student_notes"
              label={isOwnTechnique ? "My notes" : "Student notes"}
              value={technique.student_notes}
              canEdit={canEditStudentNotes || canEditAll}
              onSave={(v) =>
                onTechniqueUpdate({ ...technique, student_notes: v })
              }
            />
          )}

          <section className="space-y-2">
            <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Description
            </h3>
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">
              {technique.technique_description}
            </p>
          </section>

          <AttemptsPanel
            studentTechniqueId={technique.id}
            studentId={studentId}
            currentUserId={currentUserId}
            isCoachOrAdmin={canEditAll}
            attempts={attempts}
            error={attemptsError}
            onAttemptUpdated={(updated) =>
              setAttempts((prev) =>
                prev
                  ? prev.map((a) => (a.id === updated.id ? updated : a))
                  : prev,
              )
            }
            onAttemptRemoved={(id) => {
              setAttempts((prev) =>
                prev ? prev.filter((a) => a.id !== id) : prev,
              );
              onTechniqueUpdate({
                ...technique,
                attempt_count: Math.max(0, technique.attempt_count - 1),
              });
            }}
          />

          <section className="space-y-2">
            <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Tags
            </h3>
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
                      onClick={(e) => {
                        e.stopPropagation();
                        onRequestTagRemoval(technique, tag);
                      }}
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

          {canEditAll && (
            <div className="flex justify-end">
              <Button
                variant="outline"
                size="sm"
                onClick={(e) => {
                  e.stopPropagation();
                  onEditDefinition(technique);
                }}
              >
                Edit technique definition
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
