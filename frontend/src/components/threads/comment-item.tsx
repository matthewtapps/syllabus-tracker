import { StudentAvatar } from "@/components/student-avatar";
import { formatRelativeShort, formatTimestamp } from "@/lib/dates";
import { VideoPlayerPanel } from "@/components/videos/video-player-panel";
import type { CommentView } from "@/lib/api";

export function CommentItem({
  comment,
  authorName,
  onSeek,
}: {
  comment: CommentView;
  authorName: string;
  /** When provided and the comment has a video_ts_seconds, render a seek chip. */
  onSeek?: (seconds: number) => void;
}) {
  const ts = comment.video_ts_seconds;

  return (
    <div className="flex items-start gap-2.5">
      <StudentAvatar id={comment.author_id} name={authorName} size="sm" />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="text-sm font-medium">{authorName}</span>
          <span className="text-xs text-muted-foreground">
            {formatRelativeShort(comment.created_at)}
          </span>
          {ts != null && (
            onSeek ? (
              <button
                type="button"
                onClick={() => onSeek(ts)}
                className="rounded bg-primary/10 px-1 py-0.5 text-[11px] font-medium tabular-nums text-primary hover:bg-primary/20"
                aria-label={`Seek to ${formatTimestamp(ts)}`}
              >
                @{formatTimestamp(ts)}
              </button>
            ) : (
              <span className="rounded bg-muted px-1 py-0.5 text-[11px] tabular-nums text-muted-foreground">
                @{formatTimestamp(ts)}
              </span>
            )
          )}
        </div>
        {comment.body === null ? (
          comment.video ? null : (
            <p className="text-sm italic text-muted-foreground">comment removed</p>
          )
        ) : (
          <p className="whitespace-pre-wrap text-sm">{comment.body}</p>
        )}
        {comment.video && (
          <div className="mt-2">
            <VideoPlayerPanel video={comment.video} />
          </div>
        )}
      </div>
    </div>
  );
}
