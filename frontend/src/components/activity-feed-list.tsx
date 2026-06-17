import { useState } from "react";
import { Link } from "react-router-dom";
import { Dumbbell, Library, NotebookPen } from "lucide-react";
import { StudentAvatar } from "@/components/student-avatar";
import { useUser } from "@/lib/current-user-context";
import { isCoachOrAdmin } from "@/lib/api";
import { activityLine, type ActivityRow, type ActivityScope } from "@/lib/activity-line";
import { statusToDotClass } from "@/lib/status";
import { coalesceActivity } from "@/lib/activity-coalesce";
import { activitySurface } from "@/lib/view-context";
import { formatAbsolute, formatRelativeShort } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { campsUiEnabled } from "@/lib/features";
import { verbIconMeta } from "@/components/activity-feed/verb-icon";

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
  /** Viewing scope: "gym" for a mixed-actor feed, "student" for a single-student profile. Default gym. */
  scope?: ActivityScope;
}

interface RowOptions {
  showAvatar: boolean;
  inlineAvatar: boolean;
  detailed: boolean;
  coalesce: boolean;
  scope: ActivityScope;
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
  const viewer = useUser();
  const line = activityLine(activityRow, opts.scope);
  const surface = activitySurface(activityRow);
  const ariaLabel = `${activityRow.actor_name ?? "A student"} ${line.verb}${line.statusLabel ? ` ${line.statusLabel}` : ""}${line.subject ? ` ${line.statusLabel ? "on " : ""}${line.subject}` : ""}`;
  const hideDup = line.href ? true : undefined;
  const { Icon: VerbIcon, colorClass } = verbIconMeta(activityRow.verb);

  // Coaches/admins can open the actor's profile straight from the avatar or
  // name, overriding the row's activity deep-link. Students can't view other
  // profiles, so they get no actor link. Self is skipped (no own student page).
  const actorHref =
    isCoachOrAdmin(viewer) && activityRow.actor_user_id !== viewer.id
      ? `/student/${activityRow.actor_user_id}`
      : undefined;
  const actorName = activityRow.actor_name ?? "A student";

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
        {showAvatar &&
          (actorHref ? (
            <Link
              to={actorHref}
              aria-label={`View ${actorName}'s profile`}
              className="pointer-events-auto relative z-20 shrink-0 rounded-full"
            >
              <StudentAvatar id={activityRow.actor_user_id} name={activityRow.actor_name ?? "?"} />
            </Link>
          ) : (
            <span aria-hidden={hideDup}>
              <StudentAvatar id={activityRow.actor_user_id} name={activityRow.actor_name ?? "?"} />
            </span>
          ))}
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
              {actorHref ? (
                // Visual shortcut to the profile; the avatar link above carries
                // the accessible name, so this stays out of the tab order.
                <Link
                  to={actorHref}
                  tabIndex={-1}
                  className="pointer-events-auto relative z-20 hover:underline"
                >
                  {actorName}
                </Link>
              ) : (
                actorName
              )}
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
              {line.statusLabel ? (
                <>
                  {" "}
                  <span
                    className={cn("inline-block h-2 w-2 rounded-full align-middle", line.statusColor ? statusToDotClass(line.statusColor) : "")}
                    aria-hidden
                  />
                  {" "}
                  {line.statusLabel}
                  {line.subject ? ` on ${line.subject}` : ""}
                </>
              ) : (
                line.subject ? ` ${line.subject}` : ""
              )}
            </span>
            {trailing}
          </p>
          {line.detail && (
            <p
              aria-hidden={hideDup}
              className={cn("mt-0.5 text-sm text-muted-foreground", detailed ? "" : "truncate")}
            >
              {line.detail}
            </p>
          )}
          {surface && !line.suppressSurface && (
            <span aria-hidden={hideDup} className="mt-1 inline-flex items-center gap-1 text-xs text-muted-foreground">
              {surface.kind === "syllabus" ? (
                <NotebookPen className="h-3 w-3 shrink-0" aria-hidden />
              ) : surface.kind === "camp" ? (
                <Dumbbell className="h-3 w-3 shrink-0" aria-hidden />
              ) : (
                <Library className="h-3 w-3 shrink-0" aria-hidden />
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
  scope = { kind: "gym" },
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

  // Camps + competitions/matches are gated off on prod (campsUiEnabled). Drop
  // their activity rows so the feed doesn't surface links into hidden surfaces.
  const visibleRows = campsUiEnabled
    ? rows
    : rows.filter((row) => {
        const kind = activitySurface(row)?.kind;
        return kind !== "camp" && kind !== "competition" && kind !== "match";
      });

  if (visibleRows.length === 0) {
    return <p className="px-6 py-8 text-center text-sm text-muted-foreground">{emptyText}</p>;
  }

  const items = coalesce
    ? coalesceActivity(visibleRows)
    : visibleRows.map((row) => ({ row, count: 1, extraTechniques: [], members: [row] }));
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

        const opts: RowOptions = { showAvatar, inlineAvatar, detailed, coalesce, scope, trailing: expandToggle };

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
                      const memberLine = activityLine(memberRow, scope);
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
