import { useMemo } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { NotebookPen } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/empty-state';
import { useStudentSyllabuses } from '@/lib/queries';
import { useUser } from '@/lib/current-user-context';
import { isCoachOrAdmin } from '@/lib/api';
import { cn } from '@/lib/utils';

export default function StudentSyllabusesPage() {
  const params = useParams<{ id: string }>();
  const studentId = params.id ? parseInt(params.id, 10) : NaN;
  const user = useUser();

  if (!Number.isFinite(studentId)) {
    return <Navigate to="/dashboard" replace />;
  }

  const isOwner = user.id === studentId;
  const isCoach = isCoachOrAdmin(user);
  if (!isOwner && !isCoach) {
    return <Navigate to="/dashboard" replace />;
  }

  return <StudentSyllabusesList studentId={studentId} isOwnView={isOwner} />;
}

function StudentSyllabusesList({
  studentId,
  isOwnView,
}: {
  studentId: number;
  isOwnView: boolean;
}) {
  const query = useStudentSyllabuses(studentId);
  const assignments = useMemo(() => query.data ?? [], [query.data]);
  const loading = query.isLoading;
  const error = query.error ? 'Failed to load syllabuses.' : null;

  return (
    <div className="container mx-auto px-4 py-6 sm:px-6 md:py-8">
      <div className="mb-4">
        <h1 className="flex items-center gap-2 text-base font-semibold">
          <NotebookPen className="h-4 w-4" aria-hidden />
          {isOwnView ? 'My syllabuses' : 'Syllabuses'}
        </h1>
        <p className="text-xs text-muted-foreground">
          {isOwnView
            ? 'Coach-curated paths you are currently working through.'
            : 'Syllabuses this student is currently working through.'}
        </p>
      </div>

      <div className="overflow-hidden rounded-lg border border-border bg-card">
        {loading ? (
          <div className="divide-y divide-border">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="px-4 py-4">
                <div className="h-4 w-1/3 animate-pulse rounded bg-muted" />
                <div className="mt-2 h-3 w-2/3 animate-pulse rounded bg-muted" />
              </div>
            ))}
          </div>
        ) : error ? (
          <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
            <p className="text-sm text-destructive">{error}</p>
            <Button variant="outline" onClick={() => window.location.reload()}>
              Try again
            </Button>
          </div>
        ) : assignments.length === 0 ? (
          <EmptyState
            icon={NotebookPen}
            title="No syllabuses yet"
            description={
              isOwnView
                ? 'A coach has not assigned you a syllabus yet.'
                : 'This student has no active syllabus assignments.'
            }
          />
        ) : (
          <ul className="divide-y divide-border">
            {assignments.map((a) => (
              <li key={a.id}>
                <Link
                  to={`/student/${studentId}/syllabuses/${a.syllabus_id}`}
                  className="flex items-start justify-between gap-3 px-4 py-3 transition-colors hover:bg-muted/40"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">
                      {a.syllabus_name}
                    </p>
                    {a.total_count > 0 && (
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {a.total_count}{' '}
                        {a.total_count === 1 ? 'technique' : 'techniques'}
                      </p>
                    )}
                  </div>
                  <ProgressChips
                    red={a.red_count}
                    amber={a.amber_count}
                    green={a.green_count}
                  />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
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
