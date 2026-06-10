import { useMemo } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import {
  BookOpen,
  ChevronRight,
  GraduationCap,
  NotebookPen,
  Pin,
  UserRound,
} from 'lucide-react';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { useAllUsers, useStudentSyllabuses } from '@/lib/queries';
import { useUser } from '@/lib/current-user-context';
import { isCoachOrAdmin } from '@/lib/api';
import { cn } from '@/lib/utils';
import type { User } from '@/lib/api';

function initials(u: Pick<User, 'display_name' | 'username'>): string {
  const source = u.display_name?.trim() || u.username || '';
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export default function StudentProfilePage() {
  const params = useParams<{ id: string }>();
  const studentId = params.id ? parseInt(params.id, 10) : NaN;
  const viewer = useUser();

  if (!Number.isFinite(studentId)) {
    return <Navigate to="/dashboard" replace />;
  }

  const isOwner = viewer.id === studentId;
  const isCoach = isCoachOrAdmin(viewer);
  if (!isOwner && !isCoach) {
    return <Navigate to="/dashboard" replace />;
  }

  return <ProfileHub studentId={studentId} isOwnView={isOwner} />;
}

function ProfileHub({
  studentId,
  isOwnView,
}: {
  studentId: number;
  isOwnView: boolean;
}) {
  const viewer = useUser();
  // For the owning student we already have the viewer; for coaches we
  // need to fetch the student by id. /api/me only returns the current
  // user, so coaches use the users list (cached, cheap) to resolve.
  const usersQuery = useAllUsers();
  const student: User | undefined = useMemo(() => {
    if (isOwnView) return viewer;
    return (usersQuery.data ?? []).find((u) => u.id === studentId);
  }, [isOwnView, viewer, usersQuery.data, studentId]);
  const syllabusesQuery = useStudentSyllabuses(studentId);
  const assignments = useMemo(
    () => syllabusesQuery.data ?? [],
    [syllabusesQuery.data],
  );

  const loading =
    (!isOwnView && usersQuery.isLoading) || syllabusesQuery.isLoading;

  if (loading || !student) {
    return (
      <div className="container mx-auto px-4 py-6 sm:px-6 md:py-8">
        <div className="flex items-center gap-3">
          <div className="h-12 w-12 animate-pulse rounded-full bg-muted" />
          <div className="space-y-2">
            <div className="h-4 w-32 animate-pulse rounded bg-muted" />
            <div className="h-3 w-24 animate-pulse rounded bg-muted" />
          </div>
        </div>
      </div>
    );
  }

  const displayName = student.display_name || student.username;

  return (
    <div className="container mx-auto space-y-6 px-4 py-6 sm:px-6 md:py-8">
      <section className="flex items-center gap-4">
        <Avatar size="lg" className="shrink-0">
          <AvatarFallback>{initials(student)}</AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <h1 className="flex items-center gap-2 truncate text-base font-semibold">
            {displayName}
            {student.graduated_at && (
              <Badge
                variant="outline"
                className="gap-1 border-status-green/40 text-status-green"
              >
                <GraduationCap className="h-3 w-3" aria-hidden />
                Graduated
              </Badge>
            )}
          </h1>
          {student.display_name &&
            student.display_name !== student.username && (
              <p className="truncate text-xs text-muted-foreground">
                {student.username}
              </p>
            )}
          <p className="mt-1 text-xs capitalize text-muted-foreground">
            {student.role}
          </p>
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {isOwnView ? 'Your spaces' : `${displayName}'s spaces`}
        </h2>
        <div className="overflow-hidden rounded-lg border border-border bg-card">
          <HubLink
            to="/library"
            icon={BookOpen}
            title="Library"
            description={
              isOwnView
                ? 'Every technique in the gym.'
                : "Coach view of the global library."
            }
          />
          <HubLink
            to={`/student/${studentId}/syllabuses`}
            icon={NotebookPen}
            title={isOwnView ? 'My syllabuses' : 'Syllabuses'}
            description={
              assignments.length === 0
                ? 'No active syllabuses yet.'
                : `${assignments.length} active${
                    assignments.length === 1 ? '' : ' syllabuses'
                  }`
            }
          />
          <HubLink
            to={`/student/${studentId}/pinned`}
            icon={Pin}
            title={isOwnView ? 'Pinned' : 'Pinned techniques'}
            description={
              isOwnView
                ? 'Quick-access techniques you have pinned.'
                : 'Techniques this student has pinned.'
            }
            last
          />
        </div>
      </section>

      {assignments.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Active syllabuses
          </h2>
          <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
            {assignments.map((a) => (
              <li key={a.id}>
                <Link
                  to={`/student/${studentId}/syllabuses/${a.syllabus_id}`}
                  className="flex items-center justify-between gap-3 px-4 py-3 transition-colors hover:bg-muted/40"
                >
                  <div className="min-w-0 flex-1 space-y-0.5">
                    <p className="flex items-center gap-2 truncate text-sm font-medium">
                      {a.syllabus_name}
                      {a.graduated_at && (
                        <Badge
                          variant="outline"
                          className="gap-1 border-status-green/40 text-status-green"
                        >
                          <GraduationCap className="h-3 w-3" aria-hidden />
                          Graduated
                        </Badge>
                      )}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {a.total_count}{' '}
                      {a.total_count === 1 ? 'technique' : 'techniques'}
                      {a.green_count > 0 && ` · ${a.green_count} done`}
                      {a.amber_count > 0 && ` · ${a.amber_count} doing`}
                    </p>
                  </div>
                  <ChevronRight
                    className="h-4 w-4 shrink-0 text-muted-foreground"
                    aria-hidden
                  />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function HubLink({
  to,
  icon: Icon,
  title,
  description,
  last,
}: {
  to: string;
  icon: typeof UserRound;
  title: string;
  description: string;
  last?: boolean;
}) {
  return (
    <Link
      to={to}
      className={cn(
        'flex items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/40',
        !last && 'border-b border-border',
      )}
    >
      <Icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{title}</p>
        <p className="truncate text-xs text-muted-foreground">{description}</p>
      </div>
      <ChevronRight
        className="h-4 w-4 shrink-0 text-muted-foreground"
        aria-hidden
      />
    </Link>
  );
}
