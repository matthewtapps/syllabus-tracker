import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';

/// Wrapper card for an activity-feed item. Each card composes one or more
/// child renderers (slim technique, slim rank change, slim video, slim
/// thread). Today's feed has one child per card; M13 / M14 / M16 add
/// composite cards (e.g. technique + video + thread for "student commented
/// on this video on this technique"). The wrapper carries shared chrome:
/// padding, border, hover affordance, action area at the top.
export interface ActivityFeedItemProps {
  children: React.ReactNode;
  /** Optional top-right meta (timestamp / kind chip). */
  meta?: React.ReactNode;
  /** Soft accent stripe on the left edge. Color comes from the child kind. */
  accentClassName?: string;
}

export function ActivityFeedItem({
  children,
  meta,
  accentClassName,
}: ActivityFeedItemProps) {
  return (
    <Card
      className={cn(
        'overflow-hidden border-l-4 transition-colors hover:bg-muted/20',
        accentClassName ?? 'border-l-transparent',
      )}
    >
      {meta && (
        <div className="flex items-center justify-end gap-2 border-b border-border/40 px-4 py-1.5 text-xs text-muted-foreground">
          {meta}
        </div>
      )}
      <CardContent className="space-y-4 p-4">{children}</CardContent>
    </Card>
  );
}
