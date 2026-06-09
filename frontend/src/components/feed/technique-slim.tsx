import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import type { FeedItem } from '@/lib/api';
import { cn } from '@/lib/utils';

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

interface TechniqueSlimProps {
  item: Extract<FeedItem, { kind: 'technique' }>;
  studentId: number;
}

/// Slim technique renderer for the activity feed. Shows the technique name,
/// its current status, and a short activity summary (attempt count / last
/// update). Click navigates to the full surface for the technique. This is
/// purpose-built for the feed; it does NOT render the library's full expanded
/// body (description, tags, videos, notes, pin section). M5d will eventually
/// consolidate this with the library row when slim mode becomes a prop on
/// the unified base.
export function TechniqueSlim({ item, studentId }: TechniqueSlimProps) {
  const status = item.status as 'red' | 'amber' | 'green';
  const target = `/student/${studentId}/syllabus?focus=${item.technique_id}`;
  return (
    <Link
      to={target}
      className="flex items-start gap-3 -m-2 rounded-md p-2 transition-colors hover:bg-muted/40"
    >
      <span
        className={cn('mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full', STATUS_DOT[status])}
        aria-hidden
      />
      <div className="min-w-0 flex-1 space-y-0.5">
        <p className="truncate text-sm font-medium">{item.title}</p>
        <p className="truncate text-xs text-muted-foreground">
          {STATUS_LABEL[status]}
          {item.attempt_count > 0 && (
            <>
              {' · '}
              {item.attempt_count} {item.attempt_count === 1 ? 'attempt' : 'attempts'}
            </>
          )}
        </p>
      </div>
      <ChevronRight
        className="mt-1 h-4 w-4 shrink-0 text-muted-foreground"
        aria-hidden
      />
    </Link>
  );
}

export function techniqueAccent(status: string): string {
  if (status === 'green') return 'border-l-status-green';
  if (status === 'amber') return 'border-l-status-amber';
  if (status === 'red') return 'border-l-status-red';
  return 'border-l-transparent';
}
