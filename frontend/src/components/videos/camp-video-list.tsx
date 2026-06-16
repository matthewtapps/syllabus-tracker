/**
 * Flat video list for camp-owned videos. Reuses VideoRow for individual
 * rows and VideoPlayerDialog for playback. No reordering (flat list).
 * Coach visibility controls are not surfaced here (CC-015 deferred).
 *
 * Coupling note: VideoRow requires a `techniqueId` prop used only for
 * cache-key invalidation in the rename dialog. We pass 0 here as a
 * sentinel; after rename the `campVideos` cache is not immediately
 * invalidated (the list auto-refetches on next focus). This is a minor
 * UX gap tracked with CC-015.
 */
import { useState } from "react";
import { PlusIcon } from "lucide-react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { useCampVideos } from "@/lib/queries";
import { qk } from "@/lib/query-keys";
import type { Video } from "@/lib/api";
import { uploadCampVideo } from "@/lib/api";
import { VideoRow } from "./video-row";
import { VideoPlayerDialog } from "./video-player-dialog";
import { PrivacyAckBanner } from "./privacy-ack-banner";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Progress } from "@/components/ui/progress";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { handleApiFormError, useFormWithValidation } from "@/components/hooks/useFormErrors";
import { TracedForm } from "@/components/traced-form";
import { MAX_VIDEO_BYTES, MAX_VIDEO_DURATION_SECONDS, formatBytes } from "./limits";
import { FileVideoIcon, VideoIcon } from "lucide-react";
import { useRef } from "react";
import { useEffect } from "react";

interface CampVideoListProps {
  campId: number;
  /** Student who owns this camp. Used to scope thread visibility on playback. */
  studentId: number;
  canManage: boolean;
  /** When set, scroll this video into view once the list loads. */
  scrollToVideoId?: number | null;
  onVideoScrolled?: () => void;
}

