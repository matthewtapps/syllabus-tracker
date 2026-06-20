import { StudentAvatar } from "@/components/student-avatar";
import { formatRelativeShort } from "@/lib/dates";
import { VideoPlayerPanel } from "@/components/videos/video-player-panel";
import type { VideoReplyView } from "@/lib/api";

export function VideoReplyItem({ reply }: { reply: VideoReplyView }) {
  if (!reply.video) {
    return (
      <p id={`reply-${reply.id}`} className="text-sm italic text-muted-foreground">
        clip removed
      </p>
    );
  }
  return (
    <div id={`reply-${reply.id}`} className="space-y-2">
      <div className="flex items-center gap-2.5">
        <StudentAvatar id={reply.author_id} name={reply.author_name} size="sm" />
        <span className="text-sm font-medium">{reply.author_name}</span>
        <span className="text-xs text-muted-foreground">
          {formatRelativeShort(reply.created_at)}
        </span>
      </div>
      <VideoPlayerPanel video={reply.video} />
    </div>
  );
}
