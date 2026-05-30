import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ChevronDownIcon,
  ChevronUpIcon,
  XIcon,
} from "lucide-react";
import type { Attempt, Tag, Technique } from "@/lib/api";
import { listAttempts, updateTechnique } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { StatusToggle } from "@/components/status-toggle";
import { cn } from "@/lib/utils";
import { formatRelative } from "@/lib/dates";
import { statusToDotClass, type Status } from "@/lib/status";
import { NotesEditor } from "./notes-editor";
import { TagsEditor } from "./tags-editor";
import { AttemptButton } from "./attempt-button";
import { AttemptsPanel } from "./attempts-panel";
import { InlineVideoList } from "./inline-video-list";

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

const META_TAG_LIMIT = 3;

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
  const navigate = useNavigate();
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

  // Left-border accent: status colour when expanded, transparent otherwise.
  // (New student activity is signalled by a small dot under the status dot.)
  const borderAccent = expanded
    ? statusBorderClass(status)
    : "border-l-transparent";

  const metaParts = buildMetaParts({
    technique,
    showCollectionChip,
    selectedTagFilter,
  });

  return (
    <div
      id={`technique-row-${technique.id}`}
      className={cn(
        "border-l-4 transition-colors scroll-mt-20",
        borderAccent,
        expanded ? "bg-muted/20" : "hover:bg-muted/20",
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
        className="flex w-full items-start gap-3 px-4 py-3 text-left focus-visible:bg-muted/30 focus-visible:outline-none cursor-pointer"
        aria-expanded={expanded}
      >
        <div className="mt-1.5 flex w-2.5 shrink-0 flex-col items-center gap-1">
          <span
            className={cn("h-2.5 w-2.5 rounded-full", statusToDotClass(status))}
            aria-hidden
          />
          {technique.has_new_student_activity && (
            <span
              className="h-1.5 w-1.5 rounded-full bg-primary"
              aria-label="Student edited after your last update"
              title="Student edited after your last update"
            />
          )}
        </div>

        <div className="min-w-0 flex-1">
          <p className="font-medium leading-snug">{technique.technique_name}</p>
          {!expanded && metaParts.length > 0 && (
            <p className="mt-0.5 truncate text-xs text-muted-foreground">
              {metaParts.join(" · ")}
            </p>
          )}
        </div>

        {expanded ? (
          <ChevronUpIcon
            className="mt-1 h-4 w-4 shrink-0 text-muted-foreground"
            aria-hidden
          />
        ) : (
          <ChevronDownIcon
            className="mt-1 h-4 w-4 shrink-0 text-muted-foreground"
            aria-hidden
          />
        )}
      </div>

      {expanded && (
        <div className="space-y-5 px-4 pb-5">
          {canEditAll && (
            <StatusToggle value={status} onChange={handleStatusChange} size="sm" />
          )}

          <section className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Attempts
              </h3>
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
            </div>
            <AttemptsPanel
              studentTechniqueId={technique.id}
              studentId={studentId}
              currentUserId={currentUserId}
              isCoachOrAdmin={canEditAll}
              attempts={attempts}
              error={attemptsError}
              hideHeader
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
          </section>

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

          <InlineVideoList
            libraryTechniqueId={technique.technique_id}
            canManage={canEditAll}
          />

          {technique.technique_description && (
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">
              {technique.technique_description}
            </p>
          )}

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

          <FooterMeta
            technique={technique}
            studentId={studentId}
            onViewDetails={() =>
              navigate(`/student/${studentId}/technique/${technique.id}`)
            }
            onEditDefinition={
              canEditAll ? () => onEditDefinition(technique) : undefined
            }
          />
        </div>
      )}
    </div>
  );
}

interface MetaArgs {
  technique: Technique;
  showCollectionChip: boolean;
  selectedTagFilter: string[];
}

function buildMetaParts({
  technique,
  showCollectionChip,
}: MetaArgs): string[] {
  const parts: string[] = [];
  if (technique.attempt_count > 0) {
    parts.push(
      `${technique.attempt_count} ${technique.attempt_count === 1 ? "attempt" : "attempts"}`,
    );
  }
  if (showCollectionChip && technique.collection_name) {
    parts.push(technique.collection_name);
  }
  const tagNames = technique.tags.map((t) => t.name);
  parts.push(...tagNames.slice(0, META_TAG_LIMIT));
  if (tagNames.length > META_TAG_LIMIT) {
    parts.push(`+${tagNames.length - META_TAG_LIMIT}`);
  }
  return parts;
}

function statusBorderClass(status: Status): string {
  switch (status) {
    case "red":
      return "border-l-status-red";
    case "amber":
      return "border-l-status-amber";
    case "green":
      return "border-l-status-green";
  }
}

interface FooterMetaProps {
  technique: Technique;
  studentId: number;
  onViewDetails: () => void;
  onEditDefinition?: () => void;
}

function FooterMeta({
  technique,
  onViewDetails,
  onEditDefinition,
}: FooterMetaProps) {
  const lastCoach = technique.last_coach_update_at;
  const lastStudent = technique.last_student_update_at;
  const hasUpdates = lastCoach || lastStudent;

  return (
    <div className="flex flex-col gap-3 border-t border-border pt-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="space-y-1 text-xs text-muted-foreground">
        <p className="font-medium uppercase tracking-wide">Edits</p>
        {hasUpdates ? (
          <>
            {lastCoach && (
              <p>
                Coach: {formatRelative(lastCoach)}
                {technique.last_coach_update_by_name &&
                  ` · ${technique.last_coach_update_by_name}`}
              </p>
            )}
            {lastStudent && (
              <p>
                Student: {formatRelative(lastStudent)}
                {technique.last_student_update_by_name &&
                  ` · ${technique.last_student_update_by_name}`}
              </p>
            )}
          </>
        ) : (
          <p>No edits yet</p>
        )}
      </div>
      <div className="flex items-center gap-2 self-end sm:self-auto">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={(e) => {
            e.stopPropagation();
            onViewDetails();
          }}
        >
          Open detail page
        </Button>
        {onEditDefinition && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              onEditDefinition();
            }}
          >
            Edit definition
          </Button>
        )}
      </div>
    </div>
  );
}
