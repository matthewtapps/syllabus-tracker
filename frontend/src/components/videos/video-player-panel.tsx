import type { Video } from "@/lib/api";
import type { PlayerEvents } from "./player-events";
import { DriveEmbed } from "./drive-embed";
import { ExternalLinkCard } from "./external-link-card";
import { NativePlayer } from "./native-player";
import { VimeoLiteEmbed } from "./vimeo-lite-embed";
import { YouTubeLiteEmbed } from "./youtube-lite-embed";

interface VideoPlayerPanelProps {
  video: Video;
  events?: PlayerEvents;
}

export function VideoPlayerPanel({ video, events }: VideoPlayerPanelProps) {
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
      return <NativePlayer video={video} events={events} />;
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
