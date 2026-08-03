import { type ReactNode, useState } from "react";
import { ChevronDown, DownloadIcon } from "lucide-react";
import { toast } from "sonner";
import type { Video } from "@/lib/api";
import { getDownloadUrl } from "@/lib/api";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useSwipeDownDismiss } from "@/lib/use-swipe-down-dismiss";
import { useHistoryDismiss } from "@/lib/use-history-dismiss";
import { VideoReviewPanel } from "./review/video-review-panel";
import { useWatchTracker, type WatchContext } from "./useWatchTracker";
import type { VideoThreadSurface } from "@/lib/thread-visibility";

interface VideoPlayerDialogProps {
  video: Video | null;
  /** Resume the clip here rather than starting it from the top. */
  startAtSeconds?: number | null;
  onClose: () => void;
  surface: VideoThreadSurface;
  watchContext?: WatchContext;
  /** Lineage shown in the viewer header (e.g. the technique this video lives on). */
  context?: { label: string };
  /**
   * Extra action(s) rendered inside the composer row alongside the built-in
   * download button. Components here are rendered inside the
   * PlayerControllerProvider, so they may call usePlayerController().
   */
  composerAction?: ReactNode;
}

export function VideoPlayerDialog({
  video,
  startAtSeconds,
  onClose,
  surface,
  watchContext,
  context,
  composerAction,
}: VideoPlayerDialogProps) {
  // Full-screen, view-like overlay: the phone/browser Back closes it (the OS
  // slide reads as navigation here, unlike a centered dialog).
  useHistoryDismiss(!!video, onClose);

  return (
    <Dialog open={!!video} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        showCloseButton={false}
        aria-describedby={undefined}
        className="flex h-[100dvh] w-screen max-w-none translate-x-0 translate-y-0 top-0 left-0 flex-col gap-0 rounded-none border-0 p-0"
      >
        {video && (
          <ViewerShell
            video={video}
            startAtSeconds={startAtSeconds}
            surface={surface}
            watchContext={watchContext}
            context={context}
            onClose={onClose}
            composerAction={composerAction}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function ViewerShell({
  video,
  startAtSeconds,
  surface,
  watchContext,
  context,
  onClose,
  composerAction,
}: {
  video: Video;
  startAtSeconds?: number | null;
  surface: VideoThreadSurface;
  watchContext?: WatchContext;
  context?: { label: string };
  onClose: () => void;
  composerAction?: ReactNode;
}) {
  const events = useWatchTracker(video.id, watchContext);
  const isNative = video.kind === "native";
  const canDownload = isNative && video.processing_status === "ready";
  const [downloading, setDownloading] = useState(false);
  const swipe = useSwipeDownDismiss(onClose);

  async function handleDownload() {
    setDownloading(true);
    try {
      const signed = await getDownloadUrl(video.id);
      window.open(signed.url, "_blank", "noopener,noreferrer");
    } catch (err) {
      console.error(err);
      toast.error("Could not start download");
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div
      className="flex h-full flex-col bg-background"
      style={{
        transform: swipe.translateY ? `translateY(${swipe.translateY}px)` : undefined,
        transition: swipe.dragging ? "none" : "transform 200ms ease",
      }}
    >
      {/* Header doubles as the drag handle. touch-none so a vertical drag is a
          dismiss gesture, not a scroll. */}
      <div
        {...swipe.handlers}
        className="flex touch-none items-center gap-2 border-b border-border px-2 py-2"
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Collapse"
          className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <ChevronDown className="h-5 w-5" />
        </button>
        <div className="min-w-0 flex-1 text-center">
          {context?.label && (
            <div className="truncate text-[11px] text-muted-foreground">{context.label}</div>
          )}
          <DialogTitle className="truncate text-sm leading-snug">
            {video.title ?? "Video"}
          </DialogTitle>
        </div>
        {/* Spacer to keep the title visually centered opposite the collapse button. */}
        <span className="w-8" aria-hidden />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <VideoReviewPanel
          video={video}
          surface={surface}
          startAtSeconds={startAtSeconds}
          watchEvents={events}
          composerAction={
            canDownload || composerAction ? (
              <>
                {canDownload && (
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    onClick={handleDownload}
                    disabled={downloading}
                    aria-label="Download video"
                    title="Download video"
                  >
                    <DownloadIcon className="h-4 w-4" aria-hidden />
                  </Button>
                )}
                {composerAction}
              </>
            ) : undefined
          }
        />
      </div>
    </div>
  );
}
