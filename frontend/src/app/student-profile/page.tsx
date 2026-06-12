import { useMemo } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import {
  BookOpen,
  ChevronRight,
  History,
  MessageSquare,
  NotebookPen,
  Pin,
  UserRound,
} from 'lucide-react';
import { toast } from 'sonner';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import {
  useStudentActivityFeed,
  useAllUsers,
  useThreadsForAnchor,
} from '@/lib/queries';
import { useCreateThread } from '@/lib/mutations';
import { useUser } from '@/lib/current-user-context';
import { isCoachOrAdmin } from '@/lib/api';
import { cn } from '@/lib/utils';
import { ActivityFeedList } from '@/components/activity-feed-list';
import { ThreadView } from '@/components/threads/thread-view';
import { ThreadComposer } from '@/components/threads/thread-composer';
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
  // Use the student-scoped feed so a coach sees only THIS student's activity
  // rather than the gym-wide coach feed.
  const feedQuery = useStudentActivityFeed(studentId);
  const profileThreadsQuery = useThreadsForAnchor("student_profile", studentId);
  const createProfileThread = useCreateThread();
  async function startProfileThread(body: string) {
    try {
      await createProfileThread.mutateAsync({
        anchor_kind: "student_profile",
        anchor_id: studentId,
        visibility: "private",
        scope_student_id: studentId,
        body,
      });
    } catch {
      toast.error("Couldn't post your thread.");
    }
  }

  const loading = !isOwnView && usersQuery.isLoading;

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
          {/* The Library is a global gym-wide resource. Students see a link
            * to their own library view; coaches don't need it here since
            * the Library nav entry already takes them there. */}
          {isOwnView && (
            <HubLink to="/library" icon={BookOpen} title="Library" />
          )}
          <HubLink
            to={`/student/${studentId}/syllabi`}
            icon={NotebookPen}
            title={isOwnView ? 'My syllabi' : 'Syllabi'}
          />
          <HubLink
            to={`/student/${studentId}/pinned`}
            icon={Pin}
            title={isOwnView ? 'Pinned' : 'Pinned techniques'}
            last
          />
        </div>
      </section>

      {/* Discussion */}
      <section className="space-y-2">
        <h2 className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          <MessageSquare className="h-3.5 w-3.5" aria-hidden />
          Discussion
        </h2>
        <div className="space-y-4 rounded-lg border border-border bg-card p-4">
          {profileThreadsQuery.isLoading ? (
            <div className="h-4 w-1/3 animate-pulse rounded bg-muted" />
          ) : (profileThreadsQuery.data ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">No discussion yet. Start one below.</p>
          ) : (
            (profileThreadsQuery.data ?? []).map((t) => (
              <ThreadView key={t.id} thread={t} anchorKind="student_profile" anchorId={studentId} />
            ))
          )}
          <ThreadComposer
            placeholder={`Start a thread with ${student.display_name ?? "this student"}…`}
            submitLabel="Post"
            pending={createProfileThread.isPending}
            onSubmit={startProfileThread}
          />
        </div>
      </section>

      <section className="space-y-2">
        <div className="flex items-center gap-2">
          <h2 className="flex flex-1 items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            <History className="h-3.5 w-3.5" aria-hidden />
            Recent activity
          </h2>
          <Link
            to={`/student/${studentId}/activity`}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            See all
          </Link>
        </div>
        <div className="overflow-hidden rounded-lg border border-border bg-card">
          <ActivityFeedList
            rows={feedQuery.data ?? []}
            isLoading={feedQuery.isLoading}
            showAvatar={false}
            inlineAvatar
            emptyText="No activity recorded yet."
          />
        </div>
      </section>
    </div>
  );
}

function HubLink({
  to,
  icon: Icon,
  title,
  last,
}: {
  to: string;
  icon: typeof UserRound;
  title: string;
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
      <p className="min-w-0 flex-1 truncate text-sm font-medium">{title}</p>
      <ChevronRight
        className="h-4 w-4 shrink-0 text-muted-foreground"
        aria-hidden
      />
    </Link>
  );
}
