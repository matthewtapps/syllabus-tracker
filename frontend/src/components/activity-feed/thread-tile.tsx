import { MessageSquare } from "lucide-react";
import { useThreadsForAnchor } from "@/lib/queries";
import type { ActivityRow } from "@/lib/activity-line";
import type { AnchorKind } from "@/lib/api";
import { TeaserLine, TeaserRegion, ViewAllLine } from "./teaser-line";
import { TileShell, TileSkeleton } from "./tile-shell";

/**
 * The thread teaser tile: a preview of the conversation (root post, latest
 * reply, how much more there is) that links to the thread where it lives, with
 * `?thread=` so the surface scrolls to and highlights it.
 *
 * Hydrates the thread list for the anchor and locates the one the activity
 * points at. Returns null while the thread can't resolve, so the entry falls
 * back to a header-only line.
 */
export function ThreadTile({
  row,
  anchorKind,
  anchorId,
  threadId,
}: {
  row: ActivityRow;
  anchorKind: AnchorKind;
  anchorId: number;
  threadId: number;
}) {
  const query = useThreadsForAnchor(anchorKind, anchorId);
  if (query.isLoading) return <TileSkeleton />;
  const thread = (query.data ?? []).find((t) => t.id === threadId);
  if (!thread) return null;

  // This tile only ever handles the two anchors with no technique or video
  // noun (resolveFeedItem routes the rest to the technique and video tiles):
  // a camp's own discussion, and a student profile's.
  //
  // The profile scrolls to and highlights the thread. A camp's discussion is
  // its activity feed, which has no thread list to scroll, so `?thread=` rides
  // along inert there rather than being dropped: the camp page can honour it
  // later without the link changing.
  const href =
    anchorKind === "camp"
      ? `/camps/${anchorId}?thread=${threadId}`
      : `/student/${anchorId}?thread=${threadId}`;

  const anchorLabel = row.video_title ?? row.technique_name ?? row.camp_name ?? null;
  const replies = [...thread.comments].sort((a, b) =>
    a.created_at.localeCompare(b.created_at),
  );
  const latest = replies.length > 0 ? replies[replies.length - 1] : null;

  return (
    <TileShell>
      {anchorLabel && (
        <div className="flex items-center gap-1.5 border-b border-border px-4 py-2 text-xs text-muted-foreground">
          <MessageSquare className="h-3 w-3 shrink-0" aria-hidden />
          <span className="truncate">{`on ${anchorLabel}`}</span>
        </div>
      )}
      <TeaserRegion href={href}>
        <TeaserLine
          authorId={thread.author_id}
          authorName={thread.author_name}
          createdAt={thread.created_at}
          body={thread.body}
          tsSeconds={thread.video_ts_seconds}
          fallback="video post"
          clamp={3}
        />
        {latest && (
          <div className="border-l-2 border-border pl-3">
            <TeaserLine
              authorId={latest.author_id}
              authorName={latest.author_name}
              createdAt={latest.created_at}
              body={latest.body}
            />
          </div>
        )}
        {/* The count lives here rather than in the anchor chip: it is about how
            much more the conversation holds, not about the anchor. */}
        {replies.length > 1 && <ViewAllLine count={replies.length} noun="reply" />}
      </TeaserRegion>
    </TileShell>
  );
}
