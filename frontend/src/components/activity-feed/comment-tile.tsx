import { MessageSquare } from "lucide-react";
import { ThreadView } from "@/components/threads/thread-view";
import { useThreadsForAnchor } from "@/lib/queries";
import type { ActivityRow } from "@/lib/activity-line";
import type { AnchorKind } from "@/lib/api";
import { TileSkeleton } from "./technique-tile";

/**
 * The embedded thread for a comment activity (a thread, reply, or
 * video-timestamp comment; they are all `thread_comment_posted` with a
 * different anchor). Hydrates the thread list for the anchor and locates the
 * one the activity points at. An anchor chip names the video or technique the
 * conversation lives on. Returns null while the thread can't resolve, so the
 * entry falls back to a header-only line.
 *
 * For camp_technique anchors, pass `campId` so the query is scoped to the
 * correct (technique, camp) pair — without it the backend returns nothing.
 */
export function CommentTile({
  row,
  anchorKind,
  anchorId,
  threadId,
  campId,
  hideAnchorChip = false,
}: {
  row: ActivityRow;
  anchorKind: AnchorKind;
  anchorId: number;
  threadId: number;
  /** Required for camp_technique anchors — scopes the thread list to the
   *  specific (technique, camp) pair. Ignored for other anchor kinds. */
  campId?: number;
  /** Hide the "on {noun}" chip when the noun is already shown above (a comment
   *  rendered beneath its collapsed technique row). */
  hideAnchorChip?: boolean;
}) {
  const query = useThreadsForAnchor(anchorKind, anchorId, campId);
  if (query.isLoading) return <TileSkeleton />;
  const thread = (query.data ?? []).find((t) => t.id === threadId);
  if (!thread) return null;
  const anchorLabel = row.video_title ?? row.technique_name ?? null;
  // The feed coalesces a thread's comment events into one row; comment_count is
  // the opener plus replies, so show it once the conversation has more than one.
  const countLabel = row.comment_count > 1 ? `${row.comment_count} comments` : null;
  return (
    <div className="mx-3 mb-3 overflow-hidden rounded-md border border-border bg-card">
      {!hideAnchorChip && (anchorLabel || countLabel) && (
        <div className="flex items-center gap-1.5 border-b border-border px-4 py-2 text-xs text-muted-foreground">
          <MessageSquare className="h-3 w-3 shrink-0" aria-hidden />
          <span className="truncate">
            {anchorLabel ? `on ${anchorLabel}` : "Discussion"}
            {countLabel ? ` · ${countLabel}` : ""}
          </span>
        </div>
      )}
      <div className="px-4 py-3">
        <ThreadView thread={thread} anchorKind={anchorKind} anchorId={anchorId} />
      </div>
    </div>
  );
}
