import { useState } from "react";
import { Link } from "react-router-dom";
import {
  Activity,
  ClipboardList,
  CircleDot,
  Dumbbell,
  Eye,
  Globe,
  GraduationCap,
  MessageSquare,
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

function verbIconMeta(verb: string): { Icon: LucideIcon; colorClass: string } {
  switch (verb) {
    case "attempt_logged":
    case "attempt_edited":
    case "attempt_deleted":
      return { Icon: Dumbbell, colorClass: "text-amber-500" };
    case "video_watched":
      return { Icon: PlayCircle, colorClass: "text-sky-500" };
    case "video_added":
    case "video_visibility_set":
      return { Icon: Video, colorClass: "text-sky-500" };
    case "sst_status_changed":
      return { Icon: CircleDot, colorClass: "text-emerald-500" };
    case "sst_student_notes_edited":
    case "sst_coach_notes_edited":
      return { Icon: NotebookPen, colorClass: "text-violet-500" };
    case "technique_pinned":
    case "technique_unpinned":
      return { Icon: Pin, colorClass: "text-rose-500" };
    case "syllabus_assigned":
    case "syllabus_unassigned":
      return { Icon: ClipboardList, colorClass: "text-indigo-500" };
    case "syllabus_graduated":
      return { Icon: GraduationCap, colorClass: "text-emerald-600" };
    case "syllabus_technique_added":
    case "sst_added":
      return { Icon: Plus, colorClass: "text-indigo-500" };
    case "syllabus_technique_removed":
    case "sst_hidden":
      return { Icon: Minus, colorClass: "text-indigo-500" };
    case "sst_unhidden":
      return { Icon: Eye, colorClass: "text-indigo-500" };
    case "technique_edited":
      return { Icon: Pencil, colorClass: "text-muted-foreground" };
    case "thread_comment_posted":
      return { Icon: MessageSquare, colorClass: "text-violet-500" };
    default:
      return { Icon: Activity, colorClass: "text-muted-foreground" };
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
  /**
   * Show a small inline avatar immediately before the actor name on the
   * representative row. Useful on mixed-actor feeds (timeline, profile) where
   * the big left-column avatar is hidden but actors still need to be
   * distinguishable at a glance. Default false.
   */
  inlineAvatar?: boolean;
  emptyText?: string;
  /** Show absolute timestamps and full text without truncation. Default false. */
  detailed?: boolean;
}

interface RowOptions {
  showAvatar: boolean;
  inlineAvatar: boolean;
  detailed: boolean;
  coalesce: boolean;
  /** Optional JSX appended inside the description <p> after the verb/subject. */
  trailing?: React.ReactNode;
}

function ActivityRowItem({
  activityRow,
  opts,
}: {
  activityRow: ActivityRow;
  opts: RowOptions;
}) {
  const { showAvatar, inlineAvatar, detailed, coalesce, trailing } = opts;
  const line = activityLine(activityRow);
  const surface = activitySurface(activityRow);
  const ariaLabel = `${activityRow.actor_name ?? "A student"} ${line.verb}${line.subject ? ` ${line.subject}` : ""}`;
  const hideDup = line.href ? true : undefined;
  const { Icon: VerbIcon, colorClass } = verbIconMeta(activityRow.verb);

  return (
    <>
      {line.href && (
        <Link
          to={line.href}
          aria-label={ariaLabel}
          className="absolute inset-0 z-0 transition-colors hover:bg-muted/40"
        />
      )}
      <div className={cn("flex items-start gap-3 px-4 py-3", "relative z-10", line.href && "pointer-events-none")}>
        {showAvatar && (
          <span aria-hidden={hideDup}>
            <StudentAvatar id={activityRow.actor_user_id} name={activityRow.actor_name ?? "?"} />
          </span>
        )}
        <div className="min-w-0 flex-1">
          <div aria-hidden={hideDup} className="flex items-baseline justify-between gap-2">
            <p className={cn("flex items-center gap-1.5 text-sm font-medium", detailed ? "" : "truncate")}>
              {inlineAvatar && (
                <span data-testid="inline-avatar" className="pointer-events-auto shrink-0" aria-hidden>
                  <StudentAvatar
                    id={activityRow.actor_user_id}
                    name={activityRow.actor_name ?? "?"}
                    size="sm"
                  />
                </span>
              )}
              {activityRow.actor_name ?? "A student"}
            </p>
            <span className="shrink-0 text-xs text-muted-foreground">
              {detailed
                ? formatAbsolute(activityRow.occurred_at)
                : formatRelativeShort(activityRow.occurred_at)}
            </span>
          </div>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {!coalesce && (
              <VerbIcon className={cn("mr-1 inline-block h-4 w-4 align-text-bottom", colorClass)} aria-hidden data-testid="verb-icon" />
            )}
            <span aria-hidden={hideDup}>
              {line.verb}
              {line.subject ? ` ${line.subject}` : ""}
            </span>
            {trailing}
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
    </>
  );
}

/**
 * Presentational activity list shared by the coach dashboard and the student
 * profile. Renders ActivityRow[] only. The whole row is one tappable link to
 * the row's deep-link target; rows with no target render non-interactive.
 *
 * When coalesce=true, consecutive same-actor+same-verb rows are grouped. The
 * representative row shows an expand toggle ("and N more") that reveals the
 * remaining member rows in-place; clicking it does not navigate.
 */
export function ActivityFeedList({
  rows,
  isLoading,
  coalesce = false,
  maxRows,
  showAvatar = true,
  inlineAvatar = false,
  emptyText = "No recent activity yet.",
  detailed = false,
}: ActivityFeedListProps) {
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set());

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
    : rows.map((row) => ({ row, count: 1, extraTechniques: [], members: [row] }));
  const shown = maxRows ? items.slice(0, maxRows) : items;

  function toggleKey(key: string) {
    setExpandedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }

  return (
    <ul className="divide-y divide-border">
      {shown.map((item) => {
        const key = `${item.row.actor_user_id}-${item.row.id}-${item.row.occurred_at}`;
        const isExpanded = expandedKeys.has(key);

        const expandToggle =
          item.count > 1 ? (
            <>
              {" "}
              <button
                type="button"
                aria-expanded={isExpanded}
                onClick={() => toggleKey(key)}
                className="pointer-events-auto relative z-20 font-medium text-foreground underline underline-offset-2 hover:no-underline"
              >
                {isExpanded ? "Show less" : `and ${item.count - 1} more`}
              </button>
            </>
          ) : undefined;

        const opts: RowOptions = { showAvatar, inlineAvatar, detailed, coalesce, trailing: expandToggle };

        const extraMembers = item.members.slice(1);

        return (
          <li key={key}>
            <div className="relative">
              <ActivityRowItem activityRow={item.members[0]} opts={opts} />
            </div>
            {extraMembers.length > 0 && (
              <div
                className={cn(
                  "grid transition-[grid-template-rows] duration-200 ease-out",
                  isExpanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
                )}
              >
                <div className="overflow-hidden">
                  <ul className="ml-4 space-y-1 border-l-2 border-border py-1">
                    {extraMembers.map((memberRow) => {
                      const memberKey = `${memberRow.actor_user_id}-${memberRow.id}-${memberRow.occurred_at}`;
                      const memberLine = activityLine(memberRow);
                      // Show only the differing part: the subject (technique/video/syllabus).
                      // Fall back to the verb text when no subject exists (rare).
                      const displayText = memberLine.subject ?? memberLine.verb;
                      const relTime = formatRelativeShort(memberRow.occurred_at);
                      const inner = (
                        <span className="flex min-w-0 items-baseline justify-between gap-2">
                          <span className="truncate">{displayText}</span>
                          <span className="shrink-0 text-muted-foreground">{relTime}</span>
                        </span>
                      );
                      return (
                        <li key={memberKey} className="px-3 text-xs text-muted-foreground">
                          {memberLine.href ? (
                            <Link
                              to={memberLine.href}
                              className="block transition-colors hover:text-foreground"
                            >
                              {inner}
                            </Link>
                          ) : (
                            <span className="block">{inner}</span>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
