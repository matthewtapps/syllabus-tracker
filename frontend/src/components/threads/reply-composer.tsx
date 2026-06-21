import { useEffect, useRef, useState } from "react";
import { SendHorizontal, Video as VideoIcon, X, Loader2, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useUser } from "@/lib/current-user-context";
import { isCoachOrAdmin } from "@/lib/api";
import {
  deleteVideo,
  getVideoStatus,
  linkDraftReplyVideo,
  uploadDraftReplyVideo,
} from "@/lib/api";
import type { BrowseVideo } from "@/lib/api";
import { SillybusVideoNavigator } from "@/components/videos/sillybus-video-navigator";

export interface VideoAttachment {
  videoId: number;
  isReference: boolean;
  title: string | null;
}

interface ReplyComposerProps {
  anchorKind: string;
  /** Camp scope for camp_technique surfaces. */
  campId?: number;
  /** The camp's own id when the surface is a whole-camp thread. */
  anchorId?: number;
  /** Whether a submit is currently in flight. */
  pending: boolean;
  placeholder?: string;
  /**
   * When true (thread-starter surfaces), a reference video with no title
   * blocks send until the user fills in a title.
   */
  requireVideoTitle?: boolean;
  /**
   * Student id scoping the Sillybus navigator. When absent, the
   * "Choose from Sillybus" source is hidden.
   */
  scopeStudentId?: number;
  /** Posts the reply/thread with an optional video attachment. */
  onSubmit: (body: string, attachment: VideoAttachment | null) => Promise<void>;
}

type Draft =
  | { state: "uploading" }
  | { state: "processing"; videoId: number; isReference: false }
  | { state: "ready"; videoId: number; isReference: false }
  | { state: "ready"; videoId: number; isReference: true; title: string | null }
  | { state: "failed"; videoId: number | null };

type PickerSheet = "source" | "link" | "sillybus" | null;

/**
 * Universal thread composer: a pill input with an attach-video button parked
 * inline, plus a send button. Attaching opens a bottom sheet to pick from four
 * sources; the clip uploads in the background and shows a removable preview
 * while you keep typing. Send posts the text and the (possibly still-processing)
 * video as one unit. Attaching is offered only where the viewer may add a video
 * (coaches anywhere; a student only on their own camp surface).
 */
