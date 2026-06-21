/**
 * Unified composer for the camp feed page.
 *
 * Wraps ReplyComposer (which handles text + 4-source video) and adds a
 * Technique button that opens the AddCampTechniqueDialog. The layout is:
 *
 *   [ Technique btn ] [ ReplyComposer: text area + video btn + send ]
 *
 * ReplyComposer already gates the video attach button on camp surfaces
 * (`canAttach = ... anchorKind === "camp"`), so video attach works for
 * both coaches and the camp's own student.
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
    <div className="rounded-lg border border-border bg-card p-3 space-y-2">
      <ReplyComposer
        placeholder="Post a note or attach a video..."
        anchorKind="camp"
        anchorId={campId}
        pending={pending}
        requireVideoTitle
        scopeStudentId={studentId}
        onSubmit={(body, attachment) => onSubmit(body, attachment)}
      />
      <div className="flex">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 gap-1.5 text-xs"
          onClick={onOpenTechniquePicker}
        >
          <Dumbbell className="h-3.5 w-3.5" aria-hidden />
          Attach technique
        </Button>
      </div>
    </div>
  );
}
