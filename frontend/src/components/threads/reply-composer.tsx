import { useEffect, useRef, useState, type ReactNode } from "react";
import { SendHorizontal, Video as VideoIcon, X, Loader2, TriangleAlert, Clock } from "lucide-react";
import { formatTimestamp } from "@/lib/dates";
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
import { posterFromFile, rememberPoster } from "@/components/videos/poster-frame";

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
  /**
   * When provided, enables a "stamp current time" button in the composer.
   * Used on video-post reply composers so the user can pin their reply to a
   * moment in the video.
   */
  stampable?: { currentTime: number; canStamp: boolean };
  /** Extra attach buttons for the icon bar, sitting beside the video button. */
  extraActions?: ReactNode;
  /** Posts the reply/thread with an optional video attachment and optional timestamp. */
  onSubmit: (body: string, attachment: VideoAttachment | null, videoTsSeconds: number | null) => Promise<void>;
}

type Draft =
  | { state: "uploading" }
  | { state: "processing"; videoId: number; isReference: false }
  | { state: "ready"; videoId: number; isReference: false }
  | { state: "ready"; videoId: number; isReference: true; title: string | null }
  | { state: "failed"; videoId: number | null };

type PickerSheet = "source" | "link" | "sillybus" | null;

/**
 * Universal thread composer: one bordered box holding the attachments, the text
 * area and an icon bar of everything you can attach, so what you are about to
 * post and the send button read as a single unit. Attaching a video opens a
 * bottom sheet to pick from four sources; the clip uploads in the background and
 * shows a removable thumbnail while you keep typing. Send posts the text and the
 * (possibly still-processing) video as one unit. Attaching is offered only where
 * the viewer may add a video (coaches anywhere; a student only on their own camp
 * surface).
 */
export function ReplyComposer({
  anchorKind,
  campId,
  anchorId,
  pending,
  placeholder = "Reply…",
  requireVideoTitle = false,
  scopeStudentId,
  stampable,
  extraActions,
  onSubmit,
}: ReplyComposerProps) {
  const user = useUser();
  const canAttach =
    isCoachOrAdmin(user) || anchorKind === "camp" || anchorKind === "camp_technique";
  const effCampId =
    anchorKind === "camp" ? (anchorId ?? null) : anchorKind === "camp_technique" ? (campId ?? null) : null;

  const [body, setBody] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [poster, setPoster] = useState<string | null>(null);
  const [pickerSheet, setPickerSheet] = useState<PickerSheet>(null);
  const [url, setUrl] = useState("");
  const [refTitle, setRefTitle] = useState("");
  // Text + video id of the most recent send whose video was still processing,
  // so a later processing failure can restore the text for a retry.
  const [sentPending, setSentPending] = useState<{ body: string; videoId: number } | null>(null);
  // Stamped timestamp for video-post replies; null = whole-video reply.
  const [stampedTs, setStampedTs] = useState<number | null>(null);

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

  /** Drops focus before a bottom sheet opens: an on-screen keyboard left up by
   *  the composer sits over the sheet. */
  function openPicker(sheet: PickerSheet) {
    (document.activeElement as HTMLElement | null)?.blur();
    setPickerSheet(sheet);
  }

  async function pickFile(file: File) {
    setPickerSheet(null);
    setDraft({ state: "uploading" });
    const posterPromise = posterFromFile(file);
    void posterPromise.then(setPoster);
    try {
      const { video_id, processing_status } = await uploadDraftReplyVideo(
        anchorKind,
        effCampId,
        file,
      );
      // Hand the still to the video it became, so the posted card can keep
      // showing it while the clip processes.
      void posterPromise.then((p) => {
        if (p) rememberPoster(video_id, p);
      });
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
    setPoster(null);
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
    setPoster(null);
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
    setPoster(null);
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
        attachment = {
          videoId: draftVideoId,
          isReference: false,
          title: refTitle.trim() || null,
        };
      }
    }

    try {
      await onSubmit(text, attachment, stampedTs);
      setBody("");
      setDraft(null);
      setPoster(null);
      setRefTitle("");
      setStampedTs(null);
      setSentPending(stillProcessing != null ? { body: text, videoId: stillProcessing } : null);
    } catch {
      toast.error("Failed to post reply. Please try again.");
    }
  }

  return (
    <>
      <div className="rounded-2xl border border-input bg-transparent px-2 py-1.5 shadow-xs transition-[color,box-shadow] focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50 dark:bg-input/30">
        {(draft || (stampable && stampedTs != null)) && (
          <div className="flex flex-wrap items-center gap-2 px-1 pb-1 pt-0.5">
            {draft && (
              <DraftChip draft={draft} poster={poster} onRemove={removeDraft} />
            )}
            {stampable && stampedTs != null && (
              <div className="flex h-8 items-center gap-1 rounded-full bg-primary/10 pl-2.5 pr-1 text-xs font-medium text-primary">
                <Clock className="h-3.5 w-3.5 shrink-0" aria-hidden />
                <span>Replying at {formatTimestamp(stampedTs)}</span>
                <button
                  type="button"
                  onClick={() => setStampedTs(null)}
                  aria-label="Clear timestamp"
                  className="flex h-6 w-6 items-center justify-center rounded-full hover:bg-primary/15"
                >
                  <X className="h-3.5 w-3.5" aria-hidden />
                </button>
              </div>
            )}
            {draft && draft.state !== "failed" && (
              <Input
                className="h-8 w-full"
                placeholder={needsTitle ? "Name this video (required)" : "Name this video (optional)"}
                value={refTitle}
                onChange={(e) => setRefTitle(e.target.value)}
                aria-label="Video title"
              />
            )}
          </div>
        )}

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
          className="max-h-40 min-h-8 resize-none border-0 bg-transparent px-1 py-1.5 shadow-none focus-visible:border-0 focus-visible:ring-0 dark:bg-transparent"
        />

        <div className="flex items-center gap-0.5">
          {canAttach && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              disabled={draft != null}
              onClick={() => openPicker("source")}
              aria-label="Attach video"
              className="h-8 w-8 rounded-full text-muted-foreground hover:text-foreground"
            >
              <VideoIcon className="h-[18px] w-[18px]" aria-hidden />
            </Button>
          )}
          {extraActions}
          {stampable && stampedTs == null && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              disabled={!stampable.canStamp}
              onClick={() => setStampedTs(Math.max(0, Math.floor(stampable.currentTime)))}
              aria-label="Pin reply to current time"
              title={stampable.canStamp ? `Stamp at ${formatTimestamp(stampable.currentTime)}` : "Play the video to stamp a time"}
              className="h-8 w-8 rounded-full text-muted-foreground hover:text-foreground"
            >
              <Clock className="h-[18px] w-[18px]" aria-hidden />
            </Button>
          )}
          <span className="flex-1" />
          <Button
            type="button"
            size="icon"
            onClick={send}
            disabled={!canSend}
            aria-label="Reply"
            className="h-8 w-8 shrink-0 rounded-full"
          >
            <SendHorizontal className="h-4 w-4" aria-hidden />
          </Button>
        </div>
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
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <SheetHeader className="text-left">
            <SheetTitle>Add a video</SheetTitle>
            <SheetDescription className="sr-only">
              Pick where the video comes from.
            </SheetDescription>
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
                  onClick={() => {
                    // Close the source sheet first, then open the navigator, so
                    // the two bottom sheets never overlap as stacked modals.
                    setPickerSheet(null);
                    setTimeout(() => setPickerSheet("sillybus"), 80);
                  }}
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

