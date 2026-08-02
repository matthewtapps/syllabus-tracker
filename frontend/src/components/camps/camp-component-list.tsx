import { Dumbbell, Loader2, MessageSquare, Video as VideoIcon } from "lucide-react";
import { TechniqueRowDetail } from "@/components/technique-row";
import { ThreadView } from "@/components/threads/thread-view";
import { VideoReviewPanel } from "@/components/videos/review/video-review-panel";
import { useThread } from "@/lib/queries";
import { formatRelativeShort } from "@/lib/dates";
import { cn } from "@/lib/utils";
import type { CampComponent, ThreadView as ThreadViewModel } from "@/lib/api";
import { componentKey } from "./component-key";

interface CampComponentListProps {
  campId: number;
  studentId: number;
  components: CampComponent[];
  isLoading: boolean;
  /** The component an anchor scrolled to, ringed until the highlight expires. */
  highlightKey: string | null;
  /** The component the URL addresses, which is the only one `?video=` and
   *  `?t=` apply to. */
  anchorKey: string | null;
  videoId: number | null;
  resumeSeconds: number | null;
  isFetchingNextPage: boolean;
}

/**
 * A camp's content, rendered as full-fat components: a technique mounts the
 * same expanded panel its row does, a note mounts the whole thread, a
 * camp-owned clip mounts the review panel.
 */
export function CampComponentList({
  campId,
  studentId,
  components,
  isLoading,
  highlightKey,
  anchorKey,
  videoId,
  resumeSeconds,
  isFetchingNextPage,
}: CampComponentListProps) {
  if (isLoading) return <ComponentSkeletons />;
  if (components.length === 0) {
    return (
      <p className="rounded-lg border border-border bg-card px-6 py-12 text-center text-sm text-muted-foreground">
        Post a technique, video, or note to start this camp.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {components.map((component) => {
        const key = componentKey(component);
        const anchored = anchorKey === key;
        return (
          <section
            key={key}
            data-component-key={key}
            className={cn(
              "overflow-hidden rounded-lg border border-border bg-card transition-shadow",
              highlightKey === key && "bg-muted/40 ring-2 ring-ring/60",
            )}
          >
            <ComponentStrip component={component} />
            <div className="px-4 pb-4">
              <ComponentBody
                component={component}
                campId={campId}
                studentId={studentId}
                videoId={anchored ? videoId : null}
                resumeSeconds={anchored ? resumeSeconds : null}
              />
            </div>
          </section>
        );
      })}
      {isFetchingNextPage && (
        <div className="flex justify-center py-4 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        </div>
      )}
    </div>
  );
}

const KIND_ICON = {
  technique: Dumbbell,
  note: MessageSquare,
  video: VideoIcon,
} as const;

/** What this component is, and when it was last touched. No breadcrumb: the
 *  camp is the context, so there is nowhere else to send the reader. */
function ComponentStrip({ component }: { component: CampComponent }) {
  const Icon = KIND_ICON[component.kind];
  return (
    <div className="flex items-center gap-2 border-b border-border px-4 py-2.5 text-xs text-muted-foreground">
      <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
      <span className="min-w-0 flex-1 truncate font-medium text-foreground">
        {componentTitle(component)}
      </span>
      <span className="shrink-0">{formatRelativeShort(component.last_touch)}</span>
    </div>
  );
}

function componentTitle(component: CampComponent): string {
  if (component.kind === "technique") return component.technique?.name ?? "Technique";
  if (component.kind === "video") {
    const title = component.video?.title.trim();
    return title ? title : "Clip";
  }
  return "Note";
}

function ComponentBody({
  component,
  campId,
  studentId,
  videoId,
  resumeSeconds,
}: {
  component: CampComponent;
  campId: number;
  studentId: number;
  videoId: number | null;
  resumeSeconds: number | null;
}) {
  switch (component.kind) {
    case "technique":
      return component.technique ? (
        <div className="pt-3">
          <TechniqueRowDetail
            technique={component.technique}
            context={{ kind: "camp", campId, studentId }}
            scrollToVideoId={videoId}
            resumeSeconds={resumeSeconds}
          />
        </div>
      ) : (
        <Unavailable label="technique" />
      );
    case "note":
      return component.thread ? (
        <div className="pt-3">
          <NoteBody thread={component.thread} campId={campId} />
        </div>
      ) : (
        <Unavailable label="note" />
      );
    case "video":
      return component.video ? (
        <div className="pt-3">
          <VideoReviewPanel
            video={component.video}
            surface={{ kind: "student", studentId }}
            startAtSeconds={resumeSeconds}
          />
        </div>
      ) : (
        <Unavailable label="clip" />
      );
  }
}

/** Reads the note back through its own cache, which the component read seeded
 *  and a reply keeps current, so a reply posted here shows up here. */
function NoteBody({ thread, campId }: { thread: ThreadViewModel; campId: number }) {
  const live = useThread(thread.id);
  return (
    <ThreadView thread={live.data ?? thread} anchorKind="camp" anchorId={campId} />
  );
}

function Unavailable({ label }: { label: string }) {
  return (
    <p className="py-3 text-xs italic text-muted-foreground">
      This {label} is no longer available.
    </p>
  );
}

function ComponentSkeletons() {
  return (
    <div className="space-y-4">
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="rounded-lg border border-border bg-card p-4">
          <div className="h-3 w-1/3 animate-pulse rounded bg-muted" />
          <div className="mt-3 h-24 animate-pulse rounded bg-muted/50" />
        </div>
      ))}
    </div>
  );
}
