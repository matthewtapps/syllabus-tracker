import { Link } from 'react-router-dom';
import { Award, ChevronRight, ListTodo, Sparkles } from 'lucide-react';
import type { FeedItem } from '@/lib/api';
import { useStudentFeed } from '@/lib/queries';
import { EmptyState } from '@/components/empty-state';
import { SkeletonListRow } from '@/components/skeleton-row';
import { formatRelative } from '@/lib/dates';
import { cn } from '@/lib/utils';

interface ActivityFeedProps {
  studentId: number;
  isOwnView: boolean;
  studentName: string;
}

const STATUS_LABEL: Record<'red' | 'amber' | 'green', string> = {
  red: 'Needs work',
  amber: 'In progress',
  green: 'Solid',
};

const STATUS_DOT: Record<'red' | 'amber' | 'green', string> = {
  red: 'bg-status-red',
  amber: 'bg-status-amber',
  green: 'bg-status-green',
};

const BELT_LABEL: Record<string, string> = {
  white: 'White',
  blue: 'Blue',
  purple: 'Purple',
  brown: 'Brown',
  black: 'Black',
  coral: 'Coral',
};

export function ActivityFeed({ studentId, isOwnView, studentName }: ActivityFeedProps) {
  const feedQuery = useStudentFeed(studentId);
  const items = feedQuery.data?.items ?? null;

  if (feedQuery.isLoading) {
    return (
      <div className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
        {Array.from({ length: 4 }).map((_, i) => (
          <SkeletonListRow key={i} />
        ))}
      </div>
    );
  }

  if (feedQuery.error) {
    return (
      <EmptyState
        icon={Sparkles}
        title="Couldn't load the activity feed"
        description="Try refreshing in a moment."
      />
    );
  }

  if (!items || items.length === 0) {
    return (
      <EmptyState
        icon={Sparkles}
        title="No activity yet"
        description={
          isOwnView
            ? 'Activity from your techniques, attempts, and grading will show up here.'
            : `${studentName} hasn't had any activity yet. Their techniques and grading events will surface here.`
        }
      />
    );
  }

  return (
    <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
      {items.map((item) => (
        <FeedRow key={feedKey(item)} item={item} studentId={studentId} />
      ))}
    </ul>
  );
}

function feedKey(item: FeedItem): string {
  switch (item.kind) {
    case 'technique':
      return `t:${item.student_technique_id}`;
    case 'rank_change':
      return `r:${item.rank_audit_id}`;
  }
}

interface FeedRowProps {
  item: FeedItem;
  studentId: number;
}

function FeedRow({ item, studentId }: FeedRowProps) {
  if (item.kind === 'technique') {
    return (
      <li>
        <Link
          to={`/student/${studentId}?profile_tab=syllabus&focus=${item.technique_id}`}
          className="flex items-start gap-3 px-4 py-3 transition-colors hover:bg-muted/40"
        >
          <span
            className={cn('mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full', STATUS_DOT[item.status])}
            aria-hidden
          />
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-2">
              <p className="truncate text-sm font-medium">{item.title}</p>
              <time
                className="shrink-0 text-xs text-muted-foreground"
                dateTime={item.latest_activity_at}
              >
                {formatRelative(item.latest_activity_at)}
              </time>
            </div>
            <p className="mt-0.5 truncate text-xs text-muted-foreground">
              {STATUS_LABEL[item.status]}
              {item.attempt_count > 0 && (
                <>
                  {' · '}
                  {item.attempt_count} {item.attempt_count === 1 ? 'attempt' : 'attempts'}
                </>
              )}
            </p>
          </div>
          <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        </Link>
      </li>
    );
  }

  const belt = item.belt ? (BELT_LABEL[item.belt] ?? item.belt) : null;
  const title =
    belt && typeof item.stripes === 'number'
      ? item.stripes > 0
        ? `${belt} belt, ${item.stripes} ${item.stripes === 1 ? 'stripe' : 'stripes'}`
        : `${belt} belt`
      : belt
        ? `${belt} belt`
        : 'Rank cleared';
  const subtitle = item.changed_by_name
    ? `Awarded by ${item.changed_by_name}`
    : 'Rank updated';
  return (
    <li className="flex items-start gap-3 px-4 py-3">
      <Award className="mt-1 h-4 w-4 shrink-0 text-amber-500" aria-hidden />
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <p className="truncate text-sm font-medium">{title}</p>
          <time
            className="shrink-0 text-xs text-muted-foreground"
            dateTime={item.latest_activity_at}
          >
            {formatRelative(item.latest_activity_at)}
          </time>
        </div>
        <p className="mt-0.5 truncate text-xs text-muted-foreground">{subtitle}</p>
      </div>
    </li>
  );
}

// Re-export icons used elsewhere to avoid duplicate imports.
export const ActivityIcons = { ListTodo };
