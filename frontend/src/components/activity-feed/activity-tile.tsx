import { resolveFeedItem } from "@/lib/feed-item";
import { TechniqueTile } from "./technique-tile";
import { ThreadTile } from "./thread-tile";
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
      return <TechniqueTile row={row} focusThread={subject.thread} />;
    case "thread":
      return (
        <ThreadTile
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
