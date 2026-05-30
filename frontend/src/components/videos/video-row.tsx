import { useState } from "react";
import { Loader2, MoreVerticalIcon, TrashIcon } from "lucide-react";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

interface VideoRowProps {
  video: Video;
  canManage: boolean;
  onDeleted: (videoId: number) => void;
}

export function VideoRow({ video, canManage, onDeleted }: VideoRowProps) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

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

  const subtitle = buildSubtitle(video);

  return (
    <li
      className={cn(
        "flex items-center justify-between gap-3 rounded-md border border-border bg-card p-3",
        video.processing_status === "failed" && "border-destructive/40",
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate text-sm font-medium text-foreground">
            {video.title}
          </p>
          <StatusBadge video={video} />
        </div>
        {subtitle && (
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {subtitle}
          </p>
        )}
        {video.processing_status === "failed" && video.processing_error && (
          <p className="mt-1 text-xs text-destructive">
            {video.processing_error}
          </p>
        )}
      </div>

      {canManage && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-muted-foreground"
            >
              <MoreVerticalIcon className="h-4 w-4" aria-hidden />
              <span className="sr-only">Video actions</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              onSelect={(event) => {
                event.preventDefault();
                setConfirmOpen(true);
              }}
            >
              <TrashIcon className="mr-2 h-4 w-4" aria-hidden />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this video?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes "{video.title}" from this technique. Watch
              history for this video will also be cleared.
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

function StatusBadge({ video }: { video: Video }) {
  if (video.processing_status === "processing") {
    return (
      <Badge variant="outline" className="gap-1 text-xs">
        <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
        Processing
      </Badge>
    );
  }
  if (video.processing_status === "failed") {
    return (
      <Badge variant="destructive" className="text-xs">
        Failed
      </Badge>
    );
  }
  const kindLabel = kindLabelFor(video);
  return kindLabel ? (
    <Badge variant="secondary" className="text-xs uppercase tracking-wide">
      {kindLabel}
    </Badge>
  ) : null;
}

function kindLabelFor(video: Video): string | null {
  switch (video.kind) {
    case "native":
      return "Upload";
    case "youtube":
      return "YouTube";
    case "vimeo":
      return "Vimeo";
    case "drive":
      return "Drive";
    case "link":
      return "Link";
    default:
      return null;
  }
}

function buildSubtitle(video: Video): string | null {
  const parts: string[] = [];
  if (typeof video.duration_seconds === "number" && video.duration_seconds > 0) {
    parts.push(formatDuration(video.duration_seconds));
  }
  if (video.description) {
    parts.push(video.description);
  }
  return parts.length ? parts.join(" · ") : null;
}

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}
