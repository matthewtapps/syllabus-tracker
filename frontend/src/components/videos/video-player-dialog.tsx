import { useState } from "react";
import { DownloadIcon } from "lucide-react";
import { toast } from "sonner";
import type { Video } from "@/lib/api";
import { getDownloadUrl } from "@/lib/api";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { VideoPlayerPanel } from "./video-player-panel";
import { useWatchTracker } from "./useWatchTracker";

interface VideoPlayerDialogProps {
  video: Video | null;
  onClose: () => void;
}

export function VideoPlayerDialog({ video, onClose }: VideoPlayerDialogProps) {
  return (
    <Dialog open={!!video} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] w-[calc(100vw-1rem)] max-w-2xl overflow-y-auto p-4 sm:p-6 [&>*]:min-w-0">
        <DialogHeader className="min-w-0 pr-8">
          {/* line-clamp-2 + break-words so long titles wrap inside the
              dialog instead of forcing it to grow past the viewport. */}
          <DialogTitle className="line-clamp-2 break-words text-base leading-snug">
            {video?.title ?? "Video"}
          </DialogTitle>
        </DialogHeader>
        {video && <PlayerContent video={video} />}
      </DialogContent>
    </Dialog>
  );
}

function PlayerContent({ video }: { video: Video }) {
  const events = useWatchTracker(video.id);
  const isNative = video.kind === "native";
  const canDownload = isNative && video.processing_status === "ready";
  const [downloading, setDownloading] = useState(false);

  async function handleDownload() {
    setDownloading(true);
    try {
      const signed = await getDownloadUrl(video.id);
      window.open(signed.url, "_blank", "noopener,noreferrer");
    } catch (err) {
      console.error(err);
      toast.error("Could not start download");
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className="space-y-3">
      <VideoPlayerPanel video={video} events={events} />
      {canDownload && (
        <div className="flex justify-end">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleDownload}
            disabled={downloading}
          >
            <DownloadIcon className="mr-2 h-4 w-4" aria-hidden />
            Download
          </Button>
        </div>
      )}
    </div>
  );
}
