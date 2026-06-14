import { X } from "lucide-react";
import { ThreadView as ThreadViewComponent } from "@/components/threads/thread-view";
import { formatTimestamp } from "@/lib/dates";
import type { ThreadView } from "@/lib/api";

interface MomentSideSheetProps {
  thread: ThreadView;
  videoId: number;
  onClose: () => void;
}

export function MomentSideSheet({ thread, videoId, onClose }: MomentSideSheetProps) {
  const anchorKind = thread.video_ts_seconds != null ? "video_timestamp" : "video";
  return (
    <aside className="flex w-[300px] flex-none flex-col border-l border-border bg-background">
      <div className="flex items-center justify-between border-b border-border p-3">
        <span className="text-xs font-semibold">
          {thread.video_ts_seconds != null
            ? `Comment at ${formatTimestamp(thread.video_ts_seconds)}`
            : "Whole video"}
        </span>
        <button type="button" aria-label="Close thread" onClick={onClose}>
          <X className="h-4 w-4 text-muted-foreground" />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-3">
        <ThreadViewComponent thread={thread} anchorKind={anchorKind} anchorId={videoId} />
      </div>
    </aside>
  );
}
