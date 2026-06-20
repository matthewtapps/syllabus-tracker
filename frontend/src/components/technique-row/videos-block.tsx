import { useMemo, useState } from "react";
import { FilmIcon } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { qk } from "@/lib/query-keys";
import { useCampTechniqueVideos } from "@/lib/queries";
import type { Video } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AddVideoButton } from "@/components/videos/add-video-button";
import { VideoList } from "@/components/videos/video-list";
import { VideoRow } from "@/components/videos/video-row";
import { VideoPlayerDialog } from "@/components/videos/video-player-dialog";
import { PrivacyAckBanner } from "@/components/videos/privacy-ack-banner";
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
      {context.kind === "camp" && (
        <CampOnlyVideos
          campId={context.campId}
          studentId={context.studentId}
          techniqueId={technique.id}
          contextLabel={contextLabel}
        />
      )}
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

interface CampOnlyVideosProps {
  campId: number;
  /** Camp's owning student. Scopes thread visibility on playback. */
  studentId: number;
  techniqueId: number;
  contextLabel?: string;
}

/**
 * Read-only "Camp only" reference clips for a technique inside a camp. These
 * are footage attached to the technique but visible only within this camp.
 * Renders nothing until there is at least one such clip (no empty-state noise).
 * Both the coach and the camp's own student see this section; the backend
 * gates the read. Rendered read-only (canManage={false}) so no delete or
 * visibility controls appear here.
 */
function CampOnlyVideos({
  campId,
  studentId,
  techniqueId,
  contextLabel,
}: CampOnlyVideosProps) {
  const { data } = useCampTechniqueVideos(campId, techniqueId);
  const [playing, setPlaying] = useState<Video | null>(null);

  // No loading or error noise: this is a supplementary section below the main
  // list. If it never loads, the global list still stands on its own.
  if (!data || data.length === 0) return null;

  // Dummy techniqueId for VideoRow's rename-dialog cache key; rename controls
  // are not rendered here (canManage={false}), so it is unused.
  const CAMP_VIDEO_TECHNIQUE_SENTINEL = 0;

  return (
    <div className="space-y-1.5 pt-1">
      <div className="flex items-center gap-2">
        <Badge variant="secondary" className="text-[10px] uppercase tracking-wide">
          Camp only
        </Badge>
        <span className="text-[11px] text-muted-foreground">
          Visible only in this camp.
        </span>
      </div>
      <PrivacyAckBanner enabled={playing !== null} />
      <ul className="divide-y divide-white/15 overflow-hidden rounded-md border border-white/20 bg-card shadow-sm">
        {data.map((video) => (
          <VideoRow
            key={video.id}
            video={video}
            techniqueId={CAMP_VIDEO_TECHNIQUE_SENTINEL}
            canManage={false}
            onPlay={() => setPlaying(video)}
            onDeleted={() => {}}
          />
        ))}
      </ul>
      <VideoPlayerDialog
        video={playing}
        onClose={() => setPlaying(null)}
        surface={{ kind: "student", studentId }}
        context={contextLabel ? { label: contextLabel } : undefined}
      />
    </div>
  );
}
