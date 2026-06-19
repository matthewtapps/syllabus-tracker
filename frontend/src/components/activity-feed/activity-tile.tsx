import { useState } from "react";
import { resolveFeedItem, type FocusThread } from "@/lib/feed-item";
import { TechniqueTile } from "./technique-tile";
import { CommentTile } from "./comment-tile";
import { VideoTile } from "./video-tile";
import type { ActivityRow } from "@/lib/activity-line";

/**
 * The embedded tile beneath a feed entry's header. A dumb dispatcher: the
 * taxonomy lives in `resolveFeedItem`, and rendering is polymorphic on the
 * resolved subject kind (ActivityStreams object), never on the verb. Returns
 * null for header-only entries (assignment/graduation, gated camp).
 */
export function ActivityTile({ row }: { row: ActivityRow }) {
  const { subject } = resolveFeedItem(row);
  switch (subject.kind) {
    case "video":
      return <VideoTile subject={subject} />;
    case "technique":
      return <TechniqueSubjectTile row={row} thread={subject.thread} />;
    case "thread":
      return (
        <CommentTile
          row={row}
          anchorKind={subject.anchorKind}
          anchorId={subject.anchorId}
          threadId={subject.threadId}
        />
      );
    case "none":
      return null;
  }
}

/**
 * A technique comment: the collapsed technique row plus just the relevant thread
 * below it. Once the row is expanded its own discussion shows the thread, so the
 * sibling focus thread hides to avoid rendering it twice.
 */
function TechniqueSubjectTile({ row, thread }: { row: ActivityRow; thread: FocusThread | null }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <>
      <TechniqueTile row={row} onExpandedChange={setExpanded} />
      {thread && !expanded && (
        <CommentTile
          row={row}
          anchorKind={thread.anchorKind}
          anchorId={thread.anchorId}
          threadId={thread.threadId}
          hideAnchorChip
        />
      )}
    </>
  );
}
