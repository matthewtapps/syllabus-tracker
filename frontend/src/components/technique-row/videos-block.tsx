import { useMemo, useState } from "react";
import { FilmIcon } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { qk } from "@/lib/query-keys";
import { Button } from "@/components/ui/button";
import { AddVideoButton } from "@/components/videos/add-video-button";
import { VideoList } from "@/components/videos/video-list";
import type { WatchContext } from "@/components/videos/useWatchTracker";
import type { VideoThreadSurface } from "@/lib/thread-visibility";
import { AddCampFootageDialog } from "./add-camp-footage-dialog";
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
  const [campFootageOpen, setCampFootageOpen] = useState(false);
  const qc = useQueryClient();

  // Coach-only control on the camp surface: attach one of the camp's footage
  // videos to this technique as camp-only reference footage or promote it
  // globally. Coaches are not the camp's owning student, so this is gated on
  // the coach role rather than viewerIsOwner.
  const showAddCampFootage = context.kind === "camp" && isCoach;

  // In a student's syllabus context, the add-video flow offers a "also add to
  // global library" switch and, when off, scopes the new video to this
  // student's syllabus technique (T3). Passing this down also lets us refresh
  // the per-syllabus video list (a different cache bucket than the library
  // list that the reloadKey bump invalidates).
  const studentSyllabus =
    context.kind === "student-syllabus"
      ? {
          studentId: context.studentId,
          syllabusId: context.syllabusId,
          sstId: context.sst.id,
        }
      : undefined;

  // student-syllabus context: fetch via the per-(student, syllabus,
  // technique) endpoint so per-syllabus visibility overrides apply, and
  // pass the syllabus scope to VideoList so coaches see the
  // SyllabusVisibilityControl on each row.
  const syllabus =
    context.kind === "student-syllabus"
      ? { studentId: context.studentId, syllabusId: context.syllabusId }
      : undefined;

  // A camp is a private coach-student space, like the pinned/syllabus
  // surfaces: a coach's video thread here must be scoped to the camp's
  // student, not broadcast to everyone (see deriveThreadVisibility).
  const surface: VideoThreadSurface =
    context.kind === "student-pinned" ||
    context.kind === "student-syllabus" ||
    context.kind === "camp"
      ? { kind: "student", studentId: context.studentId }
      : { kind: "library" };

  // Surface breadcrumb shown in the video viewer header, e.g.
  // "Global technique library" or "Sam R.'s Blue Belt Syllabus".
  const surfaceLabel = (() => {
    switch (context.kind) {
      case "global-library":
        return "Global technique library";
      case "student-pinned":
        return context.studentName
          ? `${context.studentName}'s pinned techniques`
          : "Pinned techniques";
      case "student-syllabus":
        return context.studentName
          ? `${context.studentName}'s ${context.syllabusName ?? "syllabus"}`
          : (context.syllabusName ?? "Syllabus");
      case "syllabus-management":
        return context.syllabusName ? `${context.syllabusName} syllabus` : "Syllabus";
      case "camp":
        return context.studentName ? `${context.studentName}'s camp` : "Camp";
    }
  })();
  const contextLabel = `${surfaceLabel} · ${technique.name}`;

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
        <div className="flex shrink-0 items-center gap-2">
          {showAddCampFootage && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setCampFootageOpen(true)}
            >
              <FilmIcon className="mr-1.5 h-4 w-4" aria-hidden />
              Add footage
            </Button>
          )}
          {canManage && (
            <AddVideoButton
              techniqueId={technique.id}
              studentSyllabus={studentSyllabus}
              onAdded={() => {
                setReloadKey((k) => k + 1);
                if (studentSyllabus) {
                  qc.invalidateQueries({
                    queryKey: qk.syllabusTechniqueVideos(
                      studentSyllabus.studentId,
                      studentSyllabus.syllabusId,
                      technique.id,
                    ),
                  });
                }
              }}
            />
          )}
        </div>
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
        contextLabel={contextLabel}
      />
      {showAddCampFootage && context.kind === "camp" && (
        <AddCampFootageDialog
          open={campFootageOpen}
          onOpenChange={setCampFootageOpen}
          campId={context.campId}
          techniqueId={technique.id}
          techniqueName={technique.name}
        />
      )}
    </section>
  );
}
