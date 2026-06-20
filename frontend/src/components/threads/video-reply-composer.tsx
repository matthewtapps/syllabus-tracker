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
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"upload" | "link">("upload");
  const [file, setFile] = useState<File | null>(null);
  const [url, setUrl] = useState("");
  const [caption, setCaption] = useState("");
  const mutate = useCreateThreadVideoReply(anchorKind, anchorId, campId);

  async function submit() {
    try {
      if (tab === "upload") {
        if (!file) return;
        await mutate.mutateAsync({
          threadId,
          kind: "upload",
          file,
          caption: caption || null,
        });
      } else {
        if (!url.trim()) return;
        await mutate.mutateAsync({
          threadId,
          kind: "link",
          url: url.trim(),
          caption: caption || null,
        });
      }
      setOpen(false);
      setFile(null);
      setUrl("");
      setCaption("");
    } catch {
      toast.error("Failed to post video reply. Please try again.");
    }
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

          <Input
            placeholder="Caption (optional)"
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
          />

          <Button
            type="button"
            onClick={submit}
            disabled={mutate.isPending}
          >
            {mutate.isPending ? "Posting..." : "Post reply"}
          </Button>
        </SheetContent>
      </Sheet>
    </>
  );
}
