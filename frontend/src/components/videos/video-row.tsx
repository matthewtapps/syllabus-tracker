import { useState } from "react";
import {
  Eye,
  EyeOff,
  Loader2,
  MoreVerticalIcon,
  PencilIcon,
  PlayIcon,
  TrashIcon,
} from "lucide-react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import type { Video } from "@/lib/api";
import {
  deleteVideo,
  setVideoGlobalHidden,
  setVideoStudentVisibility,
  updateVideo,
} from "@/lib/api";
import { qk } from "@/lib/query-keys";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Sheet,
  SheetContent,
  SheetTitle,
} from "@/components/ui/sheet";
import { useMediaQuery } from "@/lib/use-media-query";
import { cn } from "@/lib/utils";
import { VisibilityPopover } from "./visibility-popover";

interface VideoRowProps {
  video: Video;
  techniqueId: number;
  canManage: boolean;
  onPlay: () => void;
  onDeleted: (videoId: number) => void;
  /** When set, the visibility eye-icon opens a popover that lets the coach
   * set both global and per-student visibility. When omitted (library
   * view), clicking the eye toggles global directly. */
  forStudent?: number;
  studentDisplayName?: string;
  /** Render-prop for a drag handle when sortable. */
  dragHandle?: React.ReactNode;
}

export function VideoRow({
  video,
  techniqueId,
  canManage,
  onPlay,
  onDeleted,
  forStudent,
  studentDisplayName,
  dragHandle,
}: VideoRowProps) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);

  const isProcessing = video.processing_status === "processing";
  const isFailed = video.processing_status === "failed";
  const isPlayable = video.processing_status === "ready";
  const hiddenGlobally = video.hidden_at != null;
  const override = video.override_for_student ?? null;

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
      id={`video-row-${video.id}`}
      className={cn(
        "relative bg-card",
        isFailed && "bg-destructive/5",
        // Subtle inset accent so coaches can spot globally-hidden videos
        // when scanning a long list. Students never see hidden videos
        // (filtered server-side), so this only renders for coaches.
        hiddenGlobally && "border-l-2 border-dashed border-l-muted-foreground/40",
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
          {/* Title wraps to at most two lines (industry-standard YouTube-/
              Spotify-style mobile list pattern). Longer titles ellipsise;
              full title is shown in the player dialog header on tap. */}
          <span className="line-clamp-2 min-w-0 flex-1 text-sm font-medium leading-snug">
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
          <VisibilityControl
            video={video}
            techniqueId={techniqueId}
            hiddenGlobally={hiddenGlobally}
            override={override}
            forStudent={forStudent}
            studentDisplayName={studentDisplayName}
          />
        )}

        {canManage && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-7 w-7 shrink-0 text-muted-foreground"
                onClick={(e) => e.stopPropagation()}
                aria-label={`Actions for ${video.title}`}
              >
                <MoreVerticalIcon className="h-3.5 w-3.5" aria-hidden />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
              <DropdownMenuItem
                onSelect={() => {
                  // Defer mount so the dropdown's pointer-events teardown
                  // completes before the dialog opens.
                  setTimeout(() => setRenameOpen(true), 0);
                }}
              >
                <PencilIcon className="mr-2 h-4 w-4" aria-hidden />
                Rename
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                onSelect={() => setTimeout(() => setConfirmOpen(true), 0)}
              >
                <TrashIcon className="mr-2 h-4 w-4" aria-hidden />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
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
        <p className="border-t border-destructive/30 px-3 py-1.5 text-xs text-destructive">
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

      <RenameVideoDialog
        open={renameOpen}
        onOpenChange={setRenameOpen}
        video={video}
        techniqueId={techniqueId}
      />
    </li>
  );
}

interface RenameVideoDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  video: Video;
  techniqueId: number;
}

