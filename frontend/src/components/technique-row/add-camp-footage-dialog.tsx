/**
 * Coach-only control (camp-context technique rows): attach one of this camp's
 * footage videos to the technique as camp-only reference footage or promote it
 * globally. The backend only accepts this camp's own footage as the source, so
 * the picker lists exactly `useCampVideos(campId)`.
 */
import { useEffect, useState } from "react";
import { Loader2, VideoIcon } from "lucide-react";
import { toast } from "sonner";
import { useCampVideos } from "@/lib/queries";
import { useAddCampTechniqueVideo } from "@/lib/mutations";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

type Scope = "camp_only" | "global";

interface AddCampFootageDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  campId: number;
  techniqueId: number;
  techniqueName: string;
}

export function AddCampFootageDialog({
  open,
  onOpenChange,
  campId,
  techniqueId,
  techniqueName,
}: AddCampFootageDialogProps) {
  const videosQuery = useCampVideos(campId);
  const videos = videosQuery.data ?? null;
  const addVideo = useAddCampTechniqueVideo(campId);

  const [selectedVideoId, setSelectedVideoId] = useState<number | null>(null);
  const [scope, setScope] = useState<Scope>("camp_only");

  // Reset selection whenever the dialog reopens so a stale pick from a prior
  // open doesn't carry over.
  useEffect(() => {
    if (open) {
      setSelectedVideoId(null);
      setScope("camp_only");
    }
  }, [open]);

  async function handleConfirm() {
    if (selectedVideoId == null) return;
    try {
      await addVideo.mutateAsync({
        techniqueId,
        videoId: selectedVideoId,
        scope,
      });
      toast.success(
        scope === "global"
          ? "Footage added to the technique everywhere."
          : "Footage added to this camp's technique.",
      );
      onOpenChange(false);
    } catch (err) {
      // 404 means the chosen video isn't valid camp footage for this camp.
      if (err instanceof Response && err.status === 404) {
        toast.error(
          "That video isn't footage from this camp, so it can't be attached.",
        );
      } else {
        toast.error("Couldn't add the footage. Please try again.");
      }
    }
  }

  const isPending = addVideo.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex max-h-[85vh] flex-col gap-4 sm:max-h-[80vh]"
      >
        <DialogHeader>
          <DialogTitle>Add footage to technique</DialogTitle>
          <DialogDescription>
            Attach one of this camp's videos to {techniqueName}.
          </DialogDescription>
        </DialogHeader>

        {/* Footage picker */}
        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto">
          <p className="text-sm font-medium">Choose footage</p>
          {videosQuery.error ? (
            <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
              Could not load this camp's footage.{" "}
              <button
                type="button"
                className="ml-1 underline-offset-2 hover:underline"
                onClick={() => videosQuery.refetch()}
              >
                Try again
              </button>
            </div>
          ) : videos === null ? (
            <ul className="space-y-2">
              <li className="h-12 animate-pulse rounded-md bg-muted/40" />
              <li className="h-12 animate-pulse rounded-md bg-muted/40" />
            </ul>
          ) : videos.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No footage in this camp yet. Upload footage to this camp first,
              then come back to attach it.
            </p>
          ) : (
            <ul
              role="radiogroup"
              aria-label="Camp footage"
              className="space-y-2"
            >
              {videos.map((video) => {
                const isSelected = selectedVideoId === video.id;
                return (
                  <li key={video.id}>
                    <button
                      type="button"
                      role="radio"
                      aria-checked={isSelected}
                      onClick={() => setSelectedVideoId(video.id)}
                      className={cn(
                        "flex w-full items-center gap-3 rounded-lg border p-2 text-left transition-colors",
                        isSelected
                          ? "border-primary bg-primary/5 ring-1 ring-primary"
                          : "border-border bg-card hover:bg-muted/40",
                      )}
                    >
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                        <VideoIcon className="h-5 w-5" aria-hidden />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">
                          {video.title}
                        </span>
                        {video.processing_status !== "ready" && (
                          <span className="block text-xs text-muted-foreground">
                            {video.processing_status === "processing"
                              ? "Processing..."
                              : "Not ready"}
                          </span>
                        )}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Scope choice */}
        <div className="space-y-2">
          <p className="text-sm font-medium">Where should this footage appear?</p>
          <div
            role="radiogroup"
            aria-label="Footage scope"
            className="grid grid-cols-1 gap-2 sm:grid-cols-2"
          >
            <ScopeOption
              value="camp_only"
              selected={scope === "camp_only"}
              onSelect={setScope}
              label="Camp only"
              description="Visible only in this camp."
            />
            <ScopeOption
              value="global"
              selected={scope === "global"}
              onSelect={setScope}
              label="Global"
              description="Added to the technique everywhere."
            />
          </div>
        </div>

        <DialogFooter className="grid grid-cols-2 gap-2 sm:flex-none sm:justify-stretch">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isPending}
            className="w-full"
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={handleConfirm}
            disabled={isPending || selectedVideoId == null}
            className="w-full"
          >
            {isPending ? (
              <>
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden />
                Adding...
              </>
            ) : (
              "Add footage"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ScopeOption({
  value,
  selected,
  onSelect,
  label,
  description,
}: {
  value: Scope;
  selected: boolean;
  onSelect: (v: Scope) => void;
  label: string;
  description: string;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={() => onSelect(value)}
      className={cn(
        "w-full rounded-lg border p-3 text-left transition-colors",
        selected
          ? "border-primary bg-primary/5 ring-1 ring-primary"
          : "border-border bg-card hover:bg-muted/40",
      )}
    >
      <p className="text-sm font-medium leading-tight">{label}</p>
      <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
    </button>
  );
}
