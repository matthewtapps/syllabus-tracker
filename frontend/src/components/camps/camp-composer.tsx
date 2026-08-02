/**
 * The camp page's composer: one ReplyComposer whose icon bar carries everything
 * a camp accepts, so posting a note, a video and a technique are the same
 * gesture rather than three unrelated controls.
 */
import { Dumbbell } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ReplyComposer } from "@/components/threads/reply-composer";
import type { VideoAttachment } from "@/components/threads/reply-composer";

interface CampComposerProps {
  campId: number;
  studentId: number;
  /** Called to post the thread (plain text or video). Passed straight to ReplyComposer. */
  onSubmit: (body: string, attachment: VideoAttachment | null) => Promise<void>;
  pending: boolean;
  /** Open the technique-picker dialog. */
  onOpenTechniquePicker: () => void;
}

export function CampComposer({
  campId,
  studentId,
  onSubmit,
  pending,
  onOpenTechniquePicker,
}: CampComposerProps) {
  return (
    <ReplyComposer
      placeholder="Post a note, or attach a video or technique..."
      anchorKind="camp"
      anchorId={campId}
      pending={pending}
      requireVideoTitle
      scopeStudentId={studentId}
      onSubmit={(body, attachment) => onSubmit(body, attachment)}
      extraActions={
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={onOpenTechniquePicker}
          aria-label="Attach technique"
          className="h-8 w-8 rounded-full text-muted-foreground hover:text-foreground"
        >
          <Dumbbell className="h-[18px] w-[18px]" aria-hidden />
        </Button>
      }
    />
  );
}
