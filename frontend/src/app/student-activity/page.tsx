import { useMemo } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import { History } from 'lucide-react';
import { ActivityFeedList } from '@/components/activity-feed-list';
import { useStudentActivityFeed, useAllUsers } from '@/lib/queries';
import { useUser } from '@/lib/current-user-context';
import { isCoachOrAdmin } from '@/lib/api';

export default function StudentActivityPage() {
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

  return <ActivityHub studentId={studentId} isOwnView={isOwner} />;
}

function ActivityHub({
  studentId,
  isOwnView,
}: {
  studentId: number;
  isOwnView: boolean;
}) {
  const viewer = useUser();
  const usersQuery = useAllUsers();
  const student = useMemo(() => {
    if (isOwnView) return viewer;
    return (usersQuery.data ?? []).find((u) => u.id === studentId);
  }, [isOwnView, viewer, usersQuery.data, studentId]);

  const feedQuery = useStudentActivityFeed(studentId, 100);

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

  const title = isOwnView ? 'Your activity' : `${displayName}'s activity`;

  return (
    <div className="container mx-auto px-4 py-6 sm:px-6 md:py-8 space-y-4">
      <div>
        <h1 className="flex items-center gap-2 text-base font-semibold">
          <History className="h-4 w-4" aria-hidden />
          {title}
        </h1>
      </div>
      <div className="overflow-hidden rounded-lg border border-border bg-card">
        <ActivityFeedList
          rows={feedQuery.data ?? []}
          isLoading={feedQuery.isLoading}
          showAvatar={false}
          detailed
          emptyText="No activity recorded yet."
        />
      </div>
    </div>
  );
}
