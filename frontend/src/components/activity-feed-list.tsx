import { Link } from "react-router-dom";
import {
  Activity,
  ClipboardList,
  CircleDot,
  Dumbbell,
  Eye,
  Globe,
  GraduationCap,
  Minus,
  NotebookPen,
  Pencil,
  Pin,
  PlayCircle,
  Plus,
  Video,
  type LucideIcon,
} from "lucide-react";
import { StudentAvatar } from "@/components/student-avatar";
import { activityLine, type ActivityRow } from "@/lib/activity-line";
import { coalesceActivity } from "@/lib/activity-coalesce";
import { activitySurface } from "@/lib/view-context";
import { formatAbsolute, formatRelativeShort } from "@/lib/dates";
import { cn } from "@/lib/utils";

function verbIcon(verb: string): LucideIcon {
  switch (verb) {
    case "attempt_logged":
    case "attempt_edited":
    case "attempt_deleted":
      return Dumbbell;
    case "video_watched":
      return PlayCircle;
    case "video_added":
      return Video;
    case "video_visibility_set":
    case "sst_unhidden":
      return Eye;
    case "sst_status_changed":
      return CircleDot;
    case "sst_student_notes_edited":
    case "sst_coach_notes_edited":
      return NotebookPen;
    case "technique_pinned":
    case "technique_unpinned":
      return Pin;
    case "syllabus_assigned":
    case "syllabus_unassigned":
      return ClipboardList;
    case "syllabus_graduated":
      return GraduationCap;
    case "syllabus_technique_added":
    case "sst_added":
      return Plus;
    case "syllabus_technique_removed":
    case "sst_hidden":
      return Minus;
    case "technique_edited":
      return Pencil;
    default:
      return Activity;
  }
}

interface ActivityFeedListProps {
  rows: ActivityRow[];
  isLoading: boolean;
  /** Collapse consecutive same-actor same-verb rows. Default false. */
  coalesce?: boolean;
  /** Cap the number of (possibly coalesced) entries rendered. */
  maxRows?: number;
  /** Hide the per-row avatar (e.g. a single-student profile feed). Default shows it. */
  showAvatar?: boolean;
  emptyText?: string;
  /** Show absolute timestamps and full text without truncation. Default false. */
  detailed?: boolean;
}

/**
 * Presentational activity list shared by the coach dashboard and the student
 * profile. Renders ActivityRow[] only. The whole row is one tappable link to
 * the row's deep-link target; rows with no target render non-interactive.
 */
export function ActivityFeedList({
  rows,
  isLoading,
  coalesce = false,
  maxRows,
  showAvatar = true,
  emptyText = "No recent activity yet.",
  detailed = false,
}: ActivityFeedListProps) {
  if (isLoading) {
    return (
      <div className="divide-y divide-border">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="px-4 py-3">
            <div className="h-3 w-1/3 animate-pulse rounded bg-muted" />
            <div className="mt-2 h-3 w-2/3 animate-pulse rounded bg-muted" />
          </div>
        ))}
      </div>
    );
  }

  if (rows.length === 0) {
    return <p className="px-6 py-8 text-center text-sm text-muted-foreground">{emptyText}</p>;
  }

  const items = coalesce
    ? coalesceActivity(rows)
    : rows.map((row) => ({ row, count: 1, extraTechniques: [] }));
  const shown = maxRows ? items.slice(0, maxRows) : items;

  const rowClasses = "flex items-start gap-3 px-4 py-3";

  return (
    <ul className="divide-y divide-border">
      {shown.map((item) => {
        const line = activityLine(item.row);
        const surface = activitySurface(item.row);
        const studentActivityHref = `/student/${item.row.actor_user_id}/activity`;
        const ariaLabel = `${item.row.actor_name ?? "A student"} ${line.verb}${line.subject ? ` ${line.subject}` : ""}`;

        const hideDup = line.href ? true : undefined;
        const key = `${item.row.actor_user_id}-${item.row.id}-${item.row.occurred_at}`;
        const VerbIcon = verbIcon(item.row.verb);
        return (
          <li key={key} className="relative">
            {line.href && (
              <Link
                to={line.href}
                aria-label={ariaLabel}
                className="absolute inset-0 z-0 transition-colors hover:bg-muted/40"
              />
            )}
            <div className={cn(rowClasses, "relative z-10", line.href && "pointer-events-none")}>
              {showAvatar ? (
                <span aria-hidden={hideDup}>
                  <StudentAvatar id={item.row.actor_user_id} name={item.row.actor_name ?? "?"} />
                </span>
              ) : (
                <span
                  data-testid="verb-icon-container"
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground"
                  aria-hidden
                >
                  <VerbIcon className="h-4 w-4" />
                </span>
              )}
              <div className="min-w-0 flex-1">
                <div aria-hidden={hideDup} className="flex items-baseline justify-between gap-2">
                  <p className={cn("text-sm font-medium", detailed ? "" : "truncate")}>
                    {item.row.actor_name ?? "A student"}
                  </p>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {detailed
                      ? formatAbsolute(item.row.occurred_at)
                      : formatRelativeShort(item.row.occurred_at)}
                  </span>
                </div>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  <span aria-hidden={hideDup}>
                    {line.verb}
                    {line.subject ? ` ${line.subject}` : ""}
                  </span>
                  {item.count > 1 && (
                    <>
                      {" "}
                      <Link
                        to={studentActivityHref}
                        aria-label={`See all of ${item.row.actor_name ?? "this student"}'s activity`}
                        className="pointer-events-auto relative z-20 font-medium text-foreground underline underline-offset-2 hover:no-underline"
                      >
                        and {item.count - 1} more
                      </Link>
                    </>
                  )}
                </p>
                {surface && (
                  <span aria-hidden={hideDup} className="mt-1 inline-flex items-center gap-1 text-xs text-muted-foreground">
                    {surface.kind === "syllabus" ? (
                      <NotebookPen className="h-3 w-3 shrink-0" aria-hidden />
                    ) : (
                      <Globe className="h-3 w-3 shrink-0" aria-hidden />
                    )}
                    <span className={detailed ? "" : "truncate"}>{surface.label}</span>
                  </span>
                )}
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
