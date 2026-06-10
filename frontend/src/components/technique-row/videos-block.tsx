import { useState } from "react";
import { AddVideoButton } from "@/components/videos/add-video-button";
import { VideoList } from "@/components/videos/video-list";
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
  const { context, technique } = useTechniqueRow();
  const [reloadKey, setReloadKey] = useState(0);

  // student-syllabus context: fetch via the per-(student, syllabus,
  // technique) endpoint so per-syllabus visibility overrides apply, and
  // pass the syllabus scope to VideoList so coaches see the
  // SyllabusVisibilityControl on each row.
  const syllabus =
    context.kind === "student-syllabus"
      ? { studentId: context.studentId, syllabusId: context.syllabusId }
      : undefined;

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
        reloadKey={reloadKey}
        syllabus={syllabus}
        scrollToVideoId={scrollToVideoId}
        onVideoScrolled={onVideoScrolled}
      />
    </section>
  );
}
