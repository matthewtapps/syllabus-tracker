import { Award } from 'lucide-react';
import type { FeedItem } from '@/lib/api';

const BELT_LABEL: Record<string, string> = {
  white: 'White',
  blue: 'Blue',
  purple: 'Purple',
  brown: 'Brown',
  black: 'Black',
  coral: 'Coral',
};

interface RankChangeSlimProps {
  item: Extract<FeedItem, { kind: 'rank_change' }>;
}

export function RankChangeSlim({ item }: RankChangeSlimProps) {
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
    <div className="flex items-start gap-3">
      <Award className="mt-1 h-4 w-4 shrink-0 text-amber-500" aria-hidden />
      <div className="min-w-0 flex-1 space-y-0.5">
        <p className="truncate text-sm font-medium">{title}</p>
        <p className="truncate text-xs text-muted-foreground">{subtitle}</p>
      </div>
    </div>
  );
}

export const rankChangeAccent = 'border-l-amber-500';
