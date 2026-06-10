import { FolderOpen, PlayIcon, Users } from "lucide-react";
import { useTechniqueRow } from "./technique-row-context";

// Trigger content for the AccordionTrigger. No chevron here; the Accordion
// renders its own caret in the trailing slot. Tags live in the expanded
// panel only, so the collapsed row stays a single-line title plus a thin
// meta strip.
export function Header() {
  const { technique } = useTechniqueRow();
  return (
    <div className="min-w-0 flex-1 space-y-1">
      <p className="truncate text-sm font-semibold leading-tight">
        {technique.name}
      </p>
      <span className="flex min-w-0 items-center gap-1.5 truncate whitespace-nowrap text-xs text-muted-foreground">
        <Users className="h-3 w-3 shrink-0" aria-hidden />
        <span>{technique.student_count}</span>
        <span aria-hidden>·</span>
        <FolderOpen className="h-3 w-3 shrink-0" aria-hidden />
        <span>{technique.collection_count}</span>
        <span aria-hidden>·</span>
        <PlayIcon className="h-3 w-3 shrink-0" aria-hidden />
        <span>{technique.video_count}</span>
      </span>
    </div>
  );
}
