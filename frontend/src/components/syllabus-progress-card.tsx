import { Link } from "react-router-dom";
import { GraduationCap } from "lucide-react";
import type { SyllabusAssignment } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { formatRelative } from "@/lib/dates";

export function SyllabusProgressCard({
  studentId,
  assignment,
}: {
  studentId: number;
  assignment: SyllabusAssignment;
}) {
  const { green_count, amber_count, red_count, total_count } = assignment;
  const percent = total_count > 0 ? Math.round((green_count / total_count) * 100) : 0;
  const ready =
    assignment.graduated_at === null && total_count > 0 && green_count === total_count;

  return (
    <Link
      to={`/student/${studentId}/syllabi/${assignment.syllabus_id}`}
      className="block space-y-2 rounded-lg border border-border bg-card p-4 transition-colors hover:bg-muted/40"
    >
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 truncate text-sm font-semibold">
          {assignment.syllabus_name}
        </p>
        {assignment.graduated_at ? (
          <Badge variant="outline" className="shrink-0 gap-1 text-muted-foreground">
            <GraduationCap className="h-3 w-3" aria-hidden />
            Graduated
          </Badge>
        ) : (
          ready && (
            <Badge
              variant="outline"
              className="shrink-0 gap-1 border-emerald-600 text-emerald-600"
            >
              <GraduationCap className="h-3 w-3" aria-hidden />
              Ready
            </Badge>
          )
        )}
      </div>

      {total_count > 0 && (
        <>
          <Progress value={percent} className="h-1.5" />
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span>{green_count} done</span>
            <span>{amber_count} doing</span>
            <span>{red_count} to start</span>
            <span className="tabular-nums">{percent}%</span>
          </div>
        </>
      )}

      <p className="text-xs text-muted-foreground">
        {assignment.last_activity_at
          ? `Last touched ${formatRelative(assignment.last_activity_at).toLowerCase()}`
          : "No activity yet"}
        {assignment.recent_attempt_count > 0 &&
          ` · ${assignment.recent_attempt_count} ${
            assignment.recent_attempt_count === 1 ? "attempt" : "attempts"
          } this week`}
      </p>
    </Link>
  );
}
