import { Fragment } from "react";
import { ActivityTileHeader } from "./activity-tile-header";
import { ActivityTile } from "./activity-tile";
import { isGatedEpicRow } from "@/lib/view-context";
import { suppressHideUnhide } from "@/lib/activity-hide-unhide";
import { campsUiEnabled } from "@/lib/features";
import type { ActivityRow, ActivityScope } from "@/lib/activity-line";

/**
 * Social-media-style feed: each row renders a "who did what" header over an
 * embedded tile of the noun it acted on (a technique row in its surface
 * context, or a thread). Rows are already reverse-chronological from the API.
 *
 * Separate from `ActivityFeedList` (the compact one-line feed), which is still
 * used by the dashboard glance and the profile/timeline surfaces.
 */
export function ActivityTileFeed({
  rows,
  isLoading,
  scope,
  showAvatar = true,
  emptyText = "No activity yet.",
}: {
  rows: ActivityRow[];
  isLoading: boolean;
  scope: ActivityScope;
  showAvatar?: boolean;
  emptyText?: string;
}) {
  if (isLoading) {
    return (
      <div className="space-y-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="overflow-hidden rounded-lg border border-border bg-card">
            <div className="px-4 py-3">
              <div className="h-3 w-1/3 animate-pulse rounded bg-muted" />
              <div className="mt-2 h-3 w-1/2 animate-pulse rounded bg-muted" />
            </div>
            <div className="mx-3 mb-3 h-16 animate-pulse rounded-md bg-muted/50" />
          </div>
        ))}
      </div>
    );
  }

  // Drop hide/unhide curation noise (net-visibility rule) before gating.
  const deNoised = suppressHideUnhide(rows);

  // Camps + competitions/matches/suggestions are gated off on prod; drop their
  // rows so the feed never links into half-built surfaces (mirrors
  // ActivityFeedList).
  const visible = campsUiEnabled ? deNoised : deNoised.filter((row) => !isGatedEpicRow(row));

  if (visible.length === 0) {
    return (
      <p className="rounded-lg border border-border bg-card px-6 py-12 text-center text-sm text-muted-foreground">
        {emptyText}
      </p>
    );
  }

  // Mark where the viewer's unread (new-since-last-visit) rows end. `unread`
  // comes from the activity cursor (computed server-side in feed()). The divider
  // sits after the last unread row; when nothing is unread (caught up) it sits
  // at the very top so the "Up to date" line is always present once seen.
  const lastUnreadIdx = visible.reduce((acc, row, i) => (row.unread ? i : acc), -1);
  const caughtUp = lastUnreadIdx === -1;

  const divider = (
    <li className="flex items-center gap-3 px-1 text-xs font-medium text-primary">
      <span className="h-px flex-1 bg-primary/40" />
      Up to date
      <span className="h-px flex-1 bg-primary/40" />
    </li>
  );

  return (
    <ul className="space-y-4">
      {caughtUp && <Fragment key="caught-up">{divider}</Fragment>}
      {visible.map((row, i) => (
        <Fragment key={`${row.id}-${row.occurred_at}`}>
          <li className="overflow-hidden rounded-lg border border-border bg-card">
            <ActivityTileHeader row={row} scope={scope} showAvatar={showAvatar} />
            <ActivityTile row={row} />
          </li>
          {i === lastUnreadIdx && i < visible.length - 1 && divider}
        </Fragment>
      ))}
    </ul>
  );
}
