import { useMemo, useState } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import { NotebookPen, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/empty-state';
import { useAllUsers, useStudentSyllabi } from '@/lib/queries';
import { useUser } from '@/lib/current-user-context';
import { isCoachOrAdmin } from '@/lib/api';
import { AssignSyllabusDialog } from './components/assign-syllabus-dialog';
import { SyllabusAssignmentRow } from './components/syllabus-assignment-row';

export default function StudentSyllabiPage() {
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

  return <StudentSyllabiList studentId={studentId} isOwnView={isOwner} />;
}

function StudentSyllabiList({
  studentId,
  isOwnView,
}: {
  studentId: number;
  isOwnView: boolean;
}) {
  const query = useStudentSyllabi(studentId);
  const usersQuery = useAllUsers();
  const assignments = useMemo(() => query.data ?? [], [query.data]);
  const studentName = useMemo(() => {
    if (isOwnView) return null;
    const u = (usersQuery.data ?? []).find((u) => u.id === studentId);
    return u ? u.display_name || u.username : null;
  }, [isOwnView, usersQuery.data, studentId]);
  const assignedIds = useMemo(
    () => new Set(assignments.map((a) => a.syllabus_id)),
    [assignments],
  );
  const [assignOpen, setAssignOpen] = useState(false);
  const loading = query.isLoading;
  const error = query.error ? 'Failed to load syllabi.' : null;

  const title = isOwnView
    ? 'My Syllabus Library'
    : studentName
      ? `${studentName}'s Syllabus Library`
      : 'Syllabus Library';

  return (
    <div className="container mx-auto px-4 py-6 sm:px-6 md:py-8">
      <div className="mb-4 flex items-center justify-between gap-2">
        <h1 className="flex items-center gap-2 text-base font-semibold">
          <NotebookPen className="h-4 w-4" aria-hidden />
          {title}
        </h1>
        {!isOwnView && (
          <Button size="sm" className="shrink-0" onClick={() => setAssignOpen(true)}>
            <Plus className="mr-2 h-4 w-4" aria-hidden />
            Assign syllabus
          </Button>
        )}
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
            title="No syllabi yet"
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
                <SyllabusAssignmentRow studentId={studentId} assignment={a} />
              </li>
            ))}
          </ul>
        )}
      </div>

      {!isOwnView && (
        <AssignSyllabusDialog
          open={assignOpen}
          onOpenChange={setAssignOpen}
          studentId={studentId}
          studentName={studentName}
          assignedIds={assignedIds}
        />
      )}
    </div>
  );
}
