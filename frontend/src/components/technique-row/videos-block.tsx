import { useMemo, useState } from "react";
import { AddVideoButton } from "@/components/videos/add-video-button";
import { VideoList } from "@/components/videos/video-list";
import type { WatchContext } from "@/components/videos/useWatchTracker";
import type { VideoThreadSurface } from "@/lib/thread-visibility";
import { useTechniqueRow } from "./technique-row-context";

interface VideosBlockProps {
  canManage: boolean;
  scrollToVideoId?: number | null;
  onVideoScrolled?: () => void;
}

export function VideosBlock({
  canManage,
  scrollToVideoId,
  onVideoScrolled,
}: VideosBlockProps) {
  const { context, technique, role } = useTechniqueRow();
  const isCoach = role === "coach" || role === "admin";
  const [reloadKey, setReloadKey] = useState(0);

  // student-syllabus context: fetch via the per-(student, syllabus,
  // technique) endpoint so per-syllabus visibility overrides apply, and
  // pass the syllabus scope to VideoList so coaches see the
  // SyllabusVisibilityControl on each row.
  const syllabus =
    context.kind === "student-syllabus"
      ? { studentId: context.studentId, syllabusId: context.syllabusId }
      : undefined;

  const surface: VideoThreadSurface =
    context.kind === "student-pinned" || context.kind === "student-syllabus"
      ? { kind: "student", studentId: context.studentId }
      : { kind: "library" };

  const watchContext = useMemo<WatchContext>(() => {
    if (context.kind === "student-syllabus") {
      return {
        technique_id: technique.id,
        syllabus_id: context.syllabusId,
        sst_id: context.sst.id,
      };
    }
    return { technique_id: technique.id };
  }, [context, technique.id]);

  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Videos
          </h3>
          {canManage && (
            <p className="text-[11px] text-muted-foreground">
              Order applies to every student.
            </p>
          )}
        </div>
        {canManage && (
          <AddVideoButton
            techniqueId={technique.id}
            onAdded={() => setReloadKey((k) => k + 1)}
          />
        )}
      </div>
      <VideoList
        techniqueId={technique.id}
        canManage={canManage}
        surface={surface}
        isCoach={isCoach}
        reloadKey={reloadKey}
        syllabus={syllabus}
        scrollToVideoId={scrollToVideoId}
        onVideoScrolled={onVideoScrolled}
        watchContext={watchContext}
      />
    </section>
  );
}
