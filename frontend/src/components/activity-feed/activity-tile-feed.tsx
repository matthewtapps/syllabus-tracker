import { ActivityTileHeader } from "./activity-tile-header";
import { ActivityTile } from "./activity-tile";
import { activitySurface } from "@/lib/view-context";
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

  // Camps + competitions/matches are gated off on prod; drop their rows so the
  // feed never links into half-built surfaces (mirrors ActivityFeedList).
  const visible = campsUiEnabled
    ? deNoised
    : deNoised.filter((row) => {
        const kind = activitySurface(row)?.kind;
        return kind !== "camp" && kind !== "competition" && kind !== "match";
      });

  if (visible.length === 0) {
    return (
      <p className="rounded-lg border border-border bg-card px-6 py-12 text-center text-sm text-muted-foreground">
        {emptyText}
      </p>
    );
  }

  return (
    <ul className="space-y-4">
      {visible.map((row) => (
        <li
          key={`${row.id}-${row.occurred_at}`}
          className="overflow-hidden rounded-lg border border-border bg-card"
        >
          <ActivityTileHeader row={row} scope={scope} showAvatar={showAvatar} />
          <ActivityTile row={row} />
        </li>
      ))}
    </ul>
  );
}
