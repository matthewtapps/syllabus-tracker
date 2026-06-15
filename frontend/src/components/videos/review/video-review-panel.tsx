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
import { resolvePinFocus } from "./review-logic";

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

  // Rotating the phone to landscape on a landscape clip drives the video into
  // fullscreen (with auto-rotate on it lands there; with auto-rotate off the
  // orientation lock in the player makes Android offer its native rotate prompt).
  const videoIsLandscape = !(video.width && video.height && video.height > video.width);
  const landscape = useMediaQuery("(orientation: landscape)");
  const { enterFullscreen, isFullscreen } = controller;
  const wasLandscape = useRef(landscape);
  useEffect(() => {
    const flippedToLandscape = landscape && !wasLandscape.current;
    wasLandscape.current = landscape;
    if (flippedToLandscape && videoIsLandscape && !isFullscreen) enterFullscreen();
  }, [landscape, videoIsLandscape, isFullscreen, enterFullscreen]);

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
      registerEnterFullscreen: (fn) => registration?.registerEnterFullscreen(fn),
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
  // auto-clear after 6 s; the feed stacked below the video is the durable view.
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

    if (t.video_ts_seconds != null) controller.seekTo(t.video_ts_seconds);

    if (actions.exitFullscreen) {
      // Fullscreen is exiting and the stacked feed is about to mount: defer the
      // scroll two frames so the row exists before scrollIntoView runs.
      if (pinScrollRafRef.current) cancelAnimationFrame(pinScrollRafRef.current);
      pinScrollRafRef.current = requestAnimationFrame(() => {
        pinScrollRafRef.current = requestAnimationFrame(() => scrollToThread(t.id));
      });
    } else {
      // Feed already laid out: scroll immediately, no lag.
      scrollToThread(t.id);
    }

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
