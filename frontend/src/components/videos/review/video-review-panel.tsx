import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import type { Video, ThreadView } from "@/lib/api";
import { useUser } from "@/lib/current-user-context";
import { useThreadsForAnchor } from "@/lib/queries";
import { useCreateThread } from "@/lib/mutations";
import { deriveThreadVisibility, type VideoThreadSurface } from "@/lib/thread-visibility";
import { useMediaQuery } from "@/lib/use-media-query";
import type { PlayerEvents } from "../player-events";
import { VideoPlayerPanel } from "../video-player-panel";
import {
  PlayerControllerProvider,
  usePlayerController,
  usePlayerRegistration,
} from "../player-context";
import { MomentComposer, type MomentDraft } from "./moment-composer";
import { MomentFeed } from "./moment-feed";
import { MomentOverlay } from "./moment-overlay";
import { MomentSideSheet } from "./moment-side-sheet";
import { ScrubberPins } from "./scrubber-pins";

interface VideoReviewPanelProps {
  video: Video;
  surface: VideoThreadSurface;
  /** Watch-tracking events from the dialog; merged with controller bridging. */
  watchEvents?: PlayerEvents;
}

export function VideoReviewPanel(props: VideoReviewPanelProps) {
  return (
    <PlayerControllerProvider>
      <ReviewInner {...props} />
    </PlayerControllerProvider>
  );
}

function ReviewInner({ video, surface, watchEvents }: VideoReviewPanelProps) {
  const user = useUser();
  const controller = usePlayerController();
  const registration = usePlayerRegistration();
  const isLandscape = useMediaQuery("(orientation: landscape) and (max-height: 500px)");

  // Bridge player events -> controller registration, merged with watch events.
  const events = useMemo<PlayerEvents>(
    () => ({
      onPlay: watchEvents?.onPlay,
      onEnded: watchEvents?.onEnded,
      onOpened: watchEvents?.onOpened,
      onProgress: (t, d) => {
        watchEvents?.onProgress?.(t, d);
        registration?.reportProgress(t, d);
      },
      onPaused: (p) => registration?.reportPaused(p),
      registerSeek: (fn) => registration?.registerSeek(fn),
    }),
    [watchEvents, registration],
  );

  const threadsQuery = useThreadsForAnchor("video", video.id);
  const threads: ThreadView[] = threadsQuery.data ?? [];
  const createThread = useCreateThread();

  const [pinnedThread, setPinnedThread] = useState<ThreadView | null>(null);
  const sheetOpen = isLandscape && pinnedThread != null;
  const [highlightThreadId, setHighlightThreadId] = useState<number | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const pinTimerRef = useRef<number | null>(null);
  const highlightTimerRef = useRef<number | null>(null);

  // Clear both timers on unmount to prevent setState-after-unmount warnings.
  useEffect(() => {
    return () => {
      if (pinTimerRef.current) window.clearTimeout(pinTimerRef.current);
      if (highlightTimerRef.current) window.clearTimeout(highlightTimerRef.current);
    };
  }, []);

  function scrollToThread(threadId: number) {
    // When the side sheet is open the feed is not rendered; skip the DOM scroll.
    if (sheetOpen) return;
    setHighlightThreadId(threadId);
    const el = listRef.current?.querySelector<HTMLElement>(`[data-thread-id="${threadId}"]`);
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
    if (highlightTimerRef.current) window.clearTimeout(highlightTimerRef.current);
    highlightTimerRef.current = window.setTimeout(() => setHighlightThreadId(null), 2200);
  }

  // Toggle pin on re-click; otherwise set it.
  // Portrait: auto-clear after 6 s (transient overlay). Landscape: stay open until user taps X.
  function focusPin(t: ThreadView) {
    if (pinnedThread?.id === t.id) {
      setPinnedThread(null);
      if (pinTimerRef.current) {
        window.clearTimeout(pinTimerRef.current);
        pinTimerRef.current = null;
      }
      return;
    }
    setPinnedThread(t);
    if (t.video_ts_seconds != null) controller.seekTo(t.video_ts_seconds);
    scrollToThread(t.id);
    if (pinTimerRef.current) window.clearTimeout(pinTimerRef.current);
    if (!isLandscape) {
      pinTimerRef.current = window.setTimeout(() => setPinnedThread(null), 6000);
    }
  }

  async function submit(draft: MomentDraft) {
    const vis = deriveThreadVisibility(surface, user);
    try {
      await createThread.mutateAsync({
        anchor_kind: draft.video_ts_seconds != null ? "video_timestamp" : "video",
        anchor_id: video.id,
        video_ts_seconds: draft.video_ts_seconds,
        visibility: vis.visibility,
        scope_student_id: vis.scope_student_id,
        body: draft.body,
      });
    } catch {
      toast.error("Failed to post comment. Please try again.");
    }
  }

  return (
    <div className="space-y-3">
      {/* Player region: flex row in landscape sheet mode, stacked otherwise. */}
      <div className={sheetOpen ? "flex gap-2" : "relative"}>
        <div className={sheetOpen ? "relative min-w-0 flex-1" : "relative"}>
          <VideoPlayerPanel video={video} events={events} />
          {controller.canReadTime && (
            <>
              <MomentOverlay
                threads={threads}
                currentTime={controller.currentTime}
                pinnedThread={pinnedThread}
                onOpen={focusPin}
              />
              <ScrubberPins
                threads={threads}
                duration={controller.duration}
                activeThreadId={pinnedThread?.id ?? null}
                onPinClick={focusPin}
                onClusterClick={(ts) => scrollToThread(ts[0].id)}
              />
            </>
          )}
        </div>

        {sheetOpen && pinnedThread && (
          <MomentSideSheet
            thread={pinnedThread}
            videoId={video.id}
            onClose={() => {
              setPinnedThread(null);
              if (pinTimerRef.current) window.clearTimeout(pinTimerRef.current);
            }}
          />
        )}
      </div>

      {!sheetOpen && (
        <>
          <MomentComposer
            currentTime={controller.currentTime}
            canStamp={controller.canReadTime}
            onCaptureStart={() => controller.canSeek && controller.seekTo(controller.currentTime)}
            onSubmit={submit}
            pending={createThread.isPending}
          />

          <div ref={listRef}>
            <MomentFeed
              videoId={video.id}
              threads={threads}
              onSeek={(s) => controller.seekTo(s)}
              highlightThreadId={highlightThreadId}
            />
          </div>
        </>
      )}
    </div>
  );
}
