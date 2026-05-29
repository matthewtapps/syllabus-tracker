import { useState } from "react";
import { ChevronDownIcon, ChevronUpIcon, XIcon } from "lucide-react";
import type { Tag, Technique } from "@/lib/api";
import { updateTechnique } from "@/lib/api";
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

interface TechniqueRowProps {
  technique: Technique;
  canEditAll: boolean;
  canManageTags: boolean;
  isOwnTechnique: boolean;
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
  allTags,
  selectedTagFilter,
  onTechniqueUpdate,
  onTagsChange,
  onRequestTagRemoval,
  onEditDefinition,
}: TechniqueRowProps) {
  const [expanded, setExpanded] = useState(false);
  const status = technique.status as Status;
  const canEditStudentNotes = isOwnTechnique;
  const canManageTagsOnRow = canEditAll || canManageTags;

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
      className={cn(
        "border-l-4 border-l-transparent transition-colors",
        expanded ? "bg-muted/20" : "hover:bg-muted/20",
        expanded && statusToBorderClass(status),
      )}
    >
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-4 px-4 py-3 text-left focus-visible:outline-none focus-visible:bg-muted/30"
        aria-expanded={expanded}
      >
        <span
          className={cn("h-2.5 w-2.5 shrink-0 rounded-full", statusToDotClass(status))}
          aria-hidden
        />

        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{technique.technique_name}</span>
            {technique.has_new_student_activity && (
              <span
                className="inline-flex h-1.5 w-1.5 rounded-full bg-primary"
                aria-label="New student activity"
                title="Student edited after your last update"
              />
            )}
          </div>
          {!expanded && technique.tags.length > 0 && (
            <div className="flex flex-wrap gap-1">
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

        {expanded ? (
          <ChevronUpIcon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        ) : (
          <ChevronDownIcon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        )}
      </button>

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
              label="Student notes"
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