export function ReplyComposer({
  anchorKind,
  campId,
  anchorId,
  pending,
  placeholder = "Reply…",
  requireVideoTitle = false,
  scopeStudentId,
  onSubmit,
}: ReplyComposerProps) {
  const user = useUser();
  const canAttach =
    isCoachOrAdmin(user) || anchorKind === "camp" || anchorKind === "camp_technique";
  const effCampId =
    anchorKind === "camp" ? (anchorId ?? null) : anchorKind === "camp_technique" ? (campId ?? null) : null;

  const [body, setBody] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [pickerSheet, setPickerSheet] = useState<PickerSheet>(null);
  const [url, setUrl] = useState("");
  const [refTitle, setRefTitle] = useState("");
  // Text + video id of the most recent send whose video was still processing,
  // so a later processing failure can restore the text for a retry.
  const [sentPending, setSentPending] = useState<{ body: string; videoId: number } | null>(null);

  // file input refs — one for camera capture, one for device pick
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const deviceInputRef = useRef<HTMLInputElement>(null);

  // Poll a processing draft (pre-send) until it is playable or fails.
  useEffect(() => {
    if (draft?.state !== "processing") return;
    const id = draft.videoId;
    let alive = true;
    const timer = setInterval(async () => {
      try {
        const { processing_status } = await getVideoStatus(id);
        if (!alive) return;
        if (processing_status === "ready")
          setDraft({ state: "ready", videoId: id, isReference: false });
        else if (processing_status === "failed") setDraft({ state: "failed", videoId: id });
      } catch {
        /* transient; keep polling */
      }
    }, 1500);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [draft]);

  // After sending a still-processing video, watch it: if it fails the server
  // cancels the comment, so restore the text so the author can retry.
  useEffect(() => {
    if (!sentPending) return;
    const sent = sentPending;
    let alive = true;
    const timer = setInterval(async () => {
      try {
        const { processing_status } = await getVideoStatus(sent.videoId);
        if (!alive) return;
        if (processing_status === "failed") {
          setSentPending(null);
          setBody((cur) => (cur ? cur : sent.body));
          toast.error("Video failed to process; your reply was not posted.");
        } else if (processing_status === "ready") {
          setSentPending(null);
        }
      } catch {
        /* keep polling */
      }
    }, 2000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [sentPending]);

  async function pickFile(file: File) {
    setPickerSheet(null);
    setDraft({ state: "uploading" });
    try {
      const { video_id, processing_status } = await uploadDraftReplyVideo(
        anchorKind,
        effCampId,
        file,
      );
      setDraft(
        processing_status === "ready"
          ? { state: "ready", videoId: video_id, isReference: false }
          : { state: "processing", videoId: video_id, isReference: false },
      );
    } catch {
      setDraft({ state: "failed", videoId: null });
      toast.error("Couldn't upload that video. Please try again.");
    }
  }

  async function pasteLink() {
    const u = url.trim();
    if (!u) return;
    setPickerSheet(null);
    setUrl("");
    setDraft({ state: "uploading" });
    try {
      const video = await linkDraftReplyVideo(anchorKind, effCampId, u);
      setDraft({ state: "ready", videoId: video.id, isReference: false });
    } catch {
      setDraft({ state: "failed", videoId: null });
      toast.error("Couldn't attach that link. Please check the URL.");
    }
  }

  function pickSillybusVideo(video: BrowseVideo) {
    setRefTitle(video.title ?? "");
    setDraft({
      state: "ready",
      videoId: video.id,
      isReference: true,
      title: video.title ?? null,
    });
  }

  function removeDraft() {
    if (draft && "videoId" in draft && draft.videoId != null && !isReferenceDraft(draft)) {
      void deleteVideo(draft.videoId).catch(() => {});
    }
    setDraft(null);
    setRefTitle("");
  }

  function isReferenceDraft(d: Draft): boolean {
    return d.state === "ready" && d.isReference === true;
  }

  const draftVideoId =
    draft && (draft.state === "processing" || draft.state === "ready") ? draft.videoId : null;

  // A title is required when: thread-starter + reference draft + title not yet provided
  const needsTitle =
    requireVideoTitle &&
    draft?.state === "ready" &&
    isReferenceDraft(draft) &&
    !refTitle.trim();

  const canSend =
    !pending &&
    !needsTitle &&
    draft?.state !== "uploading" &&
    draft?.state !== "failed" &&
    (body.trim().length > 0 || draftVideoId != null);

  async function send() {
    if (!canSend) return;
    const text = body;
    const stillProcessing = draft?.state === "processing" ? draft.videoId : null;

    let attachment: VideoAttachment | null = null;
    if (draftVideoId != null) {
      if (draft?.state === "ready" && isReferenceDraft(draft)) {
        attachment = {
          videoId: draftVideoId,
          isReference: true,
          title: refTitle.trim() || null,
        };
      } else {
        attachment = { videoId: draftVideoId, isReference: false, title: null };
      }
    }

    try {
      await onSubmit(text, attachment);
      setBody("");
      setDraft(null);
      setRefTitle("");
      setSentPending(stillProcessing != null ? { body: text, videoId: stillProcessing } : null);
    } catch {
      toast.error("Failed to post reply. Please try again.");
    }
  }

  return (
    <>
      {draft && (
        <DraftPreview
          draft={draft}
          refTitle={refTitle}
          onRemove={removeDraft}
          requireVideoTitle={requireVideoTitle}
          onTitleChange={setRefTitle}
        />
      )}
      <div className="flex items-end gap-2">
        <div className="relative flex-1">
          <Textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            placeholder={placeholder}
            rows={1}
            disabled={pending}
            className="max-h-40 min-h-9 resize-none rounded-2xl pr-11"
          />
          {canAttach && !draft && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => setPickerSheet("source")}
              aria-label="Attach video"
              className="absolute right-1 top-1/2 h-7 w-7 -translate-y-1/2 rounded-full text-muted-foreground hover:text-foreground"
            >
              <VideoIcon className="h-4 w-4" aria-hidden />
            </Button>
          )}
        </div>
        <Button
          type="button"
          size="icon"
          onClick={send}
          disabled={!canSend}
          aria-label="Reply"
          className="shrink-0 rounded-full"
        >
          <SendHorizontal className="h-4 w-4" aria-hidden />
        </Button>
      </div>

      {/* Hidden file inputs */}
      <input
        ref={cameraInputRef}
        type="file"
        accept="video/*"
        capture="environment"
        className="sr-only"
        aria-hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void pickFile(f);
          // Reset so the same file can be re-selected
          e.target.value = "";
        }}
      />
      <input
        ref={deviceInputRef}
        type="file"
        accept="video/mp4"
        className="sr-only"
        aria-hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void pickFile(f);
          e.target.value = "";
        }}
      />

      {/* Source picker sheet */}
      <Sheet open={pickerSheet === "source"} onOpenChange={(o) => { if (!o) setPickerSheet(null); }}>
        <SheetContent
          side="bottom"
          className="gap-4 rounded-t-xl pb-[env(safe-area-inset-bottom)]"
        >
          <SheetHeader className="text-left">
            <SheetTitle>Add a video</SheetTitle>
            <SheetDescription>Choose how to attach a video.</SheetDescription>
          </SheetHeader>
          <ul className="divide-y divide-border px-4 pb-6" role="list">
            <li>
              <button
                type="button"
                className="flex w-full items-center gap-3 py-3 text-sm hover:text-foreground"
                onClick={() => {
                  setPickerSheet(null);
                  // Defer to allow sheet close animation
                  setTimeout(() => cameraInputRef.current?.click(), 50);
                }}
              >
                Record now
              </button>
            </li>
            <li>
              <button
                type="button"
                className="flex w-full items-center gap-3 py-3 text-sm hover:text-foreground"
                onClick={() => {
                  setPickerSheet(null);
                  setTimeout(() => deviceInputRef.current?.click(), 50);
                }}
              >
                Choose from device
              </button>
            </li>
            <li>
              <button
                type="button"
                className="flex w-full items-center gap-3 py-3 text-sm hover:text-foreground"
                onClick={() => setPickerSheet("link")}
              >
                Paste a link
              </button>
            </li>
            {scopeStudentId != null && (
              <li>
                <button
                  type="button"
                  className="flex w-full items-center gap-3 py-3 text-sm hover:text-foreground"
                  onClick={() => setPickerSheet("sillybus")}
                >
                  Choose from Sillybus
                </button>
              </li>
            )}
          </ul>
        </SheetContent>
      </Sheet>

      {/* Paste link sheet */}
      <Sheet open={pickerSheet === "link"} onOpenChange={(o) => { if (!o) setPickerSheet(null); }}>
        <SheetContent
          side="bottom"
          className="gap-4 rounded-t-xl pb-[env(safe-area-inset-bottom)]"
        >
          <SheetHeader className="text-left">
            <SheetTitle>Paste a link</SheetTitle>
            <SheetDescription>Enter a YouTube, Vimeo, or Drive URL.</SheetDescription>
          </SheetHeader>
          <div className="space-y-3 px-4 pb-6">
            <Input
              placeholder="YouTube / Vimeo / Drive URL"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
            <Button type="button" className="w-full" onClick={pasteLink} disabled={!url.trim()}>
              Attach link
            </Button>
          </div>
        </SheetContent>
      </Sheet>

      {/* Sillybus navigator */}
      {scopeStudentId != null && (
        <SillybusVideoNavigator
          studentId={scopeStudentId}
          open={pickerSheet === "sillybus"}
          onOpenChange={(o) => { if (!o) setPickerSheet(null); }}
          onPick={pickSillybusVideo}
        />
      )}
    </>
  );
}

