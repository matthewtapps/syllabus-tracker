import { useEffect, useRef } from "react";
import { TriangleAlertIcon } from "lucide-react";
import type { Video } from "@/lib/api";
import type { PlayerEvents } from "./player-events";

interface DriveEmbedProps {
  video: Video;
  events?: PlayerEvents;
}

export function DriveEmbed({ video, events }: DriveEmbedProps) {
  const openedRef = useRef(false);
  const videoId = video.external_video_id;

  useEffect(() => {
    if (openedRef.current) return;
    openedRef.current = true;
    events?.onOpened?.();
  }, [events]);

  if (!videoId) {
    return (
      <div className="rounded-md border border-border bg-muted/30 p-3 text-sm">
        <p className="text-muted-foreground">
          Could not parse this Drive URL for inline playback.
        </p>
        {video.external_url && (
          <a
            href={video.external_url}
            target="_blank"
            rel="noreferrer noopener"
            className="mt-1 inline-block text-sm font-medium text-foreground underline-offset-2 hover:underline"
          >
            Open on Drive
          </a>
        )}
      </div>
    );
  }

  const embedUrl = `https://drive.google.com/file/d/${videoId}/preview`;

  return (
    <div className="space-y-2">
      <div className="aspect-video w-full overflow-hidden rounded-md border border-border bg-black">
        <iframe
          src={embedUrl}
          title={video.title}
          allow="autoplay"
          allowFullScreen
          className="h-full w-full border-0"
        />
      </div>
      <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
        <TriangleAlertIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
        <span>
          If the player above stays blank, the Drive share permission probably
          isn't set to &quot;Anyone with the link&quot;. Open it in Drive and update
          the share settings.
        </span>
      </p>
    </div>
  );
}
