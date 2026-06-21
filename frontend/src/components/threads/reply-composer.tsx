import { useEffect, useState } from "react";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useUser } from "@/lib/current-user-context";
import { isCoachOrAdmin } from "@/lib/api";
import {
  deleteVideo,
  getVideoStatus,
  linkDraftReplyVideo,
  uploadDraftReplyVideo,
} from "@/lib/api";

interface ReplyComposerProps {
  anchorKind: string;
  /** Camp scope for camp_technique surfaces. */
  campId?: number;
  /** The camp's own id when the surface is a whole-camp thread. */
  anchorId?: number;
  /** Whether a submit is currently in flight. */
  pending: boolean;
  placeholder?: string;
  /** Posts the reply. `videoId` is the attached draft video, if any. */
  onSubmit: (body: string, videoId: number | null) => Promise<void>;
}

type Draft =
  | { state: "uploading" }
  | { state: "processing"; videoId: number }
  | { state: "ready"; videoId: number }
  | { state: "failed"; videoId: number | null };

/**
 * Universal thread composer: a pill input with an attach-video button parked
 * inline, plus a send button. Attaching opens a bottom sheet to upload a clip or
 * paste a link; the clip uploads in the background and shows a removable preview
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
  onSubmit,
}: ReplyComposerProps) {
  const user = useUser();
  const canAttach =
    isCoachOrAdmin(user) || anchorKind === "camp" || anchorKind === "camp_technique";
  const effCampId =
    anchorKind === "camp" ? (anchorId ?? null) : anchorKind === "camp_technique" ? (campId ?? null) : null;

  const [body, setBody] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"upload" | "link">("upload");
  const [url, setUrl] = useState("");
  // Text + video id of the most recent send whose video was still processing,
  // so a later processing failure can restore the text for a retry.
  const [sentPending, setSentPending] = useState<{ body: string; videoId: number } | null>(null);

  // Poll a processing draft (pre-send) until it is playable or fails.
  useEffect(() => {
    if (draft?.state !== "processing") return;
    const id = draft.videoId;
    let alive = true;
    const timer = setInterval(async () => {
      try {
        const { processing_status } = await getVideoStatus(id);
        if (!alive) return;
        if (processing_status === "ready") setDraft({ state: "ready", videoId: id });
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
    setOpen(false);
    setDraft({ state: "uploading" });
    try {
      const { video_id, processing_status } = await uploadDraftReplyVideo(
        anchorKind,
        effCampId,
        file,
      );
      setDraft(
        processing_status === "ready"
          ? { state: "ready", videoId: video_id }
          : { state: "processing", videoId: video_id },
      );
    } catch {
      setDraft({ state: "failed", videoId: null });
      toast.error("Couldn't upload that video. Please try again.");
    }
  }

  async function pasteLink() {
    const u = url.trim();
    if (!u) return;
    setOpen(false);
    setUrl("");
    setDraft({ state: "uploading" });
    try {
      const video = await linkDraftReplyVideo(anchorKind, effCampId, u);
      setDraft({ state: "ready", videoId: video.id });
    } catch {
      setDraft({ state: "failed", videoId: null });
      toast.error("Couldn't attach that link. Please check the URL.");
    }
  }

  function removeDraft() {
    if (draft && "videoId" in draft && draft.videoId != null) {
      void deleteVideo(draft.videoId).catch(() => {});
    }
    setDraft(null);
  }

  const draftVideoId =
    draft && (draft.state === "processing" || draft.state === "ready") ? draft.videoId : null;
  const canSend =
    !pending &&
    draft?.state !== "uploading" &&
    draft?.state !== "failed" &&
    (body.trim().length > 0 || draftVideoId != null);

  async function send() {
    if (!canSend) return;
    const text = body;
    const stillProcessing = draft?.state === "processing" ? draft.videoId : null;
    try {
      await onSubmit(text, draftVideoId);
      setBody("");
      setDraft(null);
      setSentPending(stillProcessing != null ? { body: text, videoId: stillProcessing } : null);
    } catch {
      toast.error("Failed to post reply. Please try again.");
    }
  }

  return (
    <>
      {draft && <DraftPreview draft={draft} onRemove={removeDraft} />}
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
              onClick={() => setOpen(true)}
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

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          side="bottom"
          className="gap-4 rounded-t-xl pb-[env(safe-area-inset-bottom)]"
        >
          <SheetHeader className="text-left">
            <SheetTitle>Add a video</SheetTitle>
            <SheetDescription>Upload a clip or paste a link.</SheetDescription>
          </SheetHeader>
          <div className="px-4 pb-6">
            <Tabs value={tab} onValueChange={(v) => setTab(v as "upload" | "link")}>
              <TabsList className="w-full">
                <TabsTrigger value="upload" className="flex-1">
                  Upload file
                </TabsTrigger>
                <TabsTrigger value="link" className="flex-1">
                  Paste link
                </TabsTrigger>
              </TabsList>
              <TabsContent value="upload" className="pt-4">
                <Input
                  type="file"
                  accept="video/mp4"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void pickFile(f);
                  }}
                />
              </TabsContent>
              <TabsContent value="link" className="space-y-3 pt-4">
                <Input
                  placeholder="YouTube / Vimeo / Drive URL"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                />
                <Button type="button" className="w-full" onClick={pasteLink} disabled={!url.trim()}>
                  Attach link
                </Button>
              </TabsContent>
            </Tabs>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}

function DraftPreview({ draft, onRemove }: { draft: Draft; onRemove: () => void }) {
  const label =
    draft.state === "uploading"
      ? "Uploading video…"
      : draft.state === "processing"
        ? "Processing video…"
        : draft.state === "ready"
          ? "Video attached"
          : "Video failed to upload";
  const failed = draft.state === "failed";
  return (
    <div
      className={`mb-2 flex items-center gap-2 rounded-lg border px-3 py-2 text-sm ${
        failed ? "border-destructive/40 text-destructive" : "border-border text-muted-foreground"
      }`}
    >
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
  );
}
