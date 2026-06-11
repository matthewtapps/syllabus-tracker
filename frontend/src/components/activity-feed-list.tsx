import { Link } from "react-router-dom";
import { StudentAvatar } from "@/components/student-avatar";
import { activityLine, type ActivityRow } from "@/lib/activity-line";
import { coalesceActivity, coalescedSuffix } from "@/lib/activity-coalesce";
import { formatRelativeShort } from "@/lib/dates";
import { cn } from "@/lib/utils";

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

  return (
    <ul className="divide-y divide-border">
      {shown.map((item) => {
        const line = activityLine(item.row);
        const subject = line.subject
          ? `${line.subject}${coalescedSuffix(item)}`
          : coalescedSuffix(item).trim() || undefined;

        const inner = (
          <>
            {showAvatar && (
              <StudentAvatar
                id={item.row.actor_user_id}
                name={item.row.actor_name ?? "?"}
              />
            )}
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-2">
                <p className="truncate text-sm font-medium">
                  {item.row.actor_name ?? "A student"}
                </p>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {formatRelativeShort(item.row.occurred_at)}
                </span>
              </div>
              <p className="mt-0.5 text-sm text-muted-foreground">
                {subject ? `${line.verb} ${subject}` : line.verb}
              </p>
            </div>
          </>
        );

        const rowClasses = "flex items-start gap-3 px-4 py-3";
        const key = `${item.row.actor_user_id}-${item.row.id}-${item.row.occurred_at}`;
        return (
          <li key={key}>
            {line.href ? (
              <Link
                to={line.href}
                className={cn(rowClasses, "transition-colors hover:bg-muted/40")}
              >
                {inner}
              </Link>
            ) : (
              <div className={rowClasses}>{inner}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
