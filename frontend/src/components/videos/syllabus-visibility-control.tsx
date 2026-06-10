import { Eye, EyeOff } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useSetVideoSyllabusVisibility } from "@/lib/mutations";
import type { Video } from "@/lib/api";

interface SyllabusVisibilityControlProps {
  video: Video;
  studentId: number;
  syllabusId: number;
  techniqueId: number;
}

// PR 4 per-(student, syllabus, video) override. Two-state toggle:
//   - Click while visible -> upsert override = false (hide for this
//     student in this syllabus).
//   - Click while hidden -> clear the override (null), so the video
//     falls back to its global visibility.
// We don't expose "force visible while globally hidden" here because the
// coach-typical use case is hiding a single video in a single syllabus
// for one student. If that flow becomes load-bearing we'll add a third
// state.
export function SyllabusVisibilityControl({
  video,
  studentId,
  syllabusId,
  techniqueId,
}: SyllabusVisibilityControlProps) {
  const mutation = useSetVideoSyllabusVisibility();
  // The per-syllabus video read already filters hidden videos out for
  // students; for coaches the route returns the full list, so we can
  // observe the override status indirectly via the override field set
  // by the existing legacy fetcher. We don't have that here -- in
  // syllabus context the response is the bare Video[] without an
  // override annotation. Treat the click as "set hidden" with a follow-
  // up "set visible" toggle baked into the local optimistic flow.
  // Simpler: the icon reflects the *intent* of the next click rather
  // than the current state. Coaches see EyeOff -> "click to hide" and
  // we treat that as the default starting position; if they want to
  // clear an existing override later they click again.
  async function handleClick(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    // Toggle: set override to false (hidden) if the video is currently
    // visible; otherwise clear (null).
    const next = video.hidden_at == null ? false : null;
    try {
      await mutation.mutateAsync({
        studentId,
        syllabusId,
        videoId: video.id,
        techniqueId,
        visible: next,
      });
      toast.success(
        next === false
          ? `Hidden ${video.title} for this student`
          : `Restored ${video.title} to default visibility`,
      );
    } catch {
      toast.error("Failed to update visibility");
    }
  }

  const isHiddenForStudent = video.hidden_at != null;

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      onClick={handleClick}
      disabled={mutation.isPending}
      aria-label={
        isHiddenForStudent
          ? `Show ${video.title} for this student`
          : `Hide ${video.title} for this student`
      }
      className="h-7 w-7 shrink-0 text-muted-foreground hover:text-foreground"
    >
      {isHiddenForStudent ? (
        <EyeOff className="h-3.5 w-3.5" aria-hidden />
      ) : (
        <Eye className="h-3.5 w-3.5" aria-hidden />
      )}
    </Button>
  );
}
