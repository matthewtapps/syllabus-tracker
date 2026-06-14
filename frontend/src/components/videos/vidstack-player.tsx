import { useEffect, useRef, type ReactNode } from "react";
import {
  MediaPlayer,
  MediaProvider,
  Gesture,
  PlayButton,
  MuteButton,
  FullscreenButton,
  TimeSlider,
  useMediaState,
  type MediaPlayerInstance,
} from "@vidstack/react";
import { Play, Pause, Volume2, VolumeX, Maximize, Minimize } from "lucide-react";
import "@vidstack/react/player/styles/base.css";
import type { Video } from "@/lib/api";
import { formatTimestamp } from "@/lib/dates";
import type { PlayerEvents } from "./player-events";
import { useSignedPlaybackUrl } from "./useSignedPlaybackUrl";
import { applySnapshot } from "./vidstack-bridge";

interface VidstackPlayerProps {
  video: Video;
  events?: PlayerEvents;
  /** Rendered over the video, above the control bar (e.g. the comment overlay). */
  overlay?: ReactNode;
  /** Rendered inside the time slider, positioned in the slider's track space. */
  sliderMarkers?: ReactNode;
}

export function VidstackPlayer({ video, events, overlay, sliderMarkers }: VidstackPlayerProps) {
  const { url, loading, error, refresh } = useSignedPlaybackUrl(video.id, true);
  const playerRef = useRef<MediaPlayerInstance>(null);

  // The one-shot onPlay flag resets per video, not per signed-URL refresh, so a
  // token refresh mid-playback does not double-count a watch (matches the old player).
  const startedRef = useRef(false);
  useEffect(() => {
    startedRef.current = false;
  }, [video.id]);

  // Bridge Vidstack player state to PlayerEvents.
  useEffect(() => {
    const player = playerRef.current;
    if (!player || !url) return;
    events?.registerSeek?.((seconds) => {
      player.currentTime = Math.max(0, seconds);
    });
    const unsubscribe = player.subscribe((state) => {
      startedRef.current = applySnapshot(
        { currentTime: state.currentTime, duration: state.duration, paused: state.paused },
        events,
        startedRef.current,
      );
    });
    return unsubscribe;
  }, [events, url]);

  if (error) {
    return (
      <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
        {error}{" "}
        <button
          type="button"
          className="ml-1 underline-offset-2 hover:underline"
          onClick={() => refresh()}
        >
          Try again
        </button>
      </div>
    );
  }

  if (loading || !url) {
    return <div className="aspect-video w-full animate-pulse rounded-md bg-muted/40" />;
  }

  return (
    <MediaPlayer
      ref={playerRef}
      src={{ src: url, type: "video/mp4" }}
      playsInline
      onEnded={() => events?.onEnded?.()}
      className="relative aspect-video w-full overflow-hidden rounded-md bg-black"
    >
      <MediaProvider />

      {/* Tap anywhere on the frame to play/pause. Sits below the controls and
          the comment chip in the DOM, so taps on those still hit them. */}
      <Gesture className="absolute inset-0 block" event="pointerup" action="toggle:paused" />

      {/* Discoverability affordance: a play badge while paused. */}
      <CenterPlayBadge />

      {/* Overlay layer: the comment scrim spans the full frame so it blends into
          the control-bar gradient; only the chip inside it is interactive. */}
      {overlay && <div className="pointer-events-none absolute inset-0">{overlay}</div>}

      {/* Always-visible custom control bar. */}
      <div className="absolute inset-x-0 bottom-0 flex h-12 items-center gap-3 bg-gradient-to-t from-black/80 to-transparent px-3">
        <PlayButton className="text-white">
          <PlayPauseIcon />
        </PlayButton>
        <MuteButton className="text-white">
          <MuteIcon />
        </MuteButton>

        <TimeSlider.Root className="group relative inline-flex h-5 flex-1 cursor-pointer items-center">
          <TimeSlider.Track className="absolute top-1/2 h-1 w-full -translate-y-1/2 rounded-full bg-white/25">
            <TimeSlider.Progress className="absolute h-full w-[var(--slider-progress)] rounded-full bg-white/40" />
            <TimeSlider.TrackFill className="absolute h-full w-[var(--slider-fill)] rounded-full bg-primary" />
          </TimeSlider.Track>
          <TimeSlider.Thumb className="absolute top-1/2 left-[var(--slider-fill)] size-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow ring-1 ring-black/20" />
          {/* Comment pins: positioned in the slider's 0..1 track space. */}
          {sliderMarkers && (
            <div className="pointer-events-none absolute inset-0">{sliderMarkers}</div>
          )}
        </TimeSlider.Root>

        <TimeReadout />

        <FullscreenButton className="text-white">
          <FullscreenIcon />
        </FullscreenButton>
      </div>
    </MediaPlayer>
  );
}

function PlayPauseIcon() {
  const paused = useMediaState("paused");
  return paused ? <Play className="h-5 w-5" /> : <Pause className="h-5 w-5" />;
}

function CenterPlayBadge() {
  const paused = useMediaState("paused");
  if (!paused) return null;
  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
      <span className="rounded-full bg-black/45 p-3 text-white">
        <Play className="h-7 w-7" fill="currentColor" />
      </span>
    </div>
  );
}

function MuteIcon() {
  const muted = useMediaState("muted");
  const volume = useMediaState("volume");
  return muted || volume === 0 ? <VolumeX className="h-5 w-5" /> : <Volume2 className="h-5 w-5" />;
}

function FullscreenIcon() {
  const fullscreen = useMediaState("fullscreen");
  return fullscreen ? <Minimize className="h-5 w-5" /> : <Maximize className="h-5 w-5" />;
}

function TimeReadout() {
  const currentTime = useMediaState("currentTime");
  const duration = useMediaState("duration");
  return (
    <span className="whitespace-nowrap text-xs tabular-nums text-white">
      {Number.isFinite(currentTime) ? formatTimestamp(currentTime) : "0:00"} / {Number.isFinite(duration) ? formatTimestamp(duration) : "0:00"}
    </span>
  );
}
