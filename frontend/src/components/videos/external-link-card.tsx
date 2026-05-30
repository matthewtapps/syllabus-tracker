import { ExternalLinkIcon } from "lucide-react";
import type { Video } from "@/lib/api";
import type { PlayerEvents } from "./player-events";
import { Button } from "@/components/ui/button";

interface ExternalLinkCardProps {
  video: Video;
  events?: PlayerEvents;
}

export function ExternalLinkCard({ video, events }: ExternalLinkCardProps) {
  if (!video.external_url) {
    return (
      <div className="rounded-md border border-border bg-muted/30 p-3 text-sm text-muted-foreground">
        No external URL on file for this video.
      </div>
    );
  }

  let displayHost = "external site";
  try {
    displayHost = new URL(video.external_url).hostname;
  } catch {
    // ignore
  }

  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-muted/30 p-3">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-foreground">{video.title}</p>
        <p className="truncate text-xs text-muted-foreground">{displayHost}</p>
      </div>
      <Button asChild size="sm" variant="outline">
        <a
          href={video.external_url}
          target="_blank"
          rel="noreferrer noopener"
          onClick={() => events?.onOpened?.()}
        >
          <ExternalLinkIcon className="mr-1.5 h-4 w-4" aria-hidden />
          Open
        </a>
      </Button>
    </div>
  );
}
