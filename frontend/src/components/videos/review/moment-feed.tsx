import { ThreadView as ThreadViewComponent } from "@/components/threads/thread-view";
import { formatTimestamp } from "@/lib/dates";
import { cn } from "@/lib/utils";
import type { ThreadView } from "@/lib/api";

interface MomentFeedProps {
  videoId: number;
  threads: ThreadView[];
  onSeek: (seconds: number) => void;
  highlightThreadId: number | null;
}

export function MomentFeed({ videoId, threads, onSeek, highlightThreadId }: MomentFeedProps) {
  if (threads.length === 0) {
    return <p className="p-3 text-sm text-muted-foreground">No discussion yet.</p>;
  }
  return (
    <div className="divide-y divide-border">
      {threads.map((t) => {
        const anchorKind = t.video_ts_seconds != null ? "video_timestamp" : "video";
        return (
          <div
            key={t.id}
            data-thread-id={t.id}
            data-ts-seconds={t.video_ts_seconds ?? ""}
            className={cn(
              "p-3 transition-colors",
              highlightThreadId === t.id && "bg-primary/10 ring-1 ring-ring/50",
            )}
          >
            <div className="mb-1.5">
              {t.video_ts_seconds != null ? (
                <button
                  type="button"
                  onClick={() => onSeek(t.video_ts_seconds as number)}
                  className="inline-flex items-center gap-1 rounded-md border border-border bg-muted px-2 py-0.5 text-xs font-semibold tabular-nums text-primary hover:bg-muted/70"
                >
                  <span aria-hidden="true">&#9654;</span> {formatTimestamp(t.video_ts_seconds)}
                </button>
              ) : (
                <span className="text-[11px] text-muted-foreground">whole video</span>
              )}
            </div>
            <ThreadViewComponent thread={t} anchorKind={anchorKind} anchorId={videoId} />
          </div>
        );
      })}
    </div>
  );
}
