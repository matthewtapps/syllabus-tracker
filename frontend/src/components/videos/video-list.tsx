import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import {
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVerticalIcon } from "lucide-react";
import { useTechniqueVideos } from "@/lib/queries";
import { useReorderVideos } from "@/lib/mutations";
import { qk } from "@/lib/query-keys";
import type { Video } from "@/lib/api";
import { cn } from "@/lib/utils";
import { PrivacyAckBanner } from "./privacy-ack-banner";
import { VideoPlayerDialog } from "./video-player-dialog";
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
  const serverVideos = videosQuery.data ?? null;
  const error = videosQuery.error ? "Could not load videos" : null;
  const reorderMutation = useReorderVideos(techniqueId);

  // External bumps (e.g. after AddVideoButton finishes) request a refetch.
  useEffect(() => {
    if (reloadKey > 0) {
      qc.invalidateQueries({ queryKey: qk.techniqueVideos(techniqueId) });
    }
  }, [reloadKey, techniqueId, qc]);

  const [playing, setPlaying] = useState<Video | null>(null);
  // Optimistic local order during DnD; falls back to server data otherwise.
  const [localOrder, setLocalOrder] = useState<number[] | null>(null);

  const videos: Video[] | null = useMemo(() => {
    if (!serverVideos) return null;
    if (!localOrder) return serverVideos;
    const byId = new Map(serverVideos.map((v) => [v.id, v]));
    const ordered: Video[] = [];
    for (const id of localOrder) {
      const v = byId.get(id);
      if (v) {
        ordered.push(v);
        byId.delete(id);
      }
    }
    // Anything new on the server (e.g. just uploaded) appends at the end.
    for (const v of byId.values()) ordered.push(v);
    return ordered;
  }, [serverVideos, localOrder]);

  function handleDeleted(videoId: number) {
    qc.setQueryData(qk.techniqueVideos(techniqueId), (prev: Video[] | null | undefined) =>
      prev ? prev.filter((v) => v.id !== videoId) : prev,
    );
    setLocalOrder((prev) => prev?.filter((id) => id !== videoId) ?? prev);
    setPlaying((current) => (current?.id === videoId ? null : current));
  }

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id || !videos) return;
    const ids = videos.map((v) => v.id);
    const oldIndex = ids.indexOf(Number(active.id));
    const newIndex = ids.indexOf(Number(over.id));
    if (oldIndex < 0 || newIndex < 0) return;
    const next = arrayMove(ids, oldIndex, newIndex);
    setLocalOrder(next);
    reorderMutation.mutate(next, {
      onError: () => {
        toast.error("Could not save new order");
        setLocalOrder(null);
      },
      onSuccess: () => {
        // Server's new order matches our local one; let the next refetch
        // refresh `serverVideos`, then we can drop the override.
        setLocalOrder(null);
      },
    });
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
      <ul className="space-y-1.5">
        <li className="h-10 animate-pulse rounded-md bg-muted/40" />
        <li className="h-10 animate-pulse rounded-md bg-muted/40" />
      </ul>
    );
  }

  if (videos.length === 0) {
    return (
      <p className="text-xs italic text-muted-foreground">
        {canManage
          ? "No videos yet. Add the first demo with the button above."
          : "No videos yet."}
      </p>
    );
  }

  const dndEnabled = canManage && videos.length > 1;
  const ids = videos.map((v) => v.id);

  return (
    <div className="space-y-2">
      <PrivacyAckBanner enabled={!canManage && playing !== null} />
      {dndEnabled ? (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext items={ids} strategy={verticalListSortingStrategy}>
            <ul className="space-y-1.5">
              {videos.map((video) => (
                <SortableVideoRow
                  key={video.id}
                  video={video}
                  canManage={canManage}
                  onPlay={() => setPlaying(video)}
                  onDeleted={handleDeleted}
                />
              ))}
            </ul>
          </SortableContext>
        </DndContext>
      ) : (
        <ul className="space-y-1.5">
          {videos.map((video) => (
            <VideoRow
              key={video.id}
              video={video}
              canManage={canManage}
              onPlay={() => setPlaying(video)}
              onDeleted={handleDeleted}
            />
          ))}
        </ul>
      )}

      <VideoPlayerDialog video={playing} onClose={() => setPlaying(null)} />
    </div>
  );
}

interface SortableVideoRowProps {
  video: Video;
  canManage: boolean;
  onPlay: () => void;
  onDeleted: (videoId: number) => void;
}

function SortableVideoRow({
  video,
  canManage,
  onPlay,
  onDeleted,
}: SortableVideoRowProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: video.id });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const handle = (
    <button
      type="button"
      ref={setActivatorNodeRef}
      {...attributes}
      {...listeners}
      className="touch-none rounded p-1 text-muted-foreground hover:bg-muted/60 hover:text-foreground"
      aria-label={`Reorder ${video.title}`}
    >
      <GripVerticalIcon className="h-4 w-4" aria-hidden />
    </button>
  );

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(isDragging && "opacity-60")}
    >
      <VideoRow
        video={video}
        canManage={canManage}
        onPlay={onPlay}
        onDeleted={onDeleted}
        dragHandle={handle}
      />
    </div>
  );
}
