import { activityTileKind } from "./tile-kind";
import { TechniqueTile } from "./technique-tile";
import { CommentTile } from "./comment-tile";
import type { ActivityRow } from "@/lib/activity-line";

/**
 * The embedded tile beneath a feed entry's header. A dumb dispatcher: the
 * taxonomy lives in `activityTileKind`. Returns null for entries with no
 * in-context noun (syllabus assign/graduate, gated camp/match surfaces), so the
 * entry renders header-only.
 */
export function ActivityTile({ row }: { row: ActivityRow }) {
  const kind = activityTileKind(row);
  if (kind == null) return null;
  if (kind.kind === "technique") return <TechniqueTile row={row} />;
  return (
    <CommentTile
      row={row}
      anchorKind={kind.anchorKind}
      anchorId={kind.anchorId}
      threadId={kind.threadId}
    />
  );
}
