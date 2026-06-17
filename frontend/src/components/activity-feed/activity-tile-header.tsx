import { Link } from "react-router-dom";
import { Dumbbell, Library, NotebookPen } from "lucide-react";
import { StudentAvatar } from "@/components/student-avatar";
import { activityLine, type ActivityRow, type ActivityScope } from "@/lib/activity-line";
import { verbIconMeta } from "./verb-icon";
import { activitySurface } from "@/lib/view-context";
import { statusToDotClass } from "@/lib/status";
import { formatRelativeShort } from "@/lib/dates";
import { cn } from "@/lib/utils";

/**
 * The "who did what, when" header above a feed tile. The header (not the tile)
 * carries the deep-link to the source surface, so the tile beneath stays free
 * to expand in place without the nested-interactive-inside-a-link trap.
 */
export function ActivityTileHeader({
  row,
  scope,
  showAvatar = true,
}: {
  row: ActivityRow;
  scope: ActivityScope;
  showAvatar?: boolean;
}) {
  const line = activityLine(row, scope);
  const surface = activitySurface(row);
  const { Icon: VerbIcon, colorClass } = verbIconMeta(row.verb);
  const actorName = row.actor_name ?? "A student";

  const body = (
    <div className="flex items-start gap-3 px-4 py-3">
      {showAvatar && <StudentAvatar id={row.actor_user_id} name={row.actor_name ?? "?"} />}
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <p className="truncate text-sm font-medium">{actorName}</p>
          <span className="shrink-0 text-xs text-muted-foreground">
            {formatRelativeShort(row.occurred_at)}
          </span>
        </div>
        <p className="mt-0.5 text-sm text-muted-foreground">
          <VerbIcon
            className={cn("mr-1 inline-block h-4 w-4 align-text-bottom", colorClass)}
            aria-hidden
          />
          {line.verb}
          {line.statusLabel ? (
            <>
              {" "}
              <span
                className={cn(
                  "inline-block h-2 w-2 rounded-full align-middle",
                  line.statusColor ? statusToDotClass(line.statusColor) : "",
                )}
                aria-hidden
              />{" "}
              {line.statusLabel}
              {line.subject ? ` on ${line.subject}` : ""}
            </>
          ) : line.subject ? (
            ` ${line.subject}`
          ) : (
            ""
          )}
        </p>
        {surface && !line.suppressSurface && (
          <span className="mt-1 inline-flex items-center gap-1 text-xs text-muted-foreground">
            {surface.kind === "syllabus" ? (
              <NotebookPen className="h-3 w-3 shrink-0" aria-hidden />
            ) : surface.kind === "camp" ? (
              <Dumbbell className="h-3 w-3 shrink-0" aria-hidden />
            ) : (
              <Library className="h-3 w-3 shrink-0" aria-hidden />
            )}
            <span className="truncate">{surface.label}</span>
          </span>
        )}
      </div>
    </div>
  );

  return line.href ? (
    <Link to={line.href} className="block transition-colors hover:bg-muted/40">
      {body}
    </Link>
  ) : (
    body
  );
}
