import { Link } from "react-router-dom";
import { StudentAvatar } from "@/components/student-avatar";
import { activityLine, type ActivityRow } from "@/lib/activity-line";
import { coalesceActivity, coalescedSuffix } from "@/lib/activity-coalesce";
import { formatRelative } from "@/lib/dates";

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
 * Presentational activity list shared by the coach dashboard, the student
 * profile, and other surfaces. It renders ActivityRow[] only. Callers choose
 * the data source, which is what makes it audience-agnostic (a coach passes
 * student activity, a student passes their own / coach activity).
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
            <div className="mt-2 h-3 w-1/4 animate-pulse rounded bg-muted" />
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
        const text = line.text + coalescedSuffix(item);
        return (
          <li
            key={`${item.row.actor_user_id}-${item.row.id}-${item.row.occurred_at}`}
            className="flex items-center gap-3 px-4 py-3"
          >
            {showAvatar && (
              <StudentAvatar id={item.row.actor_user_id} name={item.row.actor_name ?? "?"} />
            )}
            <div className="min-w-0 flex-1 space-y-0.5">
              <p className="truncate text-sm font-medium">{item.row.actor_name ?? "A student"}</p>
              <p className="truncate text-xs text-muted-foreground">
                {line.href ? (
                  <Link to={line.href} className="underline-offset-2 hover:underline">
                    {text}
                  </Link>
                ) : (
                  text
                )}
              </p>
            </div>
            <span className="shrink-0 text-xs text-muted-foreground">
              {formatRelative(item.row.occurred_at)}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
