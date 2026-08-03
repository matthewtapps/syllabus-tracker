import { useEffect, useRef } from "react";
import { useUser } from "@/lib/current-user-context";
import { isCoachOrAdmin } from "@/lib/api";
import { useTechniqueVideos } from "@/lib/queries";
import { feedTileHref } from "@/lib/view-context";
import { useListUrlState } from "@/lib/use-list-url-state";
import { VideoReviewPanel } from "@/components/videos/review/video-review-panel";
import { useWatchTracker, type WatchContext } from "@/components/videos/useWatchTracker";
import type { VideoThreadSurface } from "@/lib/thread-visibility";
import type { Subject } from "@/lib/feed-item";
import { TileShell, TileSkeleton } from "./tile-shell";

/**
 * The embedded video for a feed entry that is about a video (a watch, an add, or
 * a comment on the video). Surfaces the player itself with its timestamped
 * discussion via `VideoReviewPanel`, so the noun is watchable and commentable
 * straight from the feed. The breadcrumb above names the technique context.
 *
 * The video is read from the same cached technique-video list the native
 * surfaces use (visibility already filtered there), so a tile never shows a
 * video the viewer can't see, and TanStack dedups across the feed.
 */
export function VideoTile({
  subject,
}: {
  subject: Extract<Subject, { kind: "video" }>;
}) {
  const user = useUser();
  const coach = isCoachOrAdmin(user);
  const ctx = subject.context;
  const syllabus =
    ctx?.kind === "syllabus" && ctx.student
      ? { studentId: ctx.student.id, syllabusId: ctx.syllabus.id }
      : undefined;
  const videos = useTechniqueVideos(
    subject.techniqueId ?? undefined,
    coach ? undefined : user.id,
    syllabus,
  );

  // Track playback so a watch from the feed records like a watch anywhere else
  // (the embed previously had no tracker, so feed watches never logged activity).
  const watchContext: WatchContext | undefined =
    subject.techniqueId != null
      ? {
          technique_id: subject.techniqueId,
          ...(ctx?.kind === "syllabus" && ctx.sst
            ? { syllabus_id: ctx.syllabus.id, sst_id: ctx.sst.id }
            : {}),
        }
      : undefined;
  const watchEvents = useWatchTracker(subject.videoId, watchContext);

  // A feed tile is the destination for a `?video=<id>&t=<seconds>` link when the
  // video lives in a feed rather than in a technique row's video list, which is
  // where a camp's videos now live. Scroll to it and start its player where the
  // viewer left off; the seek itself is once-only, inside the panel.
  const { videoId: urlVideoId, resumeSeconds } = useListUrlState();
  const isResumeTarget =
    urlVideoId === subject.videoId && resumeSeconds != null && resumeSeconds > 0;
  const tileRef = useRef<HTMLDivElement>(null);
  const scrolledRef = useRef(false);
  useEffect(() => {
    if (!isResumeTarget || scrolledRef.current) return;
    scrolledRef.current = true;
    tileRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [isResumeTarget]);

  // A video with no resolvable technique can't be located in a list; bail to a
  // header-only entry rather than guessing.
  if (subject.techniqueId == null) return null;
  if (videos.isLoading) return <TileSkeleton />;
  const video = (videos.data ?? []).find((v) => v.id === subject.videoId);
  if (!video) return null;

  // Thread visibility for new comments follows the surface the video is shown
  // on: a syllabus-context video is the student's; a library video is global.
  const surface: VideoThreadSurface =
    ctx?.kind === "syllabus" && ctx.student
      ? { kind: "student", studentId: ctx.student.id }
      : { kind: "library" };

  return (
    <div ref={tileRef}>
      <TileShell>
        <VideoReviewPanel
          video={video}
          surface={surface}
          watchEvents={watchEvents}
          startAtSeconds={isResumeTarget ? resumeSeconds : null}
          feedPresentation={{
            focusThreadId: subject.focusThreadId,
            href: feedTileHref(ctx, subject.techniqueId),
          }}
        />
      </TileShell>
    </div>
  );
}
