import { useCallback, useEffect, useState } from "react";
import { PlayIcon } from "lucide-react";
import type { Video } from "@/lib/api";
import { listVideos } from "@/lib/api";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { AddVideoButton } from "@/components/videos/add-video-button";
import { VideoPlayerPanel } from "@/components/videos/video-player-panel";
import { useWatchTracker } from "@/components/videos/useWatchTracker";

interface InlineVideoListProps {
  libraryTechniqueId: number;
  canManage: boolean;
}

export function InlineVideoList({
  libraryTechniqueId,
  canManage,
}: InlineVideoListProps) {
  const [videos, setVideos] = useState<Video[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState<Video | null>(null);

  const load = useCallback(async () => {
    try {
      const list = await listVideos(libraryTechniqueId);
      setVideos(list);
      setError(null);
    } catch (err) {
      console.error(err);
      setError("Could not load videos");
    }
  }, [libraryTechniqueId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await listVideos(libraryTechniqueId);
        if (!cancelled) setVideos(list);
      } catch (err) {
        console.error(err);
        if (!cancelled) setError("Could not load videos");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [libraryTechniqueId]);

  const isEmpty = videos !== null && videos.length === 0;
  // Hide the section entirely for non-coaches when there are no videos —
  // nothing to play and nothing to add.
  if (isEmpty && !canManage) return null;

  return (
    <section className="space-y-2" onClick={(e) => e.stopPropagation()}>
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Videos
        </h3>
        {canManage && (
          <AddVideoButton
            techniqueId={libraryTechniqueId}
            onAdded={() => load()}
          />
        )}
      </div>

      {error && <p className="text-xs text-destructive">{error}</p>}
      {videos === null && !error && (
        <p className="text-xs text-muted-foreground">Loading videos...</p>
      )}
      {isEmpty && canManage && (
        <p className="text-xs italic text-muted-foreground">
          No videos yet. Add the first demo with the button above.
        </p>
      )}
      {videos && videos.length > 0 && (
        <ul className="divide-y divide-border rounded-md border border-border">
          {videos.map((video) => {
            const playable = video.processing_status === "ready";
            return (
              <li key={video.id}>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (playable) setPlaying(video);
                  }}
                  disabled={!playable}
                  className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm hover:bg-muted/40 disabled:cursor-not-allowed disabled:opacity-70"
                >
                  <PlayIcon
                    className="h-4 w-4 shrink-0 text-muted-foreground"
                    aria-hidden
                  />
                  <span className="min-w-0 flex-1 truncate font-medium">
                    {video.title}
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {playable
                      ? formatDuration(video.duration_seconds)
                      : statusLabel(video.processing_status)}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <VideoPlayerDialog video={playing} onClose={() => setPlaying(null)} />
    </section>
  );
}

interface VideoPlayerDialogProps {
  video: Video | null;
  onClose: () => void;
}

function VideoPlayerDialog({ video, onClose }: VideoPlayerDialogProps) {
  return (
    <Dialog open={!!video} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] w-[calc(100vw-1rem)] max-w-2xl overflow-y-auto p-4 sm:p-6">
        <DialogHeader className="pr-8">
          <DialogTitle className="truncate text-base">
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
  return <VideoPlayerPanel video={video} events={events} />;
}

function formatDuration(seconds: number | null | undefined): string {
  if (typeof seconds !== "number" || seconds <= 0) return "";
  const mins = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

function statusLabel(status: string): string {
  if (status === "processing") return "Processing...";
  if (status === "failed") return "Failed";
  return "";
}
