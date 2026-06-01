import { useState } from "react";
import { Loader2, PlayIcon, TrashIcon } from "lucide-react";
import { toast } from "sonner";
import type { Video } from "@/lib/api";
import { deleteVideo } from "@/lib/api";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface VideoRowProps {
  video: Video;
  canManage: boolean;
  onPlay: () => void;
  onDeleted: (videoId: number) => void;
  /** Render-prop for a drag handle when sortable. */
  dragHandle?: React.ReactNode;
}

export function VideoRow({
  video,
  canManage,
  onPlay,
  onDeleted,
  dragHandle,
}: VideoRowProps) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const isProcessing = video.processing_status === "processing";
  const isFailed = video.processing_status === "failed";
  const isPlayable = video.processing_status === "ready";

  async function handleDelete() {
    setDeleting(true);
    try {
      await deleteVideo(video.id);
      toast.success("Video deleted");
      onDeleted(video.id);
    } catch (err) {
      console.error(err);
      toast.error("Could not delete video");
    } finally {
      setDeleting(false);
      setConfirmOpen(false);
    }
  }

  return (
    <li
      className={cn(
        "relative overflow-hidden rounded-md border border-border bg-card",
        isFailed && "border-destructive/40",
      )}
    >
      <div className="flex items-center gap-1.5 px-2 py-1.5 sm:px-3 sm:py-2">
        {dragHandle}
        <button
          type="button"
          onClick={isPlayable ? onPlay : undefined}
          disabled={!isPlayable}
          className={cn(
            "flex min-w-0 flex-1 items-center gap-3 text-left",
            isPlayable
              ? "cursor-pointer"
              : "cursor-not-allowed opacity-80",
          )}
        >
          {isProcessing ? (
            <Loader2
              className="h-4 w-4 shrink-0 animate-spin text-muted-foreground"
              aria-hidden
            />
          ) : (
            <PlayIcon
              className="h-4 w-4 shrink-0 text-muted-foreground"
              aria-hidden
            />
          )}
          <span className="min-w-0 flex-1 truncate text-sm font-medium">
            {video.title}
          </span>
          <span className="shrink-0 text-xs text-muted-foreground">
            {isFailed
              ? "Failed"
              : isProcessing
                ? "Processing..."
                : formatDuration(video.duration_seconds)}
          </span>
        </button>

        {canManage && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive"
            onClick={(e) => {
              e.stopPropagation();
              setConfirmOpen(true);
            }}
            aria-label={`Delete ${video.title}`}
          >
            <TrashIcon className="h-3.5 w-3.5" aria-hidden />
          </Button>
        )}
      </div>

      {isProcessing && (
        <div
          className="absolute inset-x-0 bottom-0 h-0.5 overflow-hidden bg-muted/60"
          aria-hidden
        >
          <div className="h-full w-1/3 animate-[processingBar_1.4s_ease-in-out_infinite] rounded-full bg-primary/70" />
        </div>
      )}

      {isFailed && video.processing_error && (
        <p className="border-t border-destructive/30 bg-destructive/5 px-3 py-1.5 text-xs text-destructive">
          {video.processing_error}
        </p>
      )}

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this video?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes &ldquo;{video.title}&rdquo; from this
              technique. Watch history for this video will also be cleared.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                handleDelete();
              }}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting ? "Deleting..." : "Delete permanently"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </li>
  );
}

function formatDuration(seconds: number | null | undefined): string {
  if (typeof seconds !== "number" || seconds <= 0) return "";
  const mins = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}
