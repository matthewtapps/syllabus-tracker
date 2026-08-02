import { useState } from "react";
import { PlusIcon } from "lucide-react";
import { toast } from "sonner";
import type { Video, VideoParentInput } from "@/lib/api";
import { addVideoReference, linkVideo, uploadVideo } from "@/lib/api";
import { isValidationErrorResponse } from "@/lib/types";
import { Button } from "@/components/ui/button";
import {
  AddOrSelectVideoSheet,
  type VideoDetails,
  type VideoSource,
} from "./add-or-select-video-sheet";

/** When the add-video flow runs on a student's syllabus technique, the sheet
 *  surfaces a "also add to global library" switch. When off, the video is
 *  scoped to this student's syllabus technique (T3) rather than the global
 *  technique (T1), whether it is uploaded, linked, or referenced from a clip
 *  that already exists. Absent in library/other contexts (no switch, T1). */
export interface StudentSyllabusScope {
  studentId: number;
  syllabusId: number;
  sstId: number;
}

interface AddVideoButtonProps {
  techniqueId: number;
  studentSyllabus?: StudentSyllabusScope;
  onAdded: (videoIdOrVideo: number | Video) => void;
}

export function AddVideoButton({
  techniqueId,
  studentSyllabus,
  onAdded,
}: AddVideoButtonProps) {
  const [open, setOpen] = useState(false);
  const [progressPct, setProgressPct] = useState<number | null>(null);

  async function commit(source: VideoSource, details: VideoDetails) {
    const title = details.title ?? "";
    // In the library context there's no switch: parent stays undefined (T1).
    // In a student-syllabus context, switching off scopes to this student's
    // syllabus technique (T3).
    const parent: VideoParentInput | undefined =
      studentSyllabus && !details.alsoGlobal
        ? { kind: "student_syllabus_technique", id: studentSyllabus.sstId }
        : undefined;
    const scoped = studentSyllabus && !details.alsoGlobal;

    try {
      if (source.kind === "file") {
        setProgressPct(0);
        const result = await uploadVideo(
          techniqueId,
          source.file,
          { title },
          (loaded, total) => {
            if (total > 0) setProgressPct(Math.round((loaded / total) * 100));
          },
          parent,
        );
        toast.success(
          scoped ? "Video added for this student" : "Upload received. Processing now...",
        );
        onAdded(result.video_id);
      } else if (source.kind === "link") {
        const video = await linkVideo(techniqueId, { title, url: source.url }, parent);
        toast.success(
          scoped ? "Video added for this student" : "Video added to the library",
        );
        onAdded(video);
      } else {
        await addVideoReference(techniqueId, source.video.id, parent, title || undefined);
        toast.success(
          scoped ? "Video added for this student" : "Video added to this technique",
        );
        onAdded(source.video.id);
      }
    } catch (err) {
      toast.error(await describeError(err));
      throw err;
    } finally {
      setProgressPct(null);
    }
  }

  return (
    <>
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
        <PlusIcon className="mr-1.5 h-4 w-4" aria-hidden />
        Add video
      </Button>

      <AddOrSelectVideoSheet
        open={open}
        onOpenChange={setOpen}
        browseStudentId={studentSyllabus?.studentId}
        titleMode="required"
        showScopeSwitch={studentSyllabus != null}
        progressPct={progressPct}
        onConfirm={commit}
      />
    </>
  );
}

/** The upload and link calls both reject with the raw Response, so a server
 *  validation message beats the generic failure text when there is one. */
async function describeError(err: unknown): Promise<string> {
  if (err instanceof Response) {
    try {
      const body: unknown = await err.json();
      if (isValidationErrorResponse(body)) {
        const first = Object.values(body.errors).flat()[0];
        if (typeof first === "string") return first;
      }
    } catch {
      /* not a validation envelope */
    }
    return "Failed to add video";
  }
  return err instanceof Error ? err.message : "Failed to add video";
}