export function CampVideoList({
  campId,
  studentId,
  canManage,
  scrollToVideoId,
  onVideoScrolled,
}: CampVideoListProps) {
  const qc = useQueryClient();
  const videosQuery = useCampVideos(campId);
  const videos = videosQuery.data ?? null;
  const [playing, setPlaying] = useState<Video | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  // Scroll to a specific video once the list loads.
  const didScrollRef = useRef<number | null>(null);
  useEffect(() => {
    if (scrollToVideoId == null) return;
    if (didScrollRef.current === scrollToVideoId) return;
    if (!videos) return;
    if (!videos.some((v) => v.id === scrollToVideoId)) return;
    didScrollRef.current = scrollToVideoId;
    requestAnimationFrame(() => {
      const el = document.getElementById(`video-row-${scrollToVideoId}`);
      el?.scrollIntoView({ behavior: "smooth", block: "center" });
      onVideoScrolled?.();
    });
  }, [scrollToVideoId, videos, onVideoScrolled]);

  function handleDeleted(videoId: number) {
    qc.setQueryData(
      qk.campVideos(campId),
      (prev: Video[] | undefined) =>
        prev ? prev.filter((v) => v.id !== videoId) : prev,
    );
    setPlaying((current) => (current?.id === videoId ? null : current));
  }

  function handleUploaded() {
    setUploadOpen(false);
    setReloadKey((k) => k + 1);
    qc.invalidateQueries({ queryKey: qk.campVideos(campId) });
    toast.success("Upload received. Processing now...");
  }

  if (videosQuery.error) {
    return (
      <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
        Could not load videos.{" "}
        <button
          type="button"
          className="ml-1 underline-offset-2 hover:underline"
          onClick={() => videosQuery.refetch()}
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

  // Dummy techniqueId passed to VideoRow; only used for cache invalidation
  // in the rename dialog (no-op for camp videos, see module comment).
  const CAMP_VIDEO_TECHNIQUE_SENTINEL = 0;

  return (
    <div className="space-y-2">
      {canManage && (
        <div className="flex justify-end">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setUploadOpen(true)}
          >
            <PlusIcon className="mr-1.5 h-4 w-4" aria-hidden />
            Add video
          </Button>
        </div>
      )}

      <PrivacyAckBanner enabled={!canManage && playing !== null} />

      {videos.length === 0 ? (
        <p className="text-xs italic text-muted-foreground">
          {canManage
            ? "No videos yet. Add the first clip with the button above."
            : "No videos yet."}
        </p>
      ) : (
        <ul className="divide-y divide-white/15 overflow-hidden rounded-md border border-white/20 bg-card shadow-sm">
          {videos.map((video) => (
            <VideoRow
              key={video.id}
              video={video}
              techniqueId={CAMP_VIDEO_TECHNIQUE_SENTINEL}
              canManage={canManage}
              onPlay={() => setPlaying(video)}
              onDeleted={handleDeleted}
              campId={canManage ? campId : undefined}
            />
          ))}
        </ul>
      )}

      <VideoPlayerDialog
        video={playing}
        onClose={() => setPlaying(null)}
        surface={{ kind: "student", studentId }}
        context={{ label: "Camp video" }}
      />

      {canManage && (
        <CampUploadSheet
          campId={campId}
          open={uploadOpen}
          onOpenChange={setUploadOpen}
          onUploaded={handleUploaded}
          reloadKey={reloadKey}
        />
      )}
    </div>
  );
}

// ---- Upload sheet ----

const uploadSchema = z.object({
  title: z.string().min(1, "Title is required").max(120, "Title is too long"),
});
type UploadValues = z.infer<typeof uploadSchema>;

interface CampUploadSheetProps {
  campId: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUploaded: () => void;
  reloadKey: number;
}

function CampUploadSheet({
  campId,
  open,
  onOpenChange,
  onUploaded,
}: CampUploadSheetProps) {
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [progressPct, setProgressPct] = useState<number | null>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);

  const form = useFormWithValidation<UploadValues>({
    resolver: zodResolver(uploadSchema),
    defaultValues: { title: "" },
  });

  async function pickFile(picked: File | null) {
    setFileError(null);
    if (!picked) { setFile(null); return; }
    if (picked.type && picked.type !== "video/mp4") {
      setFileError("Only mp4 files are supported.");
      setFile(null);
      return;
    }
    if (picked.size > MAX_VIDEO_BYTES) {
      setFileError(`File is ${formatBytes(picked.size)}; max is ${formatBytes(MAX_VIDEO_BYTES)}.`);
      setFile(null);
      return;
    }
    setFile(picked);
  }

  async function handleSubmit(values: UploadValues) {
    if (!file) { setFileError("Pick an mp4 file to upload."); return; }
    setProgressPct(0);
    try {
      await uploadCampVideo(
        campId,
        file,
        { title: values.title.trim() },
        (loaded, total) => {
          if (total > 0) setProgressPct(Math.round((loaded / total) * 100));
        },
      );
      onUploaded();
    } catch (err) {
      setProgressPct(null);
      const handled = await handleApiFormError(err, form.setError, Object.keys(form.getValues()));
      if (!handled) toast.error(err instanceof Error ? err.message : "Failed to upload video");
    }
  }

  const isSubmitting = form.formState.isSubmitting;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-4 overflow-y-auto p-4 sm:max-w-md sm:p-6"
      >
        <SheetHeader className="space-y-1 p-0 text-left">
          <SheetTitle>Add camp video</SheetTitle>
          <SheetDescription>
            Upload an mp4 clip to this camp.
          </SheetDescription>
        </SheetHeader>

        <Form {...form}>
          <TracedForm
            id="camp_video_upload"
            onSubmit={form.handleSubmit(handleSubmit)}
            className="space-y-4"
          >
            <div className="space-y-2">
              <input
                ref={galleryRef}
                type="file"
                accept="video/mp4"
                className="sr-only"
                onChange={(e) => { pickFile(e.target.files?.[0] ?? null); e.target.value = ""; }}
                disabled={isSubmitting}
              />
              <input
                ref={cameraRef}
                type="file"
                accept="video/mp4"
                capture="environment"
                className="sr-only"
                onChange={(e) => { pickFile(e.target.files?.[0] ?? null); e.target.value = ""; }}
                disabled={isSubmitting}
              />
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  className="flex-1"
                  onClick={() => galleryRef.current?.click()}
                  disabled={isSubmitting}
                >
                  <FileVideoIcon className="mr-1.5 h-4 w-4" aria-hidden />
                  Choose video
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="flex-1"
                  onClick={() => cameraRef.current?.click()}
                  disabled={isSubmitting}
                >
                  <VideoIcon className="mr-1.5 h-4 w-4" aria-hidden />
                  Record video
                </Button>
              </div>
              {file ? (
                <p className="text-xs text-muted-foreground">
                  {file.name} · {formatBytes(file.size)}
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  mp4 only, up to {MAX_VIDEO_DURATION_SECONDS / 60} minutes and{" "}
                  {formatBytes(MAX_VIDEO_BYTES)}.
                </p>
              )}
              {fileError && (
                <p className="text-sm font-medium text-destructive">{fileError}</p>
              )}
            </div>

            <FormField
              control={form.control}
              name="title"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Title</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder="e.g. Match footage round 1" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {progressPct !== null && (
              <div className="space-y-1">
                <Progress value={progressPct} />
                <p className="text-xs text-muted-foreground">Uploading... {progressPct}%</p>
              </div>
            )}

            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                onClick={() => onOpenChange(false)}
                disabled={isSubmitting}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={isSubmitting || !file}>
                {isSubmitting ? "Uploading..." : "Upload video"}
              </Button>
            </div>
          </TracedForm>
        </Form>
      </SheetContent>
    </Sheet>
  );
}
