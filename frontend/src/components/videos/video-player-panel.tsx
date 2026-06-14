import type { ReactNode } from "react";
import type { Video } from "@/lib/api";
import type { PlayerEvents } from "./player-events";
import { DriveEmbed } from "./drive-embed";
import { ExternalLinkCard } from "./external-link-card";
import { VidstackPlayer } from "./vidstack-player";
import { VimeoLiteEmbed } from "./vimeo-lite-embed";
import { YouTubeLiteEmbed } from "./youtube-lite-embed";

interface VideoPlayerPanelProps {
  video: Video;
  events?: PlayerEvents;
  /** Native-player-only slots; ignored for embeds, which cannot host them. */
  overlay?: ReactNode;
  sliderMarkers?: ReactNode;
  /** Native-player-only theater toggle; embeds cannot report a playhead. */
  canTheater?: boolean;
  theater?: boolean;
  onToggleTheater?: () => void;
}

export function VideoPlayerPanel({
  video,
  events,
  overlay,
  sliderMarkers,
  canTheater,
  theater,
  onToggleTheater,
}: VideoPlayerPanelProps) {
  if (video.processing_status === "processing") {
    return (
      <p className="rounded-md border border-border bg-muted/30 p-3 text-sm text-muted-foreground">
        This video is still processing. It will be playable once the upload
        finishes.
      </p>
    );
  }
  if (video.processing_status === "failed") {
    return (
      <p className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
        Processing failed for this video. Re-upload to try again.
      </p>
    );
  }

  switch (video.kind) {
    case "native":
      return (
        <VidstackPlayer
          video={video}
          events={events}
          overlay={overlay}
          sliderMarkers={sliderMarkers}
          canTheater={canTheater}
          theater={theater}
          onToggleTheater={onToggleTheater}
        />
      );
    case "youtube":
      return <YouTubeLiteEmbed video={video} events={events} />;
    case "vimeo":
      return <VimeoLiteEmbed video={video} events={events} />;
    case "drive":
      return <DriveEmbed video={video} events={events} />;
    case "link":
    default:
      return <ExternalLinkCard video={video} events={events} />;
  }
}
