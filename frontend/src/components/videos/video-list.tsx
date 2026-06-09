import { useEffect, useMemo, useRef, useState } from "react";
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
import type { VisibilityCtx } from "@/lib/api";
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
  /** When set, the list is fetched in the context of viewing this student's
   * techniques: coaches see per-student override info per row and the
   * visibility popover lets them set both global and per-student. */
  forStudent?: number;
  /** Name shown in the per-student visibility controls. Only used when
   * `forStudent` is also set. */
  studentDisplayName?: string;
  /** When set, scroll the matching video row into view once the list loads.
   * Used by the dashboard "recently watched" link to land on the specific
   * video the user tapped. */
  scrollToVideoId?: number | null;
  onVideoScrolled?: () => void;
  /** Visibility context the list is browsed in. Threaded into the
   * /techniques/<tid>/videos request and into every signed-playback /
   * download URL request so the backend applies the correct overrides
   * (library = global hide only, syllabus = global + syllabus override
   * table). Defaults to syllabus for backwards compatibility. */
  ctx?: VisibilityCtx;
}

export function VideoList({
  techniqueId,
  canManage,
  reloadKey = 0,
  forStudent,
  studentDisplayName,
  scrollToVideoId,
  onVideoScrolled,
  ctx,
}: VideoListProps) {
  const qc = useQueryClient();
  const videosQuery = useTechniqueVideos(techniqueId, forStudent, ctx);
  const serverVideos = videosQuery.data ?? null;
  const error = videosQuery.error ? "Could not load videos" : null;
  const reorderMutation = useReorderVideos(techniqueId);

  // External bumps (e.g. after AddVideoButton finishes) request a refetch
  // across every (technique, forStudent) cache bucket so all viewer
  // contexts see the new video.
  useEffect(() => {
    if (reloadKey > 0) {
      qc.invalidateQueries({ queryKey: qk.techniqueVideosAll(techniqueId) });
    }
  }, [reloadKey, techniqueId, qc]);

  // When arriving with a target video id (e.g. from the dashboard's
  // "recently watched" link), scroll its row into view once it has rendered.
  // Fires once per target, then notifies the parent to clear it.
  const didScrollToVideoRef = useRef<number | null>(null);
  useEffect(() => {
    if (scrollToVideoId == null) return;
    if (didScrollToVideoRef.current === scrollToVideoId) return;
    if (!serverVideos) return;
    if (!serverVideos.some((v) => v.id === scrollToVideoId)) return;
    didScrollToVideoRef.current = scrollToVideoId;
    requestAnimationFrame(() => {
      const el = document.getElementById(`video-row-${scrollToVideoId}`);
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      onVideoScrolled?.();
    });
  }, [scrollToVideoId, serverVideos, onVideoScrolled]);

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
    qc.setQueryData(
      qk.techniqueVideos(techniqueId, forStudent ?? null),
      (prev: Video[] | null | undefined) =>
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
      <ul className="divide-y divide-white/15 overflow-hidden rounded-md border border-white/20 bg-card shadow-sm">
        <li className="h-10 animate-pulse bg-muted/40" />
        <li className="h-10 animate-pulse bg-muted/40" />
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
            <ul className="divide-y divide-white/15 overflow-hidden rounded-md border border-white/20 bg-card shadow-sm">
              {videos.map((video) => (
                <SortableVideoRow
                  key={video.id}
                  video={video}
                  techniqueId={techniqueId}
                  canManage={canManage}
                  forStudent={forStudent}
                  studentDisplayName={studentDisplayName}
                  onPlay={() => setPlaying(video)}
                  onDeleted={handleDeleted}
                />
              ))}
            </ul>
          </SortableContext>
        </DndContext>
      ) : (
        <ul className="divide-y divide-white/15 overflow-hidden rounded-md border border-white/20 bg-card shadow-sm">
          {videos.map((video) => (
            <VideoRow
              key={video.id}
              video={video}
              techniqueId={techniqueId}
              canManage={canManage}
              forStudent={forStudent}
              studentDisplayName={studentDisplayName}
              onPlay={() => setPlaying(video)}
              onDeleted={handleDeleted}
            />
          ))}
        </ul>
      )}

      <VideoPlayerDialog video={playing} onClose={() => setPlaying(null)} ctx={ctx} />
    </div>
  );
}

interface SortableVideoRowProps {
  video: Video;
  techniqueId: number;
  canManage: boolean;
  forStudent?: number;
  studentDisplayName?: string;
  onPlay: () => void;
  onDeleted: (videoId: number) => void;
}

function SortableVideoRow({
  video,
  techniqueId,
  canManage,
  forStudent,
  studentDisplayName,
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
        techniqueId={techniqueId}
        canManage={canManage}
        forStudent={forStudent}
        studentDisplayName={studentDisplayName}
        onPlay={onPlay}
        onDeleted={onDeleted}
        dragHandle={handle}
      />
    </div>
  );
}
