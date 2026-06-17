import { Link } from 'react-router-dom';
import type { SyllabusAssignment } from '@/lib/api';
import { cn } from '@/lib/utils';

export function SyllabusAssignmentRow({
  studentId,
  assignment,
}: {
  studentId: number;
  assignment: SyllabusAssignment;
}) {
  return (
    <Link
      to={`/student/${studentId}/syllabi/${assignment.syllabus_id}`}
      className="flex items-start justify-between gap-3 px-4 py-3 transition-colors hover:bg-muted/40"
    >
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold">{assignment.syllabus_name}</p>
        {assignment.total_count > 0 && (
          <p className="mt-0.5 text-xs text-muted-foreground">
            {assignment.total_count}{' '}
            {assignment.total_count === 1 ? 'technique' : 'techniques'}
          </p>
        )}
      </div>
      <ProgressChips
        red={assignment.red_count}
        amber={assignment.amber_count}
        green={assignment.green_count}
      />
    </Link>
  );
}

function ProgressChips({
  red,
  amber,
  green,
}: {
  red: number;
  amber: number;
  green: number;
}) {
  return (
    <div className="flex shrink-0 items-center gap-1 text-xs">
      <Chip color="bg-status-red/80" label="Red" value={red} />
      <Chip color="bg-status-amber/80" label="Amber" value={amber} />
      <Chip color="bg-status-green/80" label="Green" value={green} />
    </div>
  );
}

function Chip({
  color,
  label,
  value,
}: {
  color: string;
  label: string;
  value: number;
}) {
  return (
    <span
      className={cn(
        'flex h-6 min-w-6 items-center justify-center rounded-full px-1.5 text-[10px] font-semibold text-foreground/90',
        color,
        value === 0 && 'opacity-40',
      )}
      title={`${label}: ${value}`}
    >
      {value}
    </span>
  );
}
