import { ChevronDownIcon, ChevronUpIcon, FolderOpen, PlayIcon, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useTechniqueRow } from "./technique-row-context";

interface HeaderProps {
  expanded: boolean;
  onToggle: () => void;
}

export function Header({ expanded, onToggle }: HeaderProps) {
  const { technique, context } = useTechniqueRow();
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={expanded}
      className="flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/40"
    >
      <div className="min-w-0 flex-1 space-y-1">
        <p className="truncate text-sm font-medium">{technique.name}</p>
        <p className="text-xs text-muted-foreground">
          <CollapsedMeta />
        </p>
        {technique.tags.length > 0 && (
          <div className="flex flex-wrap gap-1 pt-0.5">
            {technique.tags.map((tag) => (
              <Badge
                key={tag.id}
                variant="outline"
                className="px-1.5 py-0 text-[10px]"
              >
                {tag.name}
              </Badge>
            ))}
          </div>
        )}
      </div>
      {/* student-pinned and global-library both surface is_pinned status. */}
      {context.kind !== "global-library" || technique.is_pinned ? null : null}
      {expanded ? (
        <ChevronUpIcon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
      ) : (
        <ChevronDownIcon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
      )}
    </button>
  );
}

function CollapsedMeta() {
  const { technique } = useTechniqueRow();
  return (
    <span className="flex min-w-0 items-center gap-1.5 truncate whitespace-nowrap">
      <Users className="h-3 w-3 shrink-0" aria-hidden />
      <span>{technique.student_count}</span>
      <span aria-hidden>·</span>
      <FolderOpen className="h-3 w-3 shrink-0" aria-hidden />
      <span>{technique.collection_count}</span>
      <span aria-hidden>·</span>
      <PlayIcon className="h-3 w-3 shrink-0" aria-hidden />
      <span>{technique.video_count}</span>
    </span>
  );
}
