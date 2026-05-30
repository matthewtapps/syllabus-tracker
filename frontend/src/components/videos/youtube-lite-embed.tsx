import { useState } from "react";
import { PlayIcon } from "lucide-react";
import type { Video } from "@/lib/api";
import type { PlayerEvents } from "./player-events";

interface YouTubeLiteEmbedProps {
  video: Video;
  events?: PlayerEvents;
}

export function YouTubeLiteEmbed({ video, events }: YouTubeLiteEmbedProps) {
  const [playing, setPlaying] = useState(false);
  const videoId = video.external_video_id;

  if (!videoId) {
    return (
      <UnknownYouTubeFallback url={video.external_url ?? null} events={events} />
    );
  }

  const thumb = `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
  const embedUrl = `https://www.youtube.com/embed/${videoId}?autoplay=1&rel=0&modestbranding=1`;

  if (!playing) {
    return (
      <button
        type="button"
        className="group relative block aspect-video w-full overflow-hidden rounded-md border border-border bg-black"
        onClick={() => {
          setPlaying(true);
          events?.onPlay?.();
        }}
      >
        <img
          src={thumb}
          alt={`${video.title} thumbnail`}
          loading="lazy"
          className="h-full w-full object-cover opacity-90 transition group-hover:opacity-100"
        />
        <span className="absolute inset-0 flex items-center justify-center">
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-background/85 text-foreground shadow-md transition group-hover:scale-105">
            <PlayIcon className="ml-1 h-6 w-6 fill-current" aria-hidden />
          </span>
        </span>
        <span className="sr-only">Play "{video.title}" on YouTube</span>
      </button>
    );
  }

  return (
    <div className="aspect-video w-full overflow-hidden rounded-md border border-border bg-black">
      <iframe
        src={embedUrl}
        title={video.title}
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
        allowFullScreen
        className="h-full w-full border-0"
      />
    </div>
  );
}

function UnknownYouTubeFallback({
  url,
  events,
}: {
  url: string | null;
  events?: PlayerEvents;
}) {
  return (
    <div className="rounded-md border border-border bg-muted/30 p-3 text-sm">
      <p className="text-muted-foreground">
        Could not parse this YouTube URL for inline playback.
      </p>
      {url && (
        <a
          href={url}
          target="_blank"
          rel="noreferrer noopener"
          className="mt-1 inline-block text-sm font-medium text-foreground underline-offset-2 hover:underline"
          onClick={() => events?.onOpened?.()}
        >
          Open on YouTube
        </a>
      )}
    </div>
  );
}
