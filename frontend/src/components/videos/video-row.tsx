import { useState } from "react";
import {
  ChevronDownIcon,
  ChevronUpIcon,
  DownloadIcon,
  Loader2,
  MoreVerticalIcon,
  TrashIcon,
} from "lucide-react";
import { toast } from "sonner";
import type { Video } from "@/lib/api";
import { deleteVideo, getDownloadUrl } from "@/lib/api";
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
import { useWatchTracker } from "./useWatchTracker";
import { VideoPlayerPanel } from "./video-player-panel";
import { VideoStatsPanel } from "./video-stats-panel";

interface VideoRowProps {
  video: Video;
  canManage: boolean;
  expanded: boolean;
  onToggleExpanded: () => void;
  onDeleted: (videoId: number) => void;
}

export function VideoRow({
  video,
  canManage,
  expanded,
  onToggleExpanded,
  onDeleted,
}: VideoRowProps) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [showStats, setShowStats] = useState(false);
  const trackerEvents = useWatchTracker(video.id);

  const canPlay = video.processing_status === "ready";
  const isNative = video.kind === "native";

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

  const subtitle = buildSubtitle(video);

  return (
    <li
      className={cn(
        "rounded-md border border-border bg-card",
        video.processing_status === "failed" && "border-destructive/40",
      )}
    >
      <div className="flex items-center gap-2 p-3">
        <button
          type="button"
          onClick={onToggleExpanded}
          disabled={!canPlay}
          aria-expanded={expanded}
          className={cn(
            "min-w-0 flex-1 text-left",
            canPlay
              ? "cursor-pointer"
              : "cursor-not-allowed opacity-80",
          )}
        >
          <div className="flex items-center gap-2">
            {canPlay ? (
              expanded ? (
                <ChevronUpIcon
                  className="h-4 w-4 text-muted-foreground"
                  aria-hidden
                />
              ) : (
                <ChevronDownIcon
                  className="h-4 w-4 text-muted-foreground"
                  aria-hidden
                />
              )
            ) : null}
            <p className="truncate text-sm font-medium text-foreground">
              {video.title}
            </p>
            <StatusBadge video={video} />
          </div>
          {subtitle && (
            <p className="ml-6 mt-0.5 truncate text-xs text-muted-foreground">
              {subtitle}
            </p>
          )}
          {video.processing_status === "failed" && video.processing_error && (
            <p className="ml-6 mt-1 text-xs text-destructive">
              {video.processing_error}
            </p>
          )}
        </button>

        <div className="flex items-center gap-1">
          {canPlay && isNative && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-muted-foreground"
              onClick={handleDownload}
              disabled={downloading}
              aria-label="Download video"
            >
              <DownloadIcon className="h-4 w-4" aria-hidden />
            </Button>
          )}
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
                  onSelect={() => {
                    // Defer one tick so the dropdown's pointer-events
                    // teardown completes before the AlertDialog mounts.
                    // Otherwise Radix leaves body pointer-events: none and
                    // the page locks until refresh.
                    setTimeout(() => setConfirmOpen(true), 0);
                  }}
                >
                  <TrashIcon className="mr-2 h-4 w-4" aria-hidden />
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>

      {expanded && canPlay && (
        <div className="border-t border-border p-3">
          <VideoPlayerPanel video={video} events={trackerEvents} />
          {canManage && (
            <div className="mt-3">
              <button
                type="button"
                className="text-xs font-medium text-muted-foreground underline-offset-2 hover:underline"
                onClick={() => setShowStats((v) => !v)}
              >
                {showStats ? "Hide stats" : "Show stats"}
              </button>
              {showStats && (
                <div className="mt-2">
                  <VideoStatsPanel videoId={video.id} />
                </div>
              )}
            </div>
          )}
        </div>
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