function RenameVideoDialog({
  open,
  onOpenChange,
  video,
  techniqueId,
}: RenameVideoDialogProps) {
  const qc = useQueryClient();
  const [title, setTitle] = useState(video.title);
  const [saving, setSaving] = useState(false);
  // Reset the input whenever the dialog reopens on a different video.
  const [seededFor, setSeededFor] = useState<number | null>(null);
  if (open && seededFor !== video.id) {
    setTitle(video.title);
    setSeededFor(video.id);
  }
  if (!open && seededFor !== null) {
    setSeededFor(null);
  }

  const trimmed = title.trim();
  const unchanged = trimmed === video.title;
  const tooShort = trimmed.length === 0;

  async function handleSave() {
    if (tooShort || unchanged) return;
    setSaving(true);
    try {
      await updateVideo(video.id, { title: trimmed });
      qc.invalidateQueries({ queryKey: qk.techniqueVideosAll(techniqueId) });
      toast.success("Renamed");
      onOpenChange(false);
    } catch (err) {
      console.error(err);
      toast.error("Could not rename video");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100vw-1rem)] max-w-md p-4 sm:p-6">
        <DialogHeader>
          <DialogTitle>Rename video</DialogTitle>
          <DialogDescription>
            The new title shows for every student.
          </DialogDescription>
        </DialogHeader>
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          autoFocus
          onKeyDown={(e) => {
            if (e.key === "Enter" && !tooShort && !unchanged) {
              e.preventDefault();
              void handleSave();
            }
          }}
        />
        <DialogFooter className="gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={handleSave}
            disabled={saving || tooShort || unchanged}
          >
            {saving ? "Saving..." : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface VisibilityControlProps {
  video: Video;
  techniqueId: number;
  hiddenGlobally: boolean;
  override: "show" | "hide" | null;
  forStudent?: number;
  studentDisplayName?: string;
}

function VisibilityControl({
  video,
  techniqueId,
  hiddenGlobally,
  override,
  forStudent,
  studentDisplayName,
}: VisibilityControlProps) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  // Hoisted so the rules-of-hooks invariant holds across both render
  // branches (library context returns early below).
  const isDesktop = useMediaQuery("(min-width: 640px)");

  const inStudentContext =
    typeof forStudent === "number" && !!studentDisplayName;

  // Eye icon state:
  // - override "show"  → primary Eye  (explicit grant)
  // - override "hide"  → primary EyeOff (explicit deny)
  // - no override, globally hidden → muted EyeOff
  // - no override, visible → muted Eye
  const effectiveActive = override !== null;
  const EyeIcon =
    override === "hide" || (override === null && hiddenGlobally) ? EyeOff : Eye;
  const iconColor = effectiveActive
    ? "text-primary"
    : "text-muted-foreground";
  const ariaLabel = `Visibility for ${video.title}`;

  function invalidateVideos() {
    qc.invalidateQueries({ queryKey: qk.techniqueVideosAll(techniqueId) });
  }

  // Direct API calls (not the mutation hooks) so the undo button's
  // closure doesn't depend on a re-rendered mutation reference. We
  // capture the prior state at call time and the undo callback fires a
  // fresh request that flips back.
  async function applyGlobal(hidden: boolean): Promise<boolean> {
    const response = await setVideoGlobalHidden(video.id, hidden);
    if (!response.ok) return false;
    invalidateVideos();
    return true;
  }

  async function applyOverride(
    studentId: number,
    visible: boolean | null,
  ): Promise<boolean> {
    const response = await setVideoStudentVisibility(
      video.id,
      studentId,
      visible,
    );
    if (!response.ok) return false;
    invalidateVideos();
    return true;
  }

  async function handleSetGlobal(hidden: boolean) {
    const prevHidden = hiddenGlobally;
    const ok = await applyGlobal(hidden);
    if (!ok) {
      toast.error("Could not update visibility");
      return;
    }
    toast.success(hidden ? "Hidden for everyone" : "Shown to everyone", {
      duration: 5000,
      action: {
        label: "Undo",
        onClick: () => {
          void applyGlobal(prevHidden);
        },
      },
    });
  }

  async function handleSetOverride(visible: boolean | null) {
    if (typeof forStudent !== "number") return;
    const studentId = forStudent;
    const prev = override;
    const ok = await applyOverride(studentId, visible);
    if (!ok) {
      toast.error("Could not update visibility");
      return;
    }
    const label =
      visible === true
        ? `Shown for ${studentDisplayName}`
        : visible === false
          ? `Hidden for ${studentDisplayName}`
          : `Following global for ${studentDisplayName}`;
    const prevVisible =
      prev === "show" ? true : prev === "hide" ? false : null;
    toast.success(label, {
      duration: 5000,
      action: {
        label: "Undo",
        onClick: () => {
          void applyOverride(studentId, prevVisible);
        },
      },
    });
  }

  // Library context: no popover, eye button toggles global directly.
  if (!inStudentContext) {
    return (
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className={cn("h-7 w-7 shrink-0", iconColor)}
        onClick={(e) => {
          e.stopPropagation();
          handleSetGlobal(!hiddenGlobally);
        }}
        aria-label={ariaLabel}
        title={hiddenGlobally ? "Hidden for everyone" : "Visible to everyone"}
      >
        <EyeIcon className="h-3.5 w-3.5" aria-hidden />
      </Button>
    );
  }

  // Student context: a popover on desktop, a bottom sheet on mobile. The
  // sheet gives room + reachability on small screens (the popover was
  // clipping on viewports <~400px) while keeping the click-anchored
  // popover where it works well on larger screens.
  const triggerButton = (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className={cn("h-7 w-7 shrink-0", iconColor)}
      onClick={(e) => {
        e.stopPropagation();
        setOpen(true);
      }}
      aria-label={ariaLabel}
    >
      <EyeIcon className="h-3.5 w-3.5" aria-hidden />
    </Button>
  );

  const popoverBody = (
    <VisibilityPopover
      hiddenGlobally={hiddenGlobally}
      overrideForStudent={override}
      studentDisplayName={studentDisplayName!}
      onSetGlobal={handleSetGlobal}
      onSetOverride={handleSetOverride}
    />
  );

  if (isDesktop) {
    return (
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>{triggerButton}</PopoverTrigger>
        <PopoverContent
          align="end"
          className="w-72 p-4"
          onClick={(e) => e.stopPropagation()}
        >
          {popoverBody}
        </PopoverContent>
      </Popover>
    );
  }

  return (
    <>
      {triggerButton}
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          side="bottom"
          className="rounded-t-xl px-4 pt-4 pb-[calc(env(safe-area-inset-bottom)+1rem)]"
          onClick={(e) => e.stopPropagation()}
        >
          <SheetTitle className="sr-only">
            Visibility for {video.title}
          </SheetTitle>
          {popoverBody}
        </SheetContent>
      </Sheet>
    </>
  );
}

function formatDuration(seconds: number | null | undefined): string {
  if (typeof seconds !== "number" || seconds <= 0) return "";
  const mins = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}
