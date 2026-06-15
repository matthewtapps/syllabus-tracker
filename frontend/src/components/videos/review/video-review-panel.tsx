import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
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
import { ScrubberPins } from "./scrubber-pins";
import { effectiveTheater, resolvePinFocus } from "./review-logic";

interface VideoReviewPanelProps {
  video: Video;
  surface: VideoThreadSurface;
  /** Watch-tracking events from the dialog; merged with controller bridging. */
  watchEvents?: PlayerEvents;
  /** Trailing action shown inline in the composer row (e.g. download). */
  composerAction?: ReactNode;
}

export function VideoReviewPanel(props: VideoReviewPanelProps) {
  return (
    <PlayerControllerProvider>
      <ReviewInner {...props} />
    </PlayerControllerProvider>
  );
}

function ReviewInner({ video, surface, watchEvents, composerAction }: VideoReviewPanelProps) {
  const user = useUser();
  const controller = usePlayerController();
  const registration = usePlayerRegistration();

  // Theater = comments beside the video. Only offered for a landscape video on a
  // viewport wide enough for two columns (a rotated phone clears 768px too).
  const videoIsLandscape = !(video.width && video.height && video.height > video.width);
  const wideEnough = useMediaQuery("(min-width: 768px)");
  const canTheater = videoIsLandscape && wideEnough;
  const [theaterPref, setTheaterPref] = useState<boolean | null>(null);
  const theater = effectiveTheater(canTheater, theaterPref);

  // Re-apply auto whenever the device orientation flips, so rotating to
  // landscape lands in theater (room permitting) without a manual tap.
  const landscape = useMediaQuery("(orientation: landscape)");
  useEffect(() => {
    setTheaterPref(null);
  }, [landscape]);

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
      registerExitFullscreen: (fn) => registration?.registerExitFullscreen(fn),
      onFullscreenChange: (f) => registration?.reportFullscreen(f),
    }),
    [watchEvents, registration],
  );

  const threadsQuery = useThreadsForAnchor("video", video.id);
  const threads: ThreadView[] = threadsQuery.data ?? [];
  const createThread = useCreateThread();

  const [pinnedThread, setPinnedThread] = useState<ThreadView | null>(null);
  const [highlightThreadId, setHighlightThreadId] = useState<number | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const pinTimerRef = useRef<number | null>(null);
  const highlightTimerRef = useRef<number | null>(null);
  const pinScrollRafRef = useRef<number | null>(null);

  // Clear both timers on unmount to prevent setState-after-unmount warnings.
  useEffect(() => {
    return () => {
      if (pinTimerRef.current) window.clearTimeout(pinTimerRef.current);
      if (highlightTimerRef.current) window.clearTimeout(highlightTimerRef.current);
      if (pinScrollRafRef.current) cancelAnimationFrame(pinScrollRafRef.current);
    };
  }, []);

  function scrollToThread(threadId: number) {
    setHighlightThreadId(threadId);
    const el = listRef.current?.querySelector<HTMLElement>(`[data-thread-id="${threadId}"]`);
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
    if (highlightTimerRef.current) window.clearTimeout(highlightTimerRef.current);
    highlightTimerRef.current = window.setTimeout(() => setHighlightThreadId(null), 2200);
  }

  // Toggle pin on re-click; otherwise set it. The overlay chip is transient:
  // auto-clear after 6 s; the feed (below or beside in theater) is the durable view.
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

    const actions = resolvePinFocus(controller.isFullscreen);
    if (actions.exitFullscreen) controller.exitFullscreen();
    if (actions.forceTheater) setTheaterPref(true);

    if (t.video_ts_seconds != null) controller.seekTo(t.video_ts_seconds);

    // Defer the scroll two frames so the row exists after the fullscreen exit
    // and the theater re-render have committed before scrollIntoView runs.
    if (pinScrollRafRef.current) cancelAnimationFrame(pinScrollRafRef.current);
    pinScrollRafRef.current = requestAnimationFrame(() => {
      pinScrollRafRef.current = requestAnimationFrame(() => scrollToThread(t.id));
    });

    if (pinTimerRef.current) window.clearTimeout(pinTimerRef.current);
    pinTimerRef.current = window.setTimeout(() => setPinnedThread(null), 6000);
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
    } catch (e) {
      toast.error("Failed to post comment. Please try again.");
      throw e;
    }
  }

  const player = (
    <VideoPlayerPanel
      video={video}
      events={events}
      canTheater={canTheater}
      theater={theater}
      onToggleTheater={() => setTheaterPref(!theater)}
      overlay={
        controller.canReadTime ? (
          <MomentOverlay
            threads={threads}
            currentTime={controller.currentTime}
            pinnedThread={pinnedThread}
            onOpen={focusPin}
          />
        ) : undefined
      }
      sliderMarkers={
        controller.canReadTime ? (
          <ScrubberPins
            threads={threads}
            duration={controller.duration}
            activeThreadId={pinnedThread?.id ?? null}
            onPinClick={focusPin}
            onClusterClick={(ts) => focusPin(ts[0])}
          />
        ) : undefined
      }
    />
  );

  const composer = (
    <MomentComposer
      currentTime={controller.currentTime}
      duration={controller.duration}
      canStamp={controller.canReadTime}
      onCaptureStart={() => controller.canSeek && controller.seekTo(controller.currentTime)}
      onSubmit={submit}
      pending={createThread.isPending}
      actionSlot={composerAction}
    />
  );

  const feed = (
    <div ref={listRef}>
      <MomentFeed
        videoId={video.id}
        threads={threads}
        onSeek={(s) => controller.seekTo(s)}
        highlightThreadId={highlightThreadId}
      />
    </div>
  );

  if (theater) {
    return (
      <div className="flex items-start gap-3">
        <div className="relative min-w-0 flex-1">{player}</div>
        <div className="flex max-h-[80svh] w-80 flex-none flex-col overflow-y-auto rounded-md border border-border">
          {composer}
          {feed}
        </div>
      </div>
    );
  }

  return (
    <div>
      {/* Player is full-bleed to the viewer edges; the comments stay inset. */}
      <div className="relative">{player}</div>
      <div className="space-y-3 px-3 pb-4 sm:px-4">
        {composer}
        {feed}
      </div>
    </div>
  );
}
