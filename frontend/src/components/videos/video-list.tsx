import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import type { Video } from "@/lib/api";
import { listVideos } from "@/lib/api";
import { VideoRow } from "./video-row";

interface VideoListProps {
  techniqueId: number;
  canManage: boolean;
  reloadKey?: number;
}

const POLL_INTERVAL_MS = 2_000;

export function VideoList({
  techniqueId,
  canManage,
  reloadKey = 0,
}: VideoListProps) {
  const [videos, setVideos] = useState<Video[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const cancelledRef = useRef(false);

  const load = useCallback(async () => {
    try {
      const next = await listVideos(techniqueId);
      if (!cancelledRef.current) {
        setVideos(next);
        setError(null);
      }
    } catch (err) {
      console.error(err);
      if (!cancelledRef.current) {
        setError("Could not load videos");
      }
    }
  }, [techniqueId]);

  useEffect(() => {
    cancelledRef.current = false;
    load();
    return () => {
      cancelledRef.current = true;
    };
  }, [load, reloadKey]);

  const hasProcessing =
    videos?.some((v) => v.processing_status === "processing") ?? false;

  useEffect(() => {
    if (!hasProcessing) return;
    const handle = window.setInterval(() => {
      load();
    }, POLL_INTERVAL_MS);
    return () => window.clearInterval(handle);
  }, [hasProcessing, load]);

  const [expandedId, setExpandedId] = useState<number | null>(null);

  function handleDeleted(videoId: number) {
    setVideos((prev) => (prev ? prev.filter((v) => v.id !== videoId) : prev));
    setExpandedId((current) => (current === videoId ? null : current));
  }

  function toggleExpanded(videoId: number) {
    setExpandedId((current) => (current === videoId ? null : videoId));
  }

  if (error) {
    return (
      <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
        {error}{" "}
        <button
          type="button"
          className="ml-1 underline-offset-2 hover:underline"
          onClick={() => {
            setError(null);
            load();
            toast.message("Reloading videos");
          }}
        >
          Try again
        </button>
      </div>
    );
  }

  if (videos === null) {
    return (
      <ul className="space-y-2">
        <li className="h-12 animate-pulse rounded-md bg-muted/40" />
        <li className="h-12 animate-pulse rounded-md bg-muted/40" />
      </ul>
    );
  }

  if (videos.length === 0) {
    return (
      <p className="text-sm italic text-muted-foreground">
        {canManage
          ? "No videos yet. Add the first demo with the button above."
          : "No videos yet."}
      </p>
    );
  }

  return (
    <ul className="space-y-2">
      {videos.map((video) => (
        <VideoRow
          key={video.id}
          video={video}
          canManage={canManage}
          expanded={expandedId === video.id}
          onToggleExpanded={() => toggleExpanded(video.id)}
          onDeleted={handleDeleted}
        />
      ))}
    </ul>
  );
}
