import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { useTechniqueVideos } from "@/lib/queries";
import { qk } from "@/lib/query-keys";
import { PrivacyAckBanner } from "./privacy-ack-banner";
import { VideoRow } from "./video-row";

interface VideoListProps {
  techniqueId: number;
  canManage: boolean;
  reloadKey?: number;
}

export function VideoList({
  techniqueId,
  canManage,
  reloadKey = 0,
}: VideoListProps) {
  const qc = useQueryClient();
  const videosQuery = useTechniqueVideos(techniqueId);
  const videos = videosQuery.data ?? null;
  const error = videosQuery.error ? "Could not load videos" : null;

  // External bumps (e.g. after AddVideoButton finishes) request a refetch.
  useEffect(() => {
    if (reloadKey > 0) {
      qc.invalidateQueries({ queryKey: qk.techniqueVideos(techniqueId) });
    }
  }, [reloadKey, techniqueId, qc]);

  const [expandedId, setExpandedId] = useState<number | null>(null);

  function handleDeleted(videoId: number) {
    qc.setQueryData(qk.techniqueVideos(techniqueId), (prev: typeof videos) =>
      prev ? prev.filter((v) => v.id !== videoId) : prev,
    );
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
            videosQuery.refetch();
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
    <div className="space-y-3">
      <PrivacyAckBanner enabled={!canManage && expandedId !== null} />
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
    </div>
  );
}
