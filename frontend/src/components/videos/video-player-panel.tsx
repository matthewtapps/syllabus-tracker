import type { ReactNode } from "react";
import type { Video } from "@/lib/api";
import type { PlayerEvents } from "./player-events";
import { DriveEmbed } from "./drive-embed";
import { ExternalLinkCard } from "./external-link-card";
import { VidstackPlayer } from "./vidstack-player";
import { VideoProcessingTile } from "./video-processing-tile";
import { VimeoLiteEmbed } from "./vimeo-lite-embed";
import { YouTubeLiteEmbed } from "./youtube-lite-embed";

interface VideoPlayerPanelProps {
  video: Video;
  events?: PlayerEvents;
  /** Native-player-only slots; ignored for embeds, which cannot host them. */
  overlay?: ReactNode;
  sliderMarkers?: ReactNode;
}

export function VideoPlayerPanel({
  video,
  events,
  overlay,
  sliderMarkers,
}: VideoPlayerPanelProps) {
  if (video.processing_status === "processing") {
    return <VideoProcessingTile video={video} state="processing" />;
  }
  if (video.processing_status === "failed") {
    return <VideoProcessingTile video={video} state="failed" />;
  }

  switch (video.kind) {
    case "native":
      return (
        <VidstackPlayer
          video={video}
          events={events}
          overlay={overlay}
          sliderMarkers={sliderMarkers}
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
