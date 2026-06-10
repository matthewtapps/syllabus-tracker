import { FolderOpen, PlayIcon, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTechniqueRow } from "./technique-row-context";

// Trigger content for the AccordionTrigger. No chevron here; the Accordion
// renders its own caret in the trailing slot. Tags live in the expanded
// panel only, so the collapsed row stays a single-line title plus a thin
// meta strip.
//
// The meta strip shows student/collection counts to coaches only — these
// are coach-relevant aggregates. Students see only the video count, and
// the strip hides entirely when there is nothing to show.
//
// Title truncates with ellipsis when collapsed (so the row stays compact
// in a long list) but wraps freely when the row is open, so long names
// like "Side Control Escape (Bridge & Shrimp)" are fully readable once
// the user is actually looking at the technique. The group-data-* hook
// matches the AccordionItem ancestor's data-state attribute.
//
// In student-syllabus context the row also shows a status dot (red /
// amber / green) so coaches and students can scan progress at a glance.
export function Header() {
  const { context, technique, role } = useTechniqueRow();
  const isCoach = role === "coach" || role === "admin";
  const showVideoMeta = isCoach || technique.video_count > 0;
  const status =
    context.kind === "student-syllabus" ? context.sst.status : null;

  return (
    <div className="flex min-w-0 flex-1 items-start gap-2.5">
      {status && (
        <span
          aria-label={`Status: ${status}`}
          className={cn(
            "mt-1.5 h-2 w-2 shrink-0 rounded-full",
            status === "red" && "bg-status-red",
            status === "amber" && "bg-status-amber",
            status === "green" && "bg-status-green",
          )}
        />
      )}
      <div className="min-w-0 flex-1 space-y-1">
        <p className="truncate text-sm font-semibold leading-tight group-data-[state=open]:overflow-visible group-data-[state=open]:whitespace-normal group-data-[state=open]:break-words">
          {technique.name}
        </p>
        {(isCoach || showVideoMeta) && (
          <span className="flex min-w-0 items-center gap-1.5 truncate whitespace-nowrap text-xs text-muted-foreground">
            {isCoach && (
              <>
                <Users className="h-3 w-3 shrink-0" aria-hidden />
                <span>{technique.student_count}</span>
                <span aria-hidden>·</span>
                <FolderOpen className="h-3 w-3 shrink-0" aria-hidden />
                <span>{technique.collection_count}</span>
                <span aria-hidden>·</span>
              </>
            )}
            <PlayIcon className="h-3 w-3 shrink-0" aria-hidden />
            <span>{technique.video_count}</span>
          </span>
        )}
      </div>
    </div>
  );
}
