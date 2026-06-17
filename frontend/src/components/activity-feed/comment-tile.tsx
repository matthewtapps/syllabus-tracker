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
 */
export function CommentTile({
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
  const anchorLabel = row.video_title ?? row.technique_name ?? null;
  return (
    <div className="mx-3 mb-3 overflow-hidden rounded-md border border-border bg-card">
      {anchorLabel && (
        <div className="flex items-center gap-1.5 border-b border-border px-4 py-2 text-xs text-muted-foreground">
          <MessageSquare className="h-3 w-3 shrink-0" aria-hidden />
          <span className="truncate">on {anchorLabel}</span>
        </div>
      )}
      <div className="px-4 py-3">
        <ThreadView thread={thread} anchorKind={anchorKind} anchorId={anchorId} />
      </div>
    </div>
  );
}
