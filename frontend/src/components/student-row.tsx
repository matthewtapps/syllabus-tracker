import { type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Archive, ChevronRight, Clock, GraduationCap, PlayCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import type { User } from "@/lib/api";
import { cn } from "@/lib/utils";
import { formatRelative } from "@/lib/dates";
import { StudentAvatar } from "@/components/student-avatar";

const WATCH_RECENT_DAYS = 7;

interface StudentRowProps {
  student: User;
  href?: string;
  className?: string;
  actions?: ReactNode;
  showWatchTitle?: boolean;
}

export function StudentRow({
  student,
  href,
  className,
  actions,
  showWatchTitle,
}: StudentRowProps) {
  const total = student.total_techniques ?? 0;
  const green = student.green_count ?? 0;
  const amber = student.amber_count ?? 0;
  const progressPct = total > 0 ? Math.round((green / total) * 100) : 0;
  const target = href ?? `/student/${student.id}`;
  const displayName = student.display_name || student.username;
  const hasSecondary = student.display_name && student.display_name !== student.username;

  let watchedRecently = false;
  if (student.last_watch_at) {
    const ts = Date.parse(student.last_watch_at);
    if (Number.isFinite(ts)) {
      watchedRecently = ts >= Date.now() - WATCH_RECENT_DAYS * 86400 * 1000;
    }
  }

  return (
    <div
      className={cn(
        "group flex items-center gap-2 pr-2 transition-colors hover:bg-muted/40 focus-within:bg-muted/40",
        className,
      )}
    >
      <Link
        to={target}
        className="flex min-w-0 flex-1 items-center gap-4 px-4 py-4 focus-visible:outline-none"
      >
        <StudentAvatar id={student.id} name={student.display_name || student.username} size="lg" />

        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex items-center gap-2">
            <span className="truncate font-medium">{displayName}</span>
            {student.graduated_at && (
              <Badge
                variant="outline"
                className="shrink-0 gap-1 border-status-green/40 text-status-green"
              >
                <GraduationCap className="h-3 w-3" aria-hidden />
                Graduated
              </Badge>
            )}
            {student.archived && (
              <Badge variant="outline" className="shrink-0 gap-1 text-muted-foreground">
                <Archive className="h-3 w-3" aria-hidden />
                Archived
              </Badge>
            )}
            {student.has_unseen_activity && !student.graduated_at && (
              <span
                className="inline-flex h-2 w-2 shrink-0 rounded-full bg-primary"
                aria-label="New student activity"
                title="New student activity since you last looked"
              />
            )}
            {watchedRecently && !student.graduated_at && !showWatchTitle && (
              <Badge
                variant="outline"
                className="shrink-0 gap-1 border-primary/40 px-1.5 py-0 text-[10px] font-medium text-primary"
                title="Watched a video in the last 7 days"
              >
                <PlayCircle className="h-3 w-3" aria-hidden />
                Watching
              </Badge>
            )}
          </div>

          {hasSecondary && (
            <p className="truncate text-xs text-muted-foreground">
              {student.username}
            </p>
          )}

          {showWatchTitle && watchedRecently && student.last_watch_video_title && (
            <p className="flex min-w-0 items-center gap-1.5 text-xs text-primary">
              <PlayCircle className="h-3.5 w-3.5 shrink-0" aria-hidden />
              <span className="truncate">
                Watched &lsquo;{student.last_watch_video_title}&rsquo;
                {student.last_watch_at && ` · ${formatRelative(student.last_watch_at)}`}
              </span>
            </p>
          )}

          {total > 0 ? (
            <div className="flex items-center gap-3">
              <Progress value={progressPct} className="h-1.5 max-w-40" />
              <span className="shrink-0 text-xs text-muted-foreground">
                {green}/{total} done
                {amber > 0 && ` · ${amber} doing`}
              </span>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">No techniques assigned</p>
          )}
        </div>

        <div className="hidden shrink-0 items-center gap-1.5 text-xs text-muted-foreground sm:flex">
          <Clock className="h-3.5 w-3.5" aria-hidden />
          <span>{formatRelative(student.last_update)}</span>
        </div>
      </Link>

      {actions ? (
        <div className="shrink-0">{actions}</div>
      ) : (
        <ChevronRight
          className="mr-2 h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
          aria-hidden
        />
      )}
    </div>
  );
}