/** The attached clip as a thumbnail tile that lives inside the composer box, so
 *  a video reads as part of the post being written rather than a done action. */
function DraftChip({
  draft,
  poster,
  onRemove,
}: {
  draft: Draft;
  poster: string | null;
  onRemove: () => void;
}) {
  const isRef = draft.state === "ready" && draft.isReference;
  const busy = draft.state === "uploading" || draft.state === "processing";
  const failed = draft.state === "failed";
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

  return (
    <div className="flex items-center gap-2">
      <div
        className={`relative h-12 w-12 shrink-0 overflow-hidden rounded-md border ${
          failed ? "border-destructive/50 bg-destructive/10" : "border-border bg-muted"
        }`}
      >
        {poster && !failed && (
          <img src={poster} alt="" className="h-full w-full object-cover" />
        )}
        <div className="absolute inset-0 flex items-center justify-center">
          {busy ? (
            <Loader2 className="h-4 w-4 animate-spin text-foreground/70" aria-hidden />
          ) : failed ? (
            <TriangleAlert className="h-4 w-4 text-destructive" aria-hidden />
          ) : poster ? null : (
            <VideoIcon className="h-4 w-4 text-muted-foreground" aria-hidden />
          )}
        </div>
        <Button
          type="button"
          variant="secondary"
          size="icon"
          onClick={onRemove}
          aria-label="Remove video"
          className="absolute right-0 top-0 h-5 w-5 rounded-bl-md rounded-br-none rounded-tl-none rounded-tr-md border-l border-b border-border/60 shadow-none"
        >
          <X className="h-3 w-3" aria-hidden />
        </Button>
      </div>
      {failed ? (
        <span className="text-xs text-destructive">{label}</span>
      ) : (
        <span className="sr-only">{label}</span>
      )}
    </div>
  );
}
