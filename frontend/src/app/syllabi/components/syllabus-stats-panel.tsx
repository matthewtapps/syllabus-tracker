import { Link } from 'react-router-dom';
import { GraduationCap } from 'lucide-react';
import { useSyllabusStats } from '@/lib/queries';
import { formatRelative } from '@/lib/dates';

export function SyllabusStatsPanel({ syllabusId }: { syllabusId: number }) {
  const statsQuery = useSyllabusStats(syllabusId);
  const stats = statsQuery.data;

  if (statsQuery.isLoading) {
    return (
      <div className="rounded-lg border border-border bg-card p-4">
        <div className="h-10 animate-pulse rounded bg-muted" />
      </div>
    );
  }
  if (!stats) return null;

  if (stats.assigned_count === 0) {
    return (
      <div className="rounded-lg border border-border bg-card px-4 py-3 text-xs text-muted-foreground">
        Nobody is working through this syllabus yet.
      </div>
    );
  }

  const tiles: { label: string; value: number }[] = [
    { label: 'Assigned', value: stats.assigned_count },
    { label: 'In progress', value: stats.in_progress },
    { label: 'Ready', value: stats.ready_to_graduate },
    { label: 'Graduated', value: stats.graduated },
  ];

  return (
    <div className="space-y-2 rounded-lg border border-border bg-card p-4">
      <div className="grid grid-cols-4 gap-2">
        {tiles.map((tile) => (
          <div key={tile.label}>
            <p className="text-lg font-semibold tabular-nums">{tile.value}</p>
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
              {tile.label}
            </p>
          </div>
        ))}
      </div>

      {stats.not_started > 0 && (
        <p className="text-xs text-muted-foreground">
          {stats.not_started} {stats.not_started === 1 ? 'student has' : 'students have'} not
          started.
        </p>
      )}

      {stats.ready_to_graduate > 0 && (
        <p className="flex items-center gap-1.5 text-xs text-emerald-600">
          <GraduationCap className="h-3.5 w-3.5 shrink-0" aria-hidden />
          {stats.ready_to_graduate === 1
            ? '1 student has finished everything and can graduate.'
            : `${stats.ready_to_graduate} students have finished everything and can graduate.`}
        </p>
      )}

      {stats.recently_updated.length > 0 && (
        <div className="space-y-1 border-t border-border pt-2">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
            Recently updated
          </p>
          <ul className="space-y-0.5">
            {stats.recently_updated.map((student) => (
              <li key={student.student_id} className="text-xs">
                <Link
                  to={`/student/${student.student_id}/syllabi/${syllabusId}`}
                  className="hover:underline"
                >
                  {student.name}
                </Link>
                <span className="text-muted-foreground">
                  {' '}
                  {formatRelative(student.at)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
