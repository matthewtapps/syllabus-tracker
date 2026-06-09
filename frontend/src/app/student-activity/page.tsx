import { useMemo } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Sparkles } from 'lucide-react';
import {
  isCoachOrAdmin,
  type FeedItem,
  type User,
} from '@/lib/api';
import { useStudentFeed, useStudentTechniques } from '@/lib/queries';
import { Badge } from '@/components/ui/badge';
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

type FeedItemKind = FeedItem['kind'];

const KIND_LABELS: Record<FeedItemKind, string> = {
  technique: 'Techniques',
  rank_change: 'Rank changes',
};

const KIND_ORDER: FeedItemKind[] = ['technique', 'rank_change'];

interface ActivityPageProps {
  user: User;
}

export default function ActivityPage({ user }: ActivityPageProps) {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const studentId = id ? parseInt(id, 10) : user.id;
  const isOwnView = studentId === user.id;
  const canViewOthers = isCoachOrAdmin(user);

  const feedQuery = useStudentFeed(studentId);
  // For the title chrome; the optimization to a dedicated profile-only
  // endpoint lives in a follow-up. Mirrors how /pins fetches the student
  // record today.
  const studentTechniquesQuery = useStudentTechniques(studentId);

  // Multi-select kind filter. URL state via ?kinds=technique,rank_change.
  // Empty array = no filter (show all). Pulled forward from M18 to land
  // alongside the activity feed extraction.
  const activeKinds = useMemo<Set<FeedItemKind>>(() => {
    const raw = searchParams.get('kinds');
    if (!raw) return new Set();
    const out = new Set<FeedItemKind>();
    for (const part of raw.split(',')) {
      const v = part.trim();
      if (v === 'technique' || v === 'rank_change') out.add(v);
    }
    return out;
  }, [searchParams]);

  function toggleKind(kind: FeedItemKind) {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        const current = new Set(activeKinds);
        if (current.has(kind)) current.delete(kind);
        else current.add(kind);
        if (current.size === 0) next.delete('kinds');
        else next.set('kinds', Array.from(current).join(','));
        return next;
      },
      { replace: true },
    );
  }

  function clearKinds() {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete('kinds');
        return next;
      },
      { replace: true },
    );
  }

  const allItems = feedQuery.data?.items ?? null;
  const items = useMemo(() => {
    if (allItems === null) return null;
    if (activeKinds.size === 0) return allItems;
    return allItems.filter((item) => activeKinds.has(item.kind));
  }, [allItems, activeKinds]);

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

      {!feedQuery.isLoading && !feedQuery.error && allItems && allItems.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-1.5">
          {KIND_ORDER.map((kind) => {
            const active = activeKinds.has(kind);
            return (
              <Badge
                key={kind}
                variant={active ? 'default' : 'outline'}
                className="cursor-pointer select-none"
                onClick={() => toggleKind(kind)}
              >
                {KIND_LABELS[kind]}
              </Badge>
            );
          })}
          {activeKinds.size > 0 && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-xs"
              onClick={clearKinds}
            >
              Clear
            </Button>
          )}
        </div>
      )}

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
        activeKinds.size > 0 ? (
          <EmptyState
            icon={Sparkles}
            title="No items match the current filters"
            description="Clear the filters above to see everything."
            action={
              <Button type="button" variant="outline" onClick={clearKinds}>
                Clear filters
              </Button>
            }
          />
        ) : (
          <EmptyState
            icon={Sparkles}
            title="No activity yet"
            description={
              isOwnView
                ? 'Activity from your techniques, attempts, and grading will show up here.'
                : `${studentName} hasn't had any activity yet. Their techniques and grading events will surface here.`
            }
          />
        )
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
