import { useNavigate, useParams } from 'react-router-dom';
import { Sparkles } from 'lucide-react';
import {
  isCoachOrAdmin,
  type FeedItem,
  type User,
} from '@/lib/api';
import { useStudentFeed, useStudentTechniques } from '@/lib/queries';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/empty-state';
import { SkeletonListRow } from '@/components/skeleton-row';
import { formatRelative } from '@/lib/dates';
import { ActivityFeedItem } from '@/components/feed/activity-feed-item';
import {
  TechniqueSlim,
  techniqueAccent,
} from '@/components/feed/technique-slim';
import {
  RankChangeSlim,
  rankChangeAccent,
} from '@/components/feed/rank-change-slim';

interface ActivityPageProps {
  user: User;
}

export default function ActivityPage({ user }: ActivityPageProps) {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const studentId = id ? parseInt(id, 10) : user.id;
  const isOwnView = studentId === user.id;
  const canViewOthers = isCoachOrAdmin(user);

  const feedQuery = useStudentFeed(studentId);
  // For the title chrome; the optimization to a dedicated profile-only
  // endpoint lives in a follow-up. Mirrors how /pins fetches the student
  // record today.
  const studentTechniquesQuery = useStudentTechniques(studentId);

  if (!isOwnView && !canViewOthers) {
    return (
      <div className="container mx-auto px-4 py-6">
        <p className="text-sm text-destructive">Not authorized.</p>
      </div>
    );
  }

  const studentName =
    studentTechniquesQuery.data?.student.display_name ??
    studentTechniquesQuery.data?.student.username ??
    `Student ${studentId}`;
  const items = feedQuery.data?.items ?? null;

  return (
    <div className="container mx-auto max-w-3xl px-4 py-6 sm:px-6 md:py-8">
      <div className="mb-6 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
            {isOwnView ? 'My activity' : `${studentName} · activity`}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {isOwnView
              ? 'Recent updates across your syllabus, attempts, pins, and grading events.'
              : `Recent updates across ${studentName}'s syllabus, attempts, pins, and grading events.`}
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() =>
            navigate(
              isOwnView
                ? `/student/${user.id}/syllabus`
                : `/student/${studentId}/syllabus`,
            )
          }
        >
          View syllabus
        </Button>
      </div>

      {feedQuery.isLoading ? (
        <ul className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <li key={i} className="overflow-hidden rounded-lg border border-border bg-card">
              <SkeletonListRow />
            </li>
          ))}
        </ul>
      ) : feedQuery.error ? (
        <EmptyState
          icon={Sparkles}
          title="Couldn't load the activity feed"
          description="Try refreshing in a moment."
        />
      ) : !items || items.length === 0 ? (
        <EmptyState
          icon={Sparkles}
          title="No activity yet"
          description={
            isOwnView
              ? 'Activity from your techniques, attempts, and grading will show up here.'
              : `${studentName} hasn't had any activity yet. Their techniques and grading events will surface here.`
          }
        />
      ) : (
        <ul className="space-y-3">
          {items.map((item) => (
            <li key={feedKey(item)}>
              <ActivityFeedItem
                accentClassName={
                  item.kind === 'technique'
                    ? techniqueAccent(item.status)
                    : rankChangeAccent
                }
                meta={
                  <time dateTime={item.latest_activity_at}>
                    {formatRelative(item.latest_activity_at)}
                  </time>
                }
              >
                {item.kind === 'technique' ? (
                  <TechniqueSlim item={item} studentId={studentId} />
                ) : (
                  <RankChangeSlim item={item} />
                )}
              </ActivityFeedItem>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function feedKey(item: FeedItem): string {
  switch (item.kind) {
    case 'technique':
      return `t:${item.student_technique_id || item.technique_id}`;
    case 'rank_change':
      return `r:${item.rank_audit_id}`;
  }
}
