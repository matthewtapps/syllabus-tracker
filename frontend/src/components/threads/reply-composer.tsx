import { useState } from "react";
import { SendHorizontal, Video as VideoIcon } from "lucide-react";
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
import { useCreateThreadVideoReply } from "@/lib/mutations";

interface ReplyComposerProps {
  threadId: number;
  anchorKind: string;
  anchorId: number;
  campId?: number;
  /** Whether a text reply is currently posting. */
  pending: boolean;
  onSubmit: (body: string) => Promise<void>;
}

/**
 * Single-row reply composer: a pill text input with a video-reply icon parked
 * inline at its right edge, and a send button alongside (disabled until there
 * is text). The video icon opens a sheet to upload a clip or paste a link; the
 * upload posts optimistically in the background (see useCreateThreadVideoReply).
 */
export function ReplyComposer({
  threadId,
  anchorKind,
  anchorId,
  campId,
  pending,
  onSubmit,
}: ReplyComposerProps) {
  const user = useUser();
  const [body, setBody] = useState("");
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"upload" | "link">("upload");
  const [file, setFile] = useState<File | null>(null);
  const [url, setUrl] = useState("");
  const videoReply = useCreateThreadVideoReply(anchorKind, anchorId, campId);

  const canSend = body.trim().length > 0 && !pending;

  async function send() {
    const trimmed = body.trim();
    if (!trimmed || pending) return;
    await onSubmit(trimmed);
    setBody("");
  }

  // Fire-and-forget: the upload runs in the background while an optimistic
  // placeholder shows in the thread. Close the sheet immediately.
  function postVideo() {
    if (tab === "upload") {
      if (!file) return;
      videoReply.mutate(
        { threadId, kind: "upload", file, authorId: user.id, authorName: user.display_name },
        { onError: () => toast.error("Failed to post video reply. Please try again.") },
      );
    } else {
      if (!url.trim()) return;
      videoReply.mutate(
        { threadId, kind: "link", url: url.trim() },
        { onError: () => toast.error("Failed to post video reply. Please try again.") },
      );
    }
    setOpen(false);
    setFile(null);
    setUrl("");
  }

  return (
    <>
      <div className="flex items-end gap-2">
        <div className="relative flex-1">
          <Textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            onKeyDown={(e) => {
              // Enter sends; Shift+Enter inserts a newline.
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            placeholder="Reply…"
            rows={1}
            disabled={pending}
            className="max-h-40 min-h-9 resize-none rounded-2xl pr-11"
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => setOpen(true)}
            aria-label="Video reply"
            className="absolute bottom-1 right-1 h-7 w-7 rounded-full text-muted-foreground hover:text-foreground"
          >
            <VideoIcon className="h-4 w-4" aria-hidden />
          </Button>
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
          side="right"
          className="flex w-full flex-col gap-4 overflow-y-auto p-4 sm:max-w-md sm:p-6"
        >
          <SheetHeader className="space-y-1 p-0 text-left">
            <SheetTitle>Video reply</SheetTitle>
            <SheetDescription>Upload a clip or paste a link.</SheetDescription>
          </SheetHeader>

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
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
            </TabsContent>
            <TabsContent value="link" className="pt-4">
              <Input
                placeholder="YouTube / Vimeo / Drive URL"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
              />
            </TabsContent>
          </Tabs>

          <Button type="button" onClick={postVideo}>
            Post reply
          </Button>
        </SheetContent>
      </Sheet>
    </>
  );
}
