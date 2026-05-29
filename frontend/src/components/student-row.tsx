import { Link } from "react-router-dom";
import { ChevronRight, Clock, GraduationCap } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import type { User } from "@/lib/api";
import { cn } from "@/lib/utils";
import { formatRelative } from "@/lib/dates";

function initials(user: Pick<User, "display_name" | "username">): string {
  const source = user.display_name?.trim() || user.username || "";
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

interface StudentRowProps {
  student: User;
  href?: string;
  className?: string;
}

export function StudentRow({ student, href, className }: StudentRowProps) {
  const total = student.total_techniques ?? 0;
  const green = student.green_count ?? 0;
  const amber = student.amber_count ?? 0;
  const progressPct = total > 0 ? Math.round((green / total) * 100) : 0;
  const target = href ?? `/student/${student.id}`;
  const displayName = student.display_name || student.username;
  const hasSecondary = student.display_name && student.display_name !== student.username;

  return (
    <Link
      to={target}
      className={cn(
        "group flex items-center gap-4 px-4 py-4 transition-colors hover:bg-muted/40 focus-visible:bg-muted/40 focus-visible:outline-none",
        className,
      )}
    >
      <Avatar size="lg" className="shrink-0">
        <AvatarFallback>{initials(student)}</AvatarFallback>
      </Avatar>

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
          {student.has_new_student_activity && !student.graduated_at && (
            <span
              className="inline-flex h-2 w-2 shrink-0 rounded-full bg-primary"
              aria-label="New student activity"
              title="New student activity since your last update"
            />
          )}
        </div>

        {hasSecondary && (
          <p className="truncate text-xs text-muted-foreground">
            {student.username}
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

      <ChevronRight
        className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
        aria-hidden
      />
    </Link>
  );
}
