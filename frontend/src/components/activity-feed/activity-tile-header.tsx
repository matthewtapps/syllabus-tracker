import { Link } from "react-router-dom";
import { ChevronRight, Dumbbell, Library, NotebookPen } from "lucide-react";
import { StudentAvatar } from "@/components/student-avatar";
import { useUser } from "@/lib/current-user-context";
import { isCoachOrAdmin } from "@/lib/api";
import { activityLine, type ActivityRow, type ActivityScope } from "@/lib/activity-line";
import { activityCaption } from "@/lib/activity-caption";
import { verbIconMeta } from "./verb-icon";
import { activitySurface } from "@/lib/view-context";
import { statusToDotClass } from "@/lib/status";
import { formatRelativeShort } from "@/lib/dates";
import { cn } from "@/lib/utils";

/**
 * The header above a feed tile: a tappable breadcrumb of who acted, on whom, and
 * in what context, plus a minimal verb caption. Each breadcrumb segment is its
 * own link to that destination (profile / surface); the embedded tile below
 * carries the noun itself, so the caption never repeats the technique name.
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
  const viewer = useUser();
  const line = activityLine(row, scope);
  const surface = activitySurface(row);
  const caption = activityCaption(row);
  const { Icon: VerbIcon, colorClass } = verbIconMeta(row.verb);

  // Coaches/admins can open a profile from the actor/target name; students
  // cannot view other profiles, so they get plain text.
  const viewerIsCoach = isCoachOrAdmin(viewer);
  const actorName = row.actor_name ?? "A student";
  const actorHref =
    viewerIsCoach && row.actor_user_id !== viewer.id
      ? `/student/${row.actor_user_id}`
      : undefined;

  // The target student is only worth naming on the gym feed (a single-student
  // surface already establishes whose activity this is), and only when a coach
  // acted on someone other than themselves.
  const showTarget =
    scope.kind === "gym" &&
    row.target_student_id != null &&
    row.target_student_id !== row.actor_user_id &&
    row.target_student_name != null;
  const targetHref = viewerIsCoach ? `/student/${row.target_student_id}` : undefined;

  const segmentClass = "truncate hover:underline";

  return (
    <div className="px-4 py-3">
      <div className="flex items-start gap-3">
        {showAvatar && <StudentAvatar id={row.actor_user_id} name={row.actor_name ?? "?"} />}
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <div className="flex min-w-0 flex-wrap items-center gap-x-1 gap-y-0.5 text-sm font-medium">
              {actorHref ? (
                <Link to={actorHref} className={segmentClass}>
                  {actorName}
                </Link>
              ) : (
                <span className="truncate">{actorName}</span>
              )}
              {showTarget && (
                <>
                  <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden />
                  {targetHref ? (
                    <Link to={targetHref} className={segmentClass}>
                      {row.target_student_name}
                    </Link>
                  ) : (
                    <span className="truncate">{row.target_student_name}</span>
                  )}
                </>
              )}
              {surface && (
                <>
                  <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="flex min-w-0 items-center gap-1 font-normal text-muted-foreground">
                    {surface.kind === "syllabus" ? (
                      <NotebookPen className="h-3 w-3 shrink-0" aria-hidden />
                    ) : surface.kind === "camp" ? (
                      <Dumbbell className="h-3 w-3 shrink-0" aria-hidden />
                    ) : (
                      <Library className="h-3 w-3 shrink-0" aria-hidden />
                    )}
                    {line.href ? (
                      <Link to={line.href} className={segmentClass}>
                        {surface.label}
                      </Link>
                    ) : (
                      <span className="truncate">{surface.label}</span>
                    )}
                  </span>
                </>
              )}
            </div>
            <span className="shrink-0 text-xs text-muted-foreground">
              {formatRelativeShort(row.occurred_at)}
            </span>
          </div>
          <p className="mt-0.5 text-sm text-muted-foreground">
            <VerbIcon
              className={cn("mr-1 inline-block h-4 w-4 align-text-bottom", colorClass)}
              aria-hidden
            />
            {caption.text}
            {caption.statusLabel && (
              <>
                {" "}
                <span
                  className={cn(
                    "inline-block h-2 w-2 rounded-full align-middle",
                    caption.statusColor ? statusToDotClass(caption.statusColor) : "",
                  )}
                  aria-hidden
                />{" "}
                {caption.statusLabel}
              </>
            )}
          </p>
        </div>
      </div>
    </div>
  );
}