function DraftPreview({
  draft,
  refTitle,
  onRemove,
  requireVideoTitle,
  onTitleChange,
}: {
  draft: Draft;
  refTitle: string;
  onRemove: () => void;
  requireVideoTitle: boolean;
  onTitleChange: (t: string) => void;
}) {
  const isRef = draft.state === "ready" && draft.isReference;
  const label =
    draft.state === "uploading"
      ? "Uploading video…"
      : draft.state === "processing"
        ? "Processing video…"
        : draft.state === "ready"
          ? isRef
            ? "Reference video attached"
            : "Video attached"
          : "Video failed to upload";
  const failed = draft.state === "failed";

  // Show the title input whenever we have a ready reference draft and the
  // surface requires a title — regardless of whether refTitle is filled yet.
  // (Gating on emptiness caused the input to unmount mid-typing.)
  const showTitleInput = requireVideoTitle && isRef;

  return (
    <div
      className={`mb-2 rounded-lg border px-3 py-2 text-sm ${
        failed ? "border-destructive/40 text-destructive" : "border-border text-muted-foreground"
      }`}
    >
      <div className="flex items-center gap-2">
        {draft.state === "uploading" || draft.state === "processing" ? (
          <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden />
        ) : failed ? (
          <TriangleAlert className="h-4 w-4 shrink-0" aria-hidden />
        ) : (
          <VideoIcon className="h-4 w-4 shrink-0" aria-hidden />
        )}
        <span className="flex-1">{label}</span>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={onRemove}
          aria-label="Remove video"
          className="h-6 w-6 rounded-full"
        >
          <X className="h-4 w-4" aria-hidden />
        </Button>
      </div>
      {showTitleInput && (
        <Input
          className="mt-2"
          placeholder="Title for this video (required)"
          value={refTitle}
          onChange={(e) => onTitleChange(e.target.value)}
          aria-label="Video title"
        />
      )}
    </div>
  );
}
