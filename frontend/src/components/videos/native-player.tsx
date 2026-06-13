import { useEffect, useRef } from "react";
import type { Video } from "@/lib/api";
import type { PlayerEvents } from "./player-events";
import { useSignedPlaybackUrl } from "./useSignedPlaybackUrl";

interface NativePlayerProps {
  video: Video;
  events?: PlayerEvents;
}

export function NativePlayer({ video, events }: NativePlayerProps) {
  const { url, loading, error, refresh } = useSignedPlaybackUrl(video.id, true);
  const startedRef = useRef(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    startedRef.current = false;
  }, [video.id]);

  useEffect(() => {
    events?.registerSeek?.((seconds) => {
      const el = videoRef.current;
      if (el) el.currentTime = Math.max(0, seconds);
    });
  }, [events]);

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
    return (
      <div className="aspect-video w-full animate-pulse rounded-md bg-muted/40" />
    );
  }

  return (
    <video
      ref={videoRef}
      src={url}
      controls
      playsInline
      preload="metadata"
      className="aspect-video w-full rounded-md bg-black"
      onPlay={() => {
        if (!startedRef.current) {
          startedRef.current = true;
          events?.onPlay?.();
        }
        events?.onPaused?.(false);
      }}
      onPause={() => events?.onPaused?.(true)}
      onTimeUpdate={(event) => {
        const el = event.currentTarget;
        if (Number.isFinite(el.duration)) {
          events?.onProgress?.(el.currentTime, el.duration);
        }
      }}
      onEnded={() => events?.onEnded?.()}
    >
      Your browser does not support inline video playback.
    </video>
  );
}
