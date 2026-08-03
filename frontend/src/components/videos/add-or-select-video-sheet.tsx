import { useEffect, useRef, useState } from "react";
import type { BrowseVideo, VideoKind } from "@/lib/api";
import { isCoachOrAdmin } from "@/lib/api";
import { useUser } from "@/lib/current-user-context";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { TracedForm } from "@/components/traced-form";
import { SillybusVideoNavigator } from "./sillybus-video-navigator";
import {
  MAX_VIDEO_BYTES,
  MAX_VIDEO_DURATION_SECONDS,
  formatBytes,
  validateVideoFile,
} from "./limits";

/** Where a video is coming from. The sheet picks one; committing it is the
 *  caller's job, because a camp composer uploads in the background while a
 *  technique surface waits on the upload with the sheet still open. */
export type VideoSource =
  | { kind: "file"; file: File }
  | { kind: "link"; url: string }
  | { kind: "existing"; video: BrowseVideo };

export interface VideoDetails {
  title: string | null;
  /** False only when the scope switch is shown and turned off (T3). */
  alsoGlobal: boolean;
}

type Step = "source" | "link" | "sillybus" | "confirm" | null;

interface AddOrSelectVideoSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Scopes "Choose from Sillybus" to one student. Absent browses everything,
   *  which only a coach may do, so the source is hidden from anyone else. */
  browseStudentId?: number;
  /** "off" reports the source as soon as it is picked, with no confirm step. */
  titleMode?: "required" | "optional" | "off";
  /** Offers "also add to global technique library" on the confirm step. */
  showScopeSwitch?: boolean;
  /** Upload progress to show while onConfirm is in flight. */
  progressPct?: number | null;
  onConfirm: (source: VideoSource, details: VideoDetails) => Promise<void>;
}

/**
 * The one way to put a video anywhere: record it, pick it off the device, paste
 * a link, or select one already in Sillybus. A surface that collects the title
 * elsewhere sets titleMode "off" and is handed the source with no confirm step.
 */
