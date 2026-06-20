import { Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StudentAvatar } from "@/components/student-avatar";
import { formatRelativeShort } from "@/lib/dates";
import type { CommentView, VideoReplyView } from "@/lib/api";

function ReferenceChip({
  refId,
  tsSeconds,
  caption,
  videoReplies,
}: {
  refId: number;
  tsSeconds: number | null;
  caption: string | null;
  videoReplies: VideoReplyView[];
}) {
  const exists = videoReplies.some((r) => r.id === refId && r.video);
  if (!exists) {
    return (
      <span className="text-xs italic text-muted-foreground">
        replying to a removed clip
      </span>
    );
  }
  const label = caption ?? "clip";
  const ts =
    tsSeconds != null
      ? ` @${Math.floor(tsSeconds / 60)}:${String(tsSeconds % 60).padStart(2, "0")}`
      : "";
  return (
    <Button
      type="button"
      variant="secondary"
      size="sm"
      className="h-6 gap-1 text-xs"
      onClick={() => {
        document
          .getElementById(`reply-${refId}`)
          ?.scrollIntoView({ behavior: "smooth", block: "center" });
      }}
    >
      <Play className="h-3 w-3" />
      {label}
      {ts}
    </Button>
  );
}

export function CommentItem({
  comment,
  authorName,
  videoReplies,
}: {
  comment: CommentView;
  authorName: string;
  videoReplies: VideoReplyView[];
}) {
  return (
    <div className="flex items-start gap-2.5">
      <StudentAvatar id={comment.author_id} name={authorName} size="sm" />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="text-sm font-medium">{authorName}</span>
          <span className="text-xs text-muted-foreground">
            {formatRelativeShort(comment.created_at)}
          </span>
        </div>
        {comment.body === null ? (
          <p className="text-sm italic text-muted-foreground">comment removed</p>
        ) : (
          <>
            {comment.references_video_id != null && (
              <ReferenceChip
                refId={comment.references_video_id}
                tsSeconds={comment.ref_ts_seconds}
                caption={comment.referenced_caption}
                videoReplies={videoReplies}
              />
            )}
            <p className="whitespace-pre-wrap text-sm">{comment.body}</p>
          </>
        )}
      </div>
    </div>
  );
}
