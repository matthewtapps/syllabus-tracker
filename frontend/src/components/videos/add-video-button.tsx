import { useState } from "react";
import { PlusIcon } from "lucide-react";
import type { Video } from "@/lib/api";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  MAX_VIDEO_BYTES,
  MAX_VIDEO_DURATION_SECONDS,
  formatBytes,
} from "./limits";
import { LinkVideoForm } from "./link-video-form";
import { UploadVideoForm } from "./upload-video-form";

interface AddVideoButtonProps {
  techniqueId: number;
  onAdded: (videoIdOrVideo: number | Video) => void;
}

export function AddVideoButton({ techniqueId, onAdded }: AddVideoButtonProps) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"upload" | "link">("upload");

  function close() {
    setOpen(false);
  }

  return (
    <div className="space-y-1">
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
      >
        <PlusIcon className="mr-1.5 h-4 w-4" aria-hidden />
        Add video
      </Button>
      <p className="text-xs text-muted-foreground">
        Max {MAX_VIDEO_DURATION_SECONDS / 60} minutes, mp4 only, up to{" "}
        {formatBytes(MAX_VIDEO_BYTES)}. Longer clips can be linked from YouTube,
        Vimeo, or Drive.
      </p>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          side="right"
          className="flex w-full flex-col gap-4 overflow-y-auto p-4 sm:max-w-md sm:p-6"
        >
          <SheetHeader className="space-y-1 p-0 text-left">
            <SheetTitle>Add video</SheetTitle>
            <SheetDescription>
              Upload a clip from your device or paste a link from YouTube,
              Vimeo, or Google Drive.
            </SheetDescription>
          </SheetHeader>

          <Tabs value={tab} onValueChange={(value) => setTab(value as "upload" | "link")}>
            <TabsList className="w-full">
              <TabsTrigger value="upload" className="flex-1">
                Upload file
              </TabsTrigger>
              <TabsTrigger value="link" className="flex-1">
                Paste link
              </TabsTrigger>
            </TabsList>
            <TabsContent value="upload" className="pt-4">
              <UploadVideoForm
                techniqueId={techniqueId}
                onCancel={close}
                onUploaded={(videoId) => {
                  close();
                  onAdded(videoId);
                }}
              />
            </TabsContent>
            <TabsContent value="link" className="pt-4">
              <LinkVideoForm
                techniqueId={techniqueId}
                onCancel={close}
                onLinked={(video) => {
                  close();
                  onAdded(video);
                }}
              />
            </TabsContent>
          </Tabs>
        </SheetContent>
      </Sheet>
    </div>
  );
}