export function AddOrSelectVideoSheet({
  open,
  onOpenChange,
  browseStudentId,
  titleMode = "off",
  showScopeSwitch = false,
  progressPct = null,
  onConfirm,
}: AddOrSelectVideoSheetProps) {
  const viewer = useUser();
  const [step, setStep] = useState<Step>(null);
  const [picked, setPicked] = useState<VideoSource | null>(null);
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [alsoGlobal, setAlsoGlobal] = useState(true);
  const [fileError, setFileError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const cameraInputRef = useRef<HTMLInputElement>(null);
  const deviceInputRef = useRef<HTMLInputElement>(null);
  // The navigator closes itself on pick; that must not close the whole flow.
  const pickedFromNavigatorRef = useRef(false);

  const needsConfirm = titleMode !== "off" || showScopeSwitch;
  // Browsing with no student in context is a coach capability, so offering it
  // to anyone else would only produce a 403 at the other end.
  const canBrowse = browseStudentId != null || isCoachOrAdmin(viewer);

  useEffect(() => {
    if (open) {
      // A reopen the sheet asked for itself already set the step it wants.
      setStep((s) => s ?? "source");
      return;
    }
    setStep(null);
    setPicked(null);
    setUrl("");
    setTitle("");
    setAlsoGlobal(true);
    setFileError(null);
    pickedFromNavigatorRef.current = false;
  }, [open]);

  async function commit(source: VideoSource, details: VideoDetails) {
    setSubmitting(true);
    try {
      await onConfirm(source, details);
      setStep(null);
      onOpenChange(false);
    } catch {
      // The caller reports the failure; the step stays up so it can be retried.
    } finally {
      setSubmitting(false);
    }
  }

  /** `viaNavigator` lets the navigator finish closing before the confirm step
   *  opens: two bottom sheets alive at once and the newer one is dismissed out
   *  from under the pick. */
  function take(source: VideoSource, presetTitle: string, viaNavigator = false) {
    if (needsConfirm) {
      setPicked(source);
      setTitle(presetTitle);
      onOpenChange(true);
      if (viaNavigator) {
        setStep(null);
        setTimeout(() => setStep("confirm"), 80);
      } else {
        setStep("confirm");
      }
      return;
    }
    void commit(source, { title: presetTitle.trim() || null, alsoGlobal: true });
  }

  /** Drops focus and hides the sheet before the native file dialog opens: an
   *  on-screen keyboard or the sheet overlay otherwise sits over it. */
  function openFileDialog(ref: React.RefObject<HTMLInputElement | null>) {
    (document.activeElement as HTMLElement | null)?.blur();
    setStep(null);
    onOpenChange(false);
    setTimeout(() => ref.current?.click(), 50);
  }

  async function handleFile(file: File) {
    const error = await validateVideoFile(file);
    if (error) {
      setFileError(error);
      setStep("source");
      onOpenChange(true);
      return;
    }
    setFileError(null);
    take({ kind: "file", file }, "");
  }

  function submitLink() {
    const u = url.trim();
    if (!u) return;
    setUrl("");
    take({ kind: "link", url: u }, "");
  }

  const detected = detectHost(url);
  const titleRequired = titleMode === "required";
  // A clip already in the library exposes nothing new by being referenced
  // again; one that lives on a single student's surface does.
  const privateSource =
    picked?.kind === "existing" && picked.video.source !== "library"
      ? picked.video.source
      : null;
  const publishesPrivateClip = privateSource != null && alsoGlobal;
  const canSubmitConfirm =
    !submitting && picked != null && (!titleRequired || title.trim().length > 0);

  return (
    <>
      <input
        ref={cameraInputRef}
        type="file"
        accept="video/*"
        capture="environment"
        className="sr-only"
        aria-hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void handleFile(f);
          // Reset so the same file can be re-selected
          e.target.value = "";
        }}
      />
      <input
        ref={deviceInputRef}
        type="file"
        accept="video/*"
        className="sr-only"
        aria-hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void handleFile(f);
          e.target.value = "";
        }}
      />

      <Sheet
        open={open && step === "source"}
        onOpenChange={(o) => {
          if (!o) onOpenChange(false);
        }}
      >
        <SheetContent
          side="bottom"
          className="gap-4 rounded-t-xl pb-[env(safe-area-inset-bottom)]"
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <SheetHeader className="text-left">
            <SheetTitle>Add a video</SheetTitle>
            <SheetDescription className="sr-only">
              Pick where the video comes from.
            </SheetDescription>
          </SheetHeader>
          {fileError && (
            <p className="px-4 text-sm font-medium text-destructive">{fileError}</p>
          )}
          <ul className="divide-y divide-border px-4 pb-6" role="list">
            <li>
              <button
                type="button"
                className="flex w-full items-center gap-3 py-3 text-sm hover:text-foreground"
                onClick={() => openFileDialog(cameraInputRef)}
              >
                Record now
              </button>
            </li>
            <li>
              <button
                type="button"
                className="flex w-full items-center gap-3 py-3 text-sm hover:text-foreground"
                onClick={() => openFileDialog(deviceInputRef)}
              >
                Choose from device
              </button>
            </li>
            <li>
              <button
                type="button"
                className="flex w-full items-center gap-3 py-3 text-sm hover:text-foreground"
                onClick={() => setStep("link")}
              >
                Paste a link
              </button>
            </li>
            {canBrowse && (
              <li>
                <button
                  type="button"
                  className="flex w-full items-center gap-3 py-3 text-sm hover:text-foreground"
                  onClick={() => {
                    // Close this sheet first, then open the navigator, so the
                    // two bottom sheets never overlap as stacked modals.
                    setStep(null);
                    setTimeout(() => setStep("sillybus"), 80);
                  }}
                >
                  Choose from Sillybus
                </button>
              </li>
            )}
          </ul>
        </SheetContent>
      </Sheet>

      <Sheet
        open={open && step === "link"}
        onOpenChange={(o) => {
          if (!o) onOpenChange(false);
        }}
      >
        <SheetContent
          side="bottom"
          className="gap-4 rounded-t-xl pb-[env(safe-area-inset-bottom)]"
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <SheetHeader className="text-left">
            <SheetTitle>Paste a link</SheetTitle>
            <SheetDescription className="sr-only">
              Enter a YouTube, Vimeo, or Drive URL.
            </SheetDescription>
          </SheetHeader>
          <div className="space-y-3 px-4 pb-6">
            <Input
              placeholder="YouTube / Vimeo / Drive URL"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
            {detected && (
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                Detected as
                <Badge variant="secondary" className="text-xs uppercase">
                  {detected}
                </Badge>
                {detected === "drive" && (
                  <span>Share permission must be &quot;anyone with the link&quot;.</span>
                )}
              </p>
            )}
            <Button
              type="button"
              className="w-full"
              onClick={submitLink}
              disabled={!url.trim() || submitting}
            >
              Attach link
            </Button>
          </div>
        </SheetContent>
      </Sheet>

      {canBrowse && (
        <SillybusVideoNavigator
          studentId={browseStudentId}
          canBrowseOtherStudents={isCoachOrAdmin(viewer)}
          open={open && step === "sillybus"}
          onOpenChange={(o) => {
            // Closing the navigator to move on to the confirm step is not a
            // dismissal of the flow, and it gets signalled more than once.
            if (o || pickedFromNavigatorRef.current) return;
            onOpenChange(false);
          }}
          onPick={(video) => {
            pickedFromNavigatorRef.current = true;
            take({ kind: "existing", video }, video.title ?? "", true);
          }}
        />
      )}

      <Sheet
        open={open && step === "confirm"}
        onOpenChange={(o) => {
          if (!o && !submitting) onOpenChange(false);
        }}
      >
        <SheetContent
          side="bottom"
          className="gap-4 rounded-t-xl pb-[env(safe-area-inset-bottom)]"
        >
          <SheetHeader className="text-left">
            <SheetTitle>Add video</SheetTitle>
            <SheetDescription>{picked ? sourceSummary(picked) : ""}</SheetDescription>
          </SheetHeader>
          <TracedForm
            id="video_add"
            className="space-y-4 px-4 pb-6"
            onSubmit={(e) => {
              e.preventDefault();
              if (!picked || !canSubmitConfirm) return;
              return commit(picked, { title: title.trim() || null, alsoGlobal });
            }}
          >
            <div className="space-y-2">
              <Label htmlFor="add-video-title">Title</Label>
              <Input
                id="add-video-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={120}
                placeholder={
                  titleRequired ? "e.g. Demo from the seminar" : "Name this video (optional)"
                }
                disabled={submitting}
              />
              {picked?.kind === "file" && (
                <p className="text-xs text-muted-foreground">
                  Up to {MAX_VIDEO_DURATION_SECONDS / 60} minutes and{" "}
                  {formatBytes(MAX_VIDEO_BYTES)}.
                </p>
              )}
            </div>

            {showScopeSwitch && (
              <div className="flex items-start justify-between gap-3 rounded-md border p-3">
                <div className="space-y-0.5">
                  <Label htmlFor="add-video-also-global">
                    Also add to global technique library
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    Off keeps this video on this student&apos;s syllabus only.
                  </p>
                </div>
                <Switch
                  id="add-video-also-global"
                  checked={alsoGlobal}
                  onCheckedChange={setAlsoGlobal}
                  disabled={submitting}
                />
              </div>
            )}

            {publishesPrivateClip && (
              <p className="text-xs font-medium text-destructive">
                This clip is on one student&apos;s {privateSource}. Adding it to the
                global library shows it to every student.
              </p>
            )}

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
                onClick={() => {
                  pickedFromNavigatorRef.current = false;
                  setPicked(null);
                  setStep("source");
                }}
                disabled={submitting}
              >
                Back
              </Button>
              <Button type="submit" disabled={!canSubmitConfirm}>
                {submitting
                  ? "Saving..."
                  : publishesPrivateClip
                    ? "Publish to all students"
                    : "Add video"}
              </Button>
            </div>
          </TracedForm>
        </SheetContent>
      </Sheet>
    </>
  );
}

function sourceSummary(source: VideoSource): string {
  if (source.kind === "file") {
    return `${source.file.name} - ${formatBytes(source.file.size)}`;
  }
  if (source.kind === "link") return source.url;
  return source.video.display_title?.trim() || source.video.provenance;
}

function detectHost(url: string): VideoKind | null {
  if (!url) return null;
  const lower = url.toLowerCase();
  if (lower.includes("youtube.com") || lower.includes("youtu.be")) return "youtube";
  if (lower.includes("vimeo.com")) return "vimeo";
  if (lower.includes("drive.google.com")) return "drive";
  if (/^https?:\/\//.test(lower)) return "link";
  return null;
}
