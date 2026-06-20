import { useState } from "react";
import { Video as VideoIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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

interface VideoReplyComposerProps {
  threadId: number;
  anchorKind: string;
  anchorId: number;
  campId?: number;
}

export function VideoReplyComposer({
  threadId,
  anchorKind,
  anchorId,
  campId,
}: VideoReplyComposerProps) {
  const user = useUser();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"upload" | "link">("upload");
  const [file, setFile] = useState<File | null>(null);
  const [url, setUrl] = useState("");
  const mutate = useCreateThreadVideoReply(anchorKind, anchorId, campId);

  // Fire-and-forget: the upload runs in the background while the reply shows up
  // immediately (optimistic placeholder, see useCreateThreadVideoReply). We
  // close the sheet right away rather than blocking on the upload.
  function submit() {
    if (tab === "upload") {
      if (!file) return;
      mutate.mutate(
        {
          threadId,
          kind: "upload",
          file,
          authorId: user.id,
          authorName: user.display_name,
        },
        { onError: () => toast.error("Failed to post video reply. Please try again.") },
      );
    } else {
      if (!url.trim()) return;
      mutate.mutate(
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
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
      >
        <VideoIcon className="mr-1.5 h-4 w-4" aria-hidden />
        Video reply
      </Button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          side="right"
          className="flex w-full flex-col gap-4 overflow-y-auto p-4 sm:max-w-md sm:p-6"
        >
          <SheetHeader className="space-y-1 p-0 text-left">
            <SheetTitle>Video reply</SheetTitle>
            <SheetDescription>
              Upload a clip or paste a link.
            </SheetDescription>
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

          <Button type="button" onClick={submit}>
            Post reply
          </Button>
        </SheetContent>
      </Sheet>
    </>
  );
}
