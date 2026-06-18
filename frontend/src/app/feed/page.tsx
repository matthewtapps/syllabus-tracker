import { useEffect, useMemo, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Activity, ArrowUp, Loader2 } from "lucide-react";
import { ActivityTileFeed } from "@/components/activity-feed/activity-tile-feed";
import { CoachQueue } from "@/app/dashboard/components/coach-queue";
import { ThreadComposer } from "@/components/threads/thread-composer";
import { useActivityFeedHeadId, useInfiniteActivityFeed } from "@/lib/queries";
import { useCreateThread } from "@/lib/mutations";
import { useUser } from "@/lib/current-user-context";
import { isCoachOrAdmin } from "@/lib/api";
import type { ActivityScope } from "@/lib/activity-line";

/**
 * The social feed: the default landing for students and coaches. Students see
 * their own activity; coaches see the gym-wide feed from their perspective.
 * Both paginate (infinite scroll) and poll for newer activity. The classic
 * dashboard stays reachable at /dashboard/classic.
 */
export default function SocialFeedPage() {
  const user = useUser();
  return isCoachOrAdmin(user) ? <CoachFeed /> : <StudentFeed studentId={user.id} />;
}

function StudentFeed({ studentId }: { studentId: number }) {
  // Use the main feed endpoint (not the student-scoped one): for a student it
  // returns their own feed AND advances their read cursor, so the "Up to date"
  // line actually moves. The student-scoped endpoint is read-only (it exists for
  // coaches viewing a profile) and would leave everything permanently unread.
  const feed = useInfiniteActivityFeed();
  return (
    <Shell title="Your feed">
      <ProfileDiscussionComposer studentId={studentId} />
      <FeedBody
        feed={feed}
        scope={{ kind: "student", studentId }}
        showAvatar={false}
        emptyText="Nothing here yet. Train, log attempts, and watch videos to fill your feed."
      />
    </Shell>
  );
}

/**
 * The discussion composer at the top of a student's own feed. Starting a thread
 * here is exactly a private thread on the student's profile (what the coach sees
 * on the profile page), so a coach and the student share one conversation
 * surface. On submit the feed below refreshes so the new thread lands at the top.
 */
function ProfileDiscussionComposer({ studentId }: { studentId: number }) {
  const queryClient = useQueryClient();
  const createThread = useCreateThread();

  async function submit(body: string) {
    try {
      await createThread.mutateAsync({
        anchor_kind: "student_profile",
        anchor_id: studentId,
        visibility: "private",
        scope_student_id: studentId,
        body,
      });
      // Surface the new thread in the feed below (useCreateThread already
      // refreshed the thread cache the tile hydrates from). The student's own
      // feed lives under ["activity","feed",...].
      queryClient.invalidateQueries({ queryKey: ["activity", "feed"] });
    } catch {
      toast.error("Couldn't post your discussion.");
    }
  }

  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <ThreadComposer
        placeholder="Start a discussion..."
        submitLabel="Post"
        pending={createThread.isPending}
        onSubmit={submit}
      />
    </div>
  );
}

function CoachFeed() {
  const feed = useInfiniteActivityFeed();
  return (
    <Shell title="Gym feed">
      <CoachQueue />
      <FeedBody feed={feed} scope={{ kind: "gym" }} emptyText="No gym activity yet." />
    </Shell>
  );
}

/** Both infinite feed hooks return the same shape; type against one. */
type InfiniteFeed = ReturnType<typeof useInfiniteActivityFeed>;

function FeedBody({
  feed,
  scope,
  showAvatar = true,
  emptyText,
}: {
  feed: InfiniteFeed;
  scope: ActivityScope;
  showAvatar?: boolean;
  emptyText: string;
}) {
  const rows = useMemo(() => feed.data?.pages.flat() ?? [], [feed.data]);
  const headId = rows[0]?.id ?? 0;

  // Poll the server's feed head; show the pill when it no longer matches the
  // loaded head (i.e. a newer row arrived). Compared by identity, not >, since
  // ids aren't monotonic with the feed's time ordering when rows are backdated.
  const headQuery = useActivityFeedHeadId(rows.length > 0);
  const hasNew =
    rows.length > 0 && headQuery.data != null && headQuery.data !== headId;

  const topRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);

  const { fetchNextPage, hasNextPage, isFetchingNextPage } = feed;
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && hasNextPage && !isFetchingNextPage) {
          fetchNextPage();
        }
      },
      { rootMargin: "600px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [fetchNextPage, hasNextPage, isFetchingNextPage]);

  function refresh() {
    // Refetch from the newest page (page 1 carries no cursor) and jump to top.
    feed.refetch();
    topRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <div className="relative">
      <div ref={topRef} className="absolute -top-20" aria-hidden />

      {hasNew && (
        <div className="pointer-events-none sticky top-2 z-10 flex justify-center">
          <button
            type="button"
            onClick={refresh}
            className="pointer-events-auto inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-1.5 text-xs font-medium text-primary-foreground shadow-lg hover:opacity-90"
          >
            <ArrowUp className="h-3.5 w-3.5" aria-hidden />
            New activity
          </button>
        </div>
      )}

      <ActivityTileFeed
        rows={rows}
        isLoading={feed.isLoading}
        scope={scope}
        showAvatar={showAvatar}
        emptyText={emptyText}
      />

      {/* Sentinel: fetches the next page as it nears the viewport. */}
      <div ref={sentinelRef} className="h-px" aria-hidden />
      {isFetchingNextPage && (
        <div className="flex justify-center py-4 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        </div>
      )}
      {!hasNextPage && rows.length > 0 && (
        <p className="py-4 text-center text-xs text-muted-foreground">You're all caught up.</p>
      )}
    </div>
  );
}

function Shell({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="container mx-auto max-w-2xl px-4 py-6 sm:px-6 md:py-8 space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="flex items-center gap-2 text-base font-semibold">
          <Activity className="h-4 w-4" aria-hidden />
          {title}
        </h1>
      </div>
      {children}
    </div>
  );
}
