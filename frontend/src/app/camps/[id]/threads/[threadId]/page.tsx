import { Link, Navigate, useParams } from "react-router-dom";
import { isCoachOrAdmin } from "@/lib/api";
import { useUser } from "@/lib/current-user-context";
import { useCamp, useThreadsForAnchor } from "@/lib/queries";
import { ThreadView } from "@/components/threads/thread-view";

/**
 * One camp discussion, on its own page: the root post, every reply, and the
 * composer.
 *
 * The camp feed shows a two-line teaser of each thread, and the camp is the
 * surface that owns it, so there is nowhere else to send the reader. This page
 * is that destination, and its URL is shareable, which a feed teaser and the
 * withdrawn detail sheet both were not.
 */
export default function CampThreadPage() {
  const params = useParams<{ id: string; threadId: string }>();
  const campId = params.id ? parseInt(params.id, 10) : NaN;
  const threadId = params.threadId ? parseInt(params.threadId, 10) : NaN;

  if (!Number.isFinite(campId) || !Number.isFinite(threadId)) {
    return <Navigate to="/dashboard" replace />;
  }

  return <CampThreadDetail campId={campId} threadId={threadId} />;
}

function CampThreadDetail({ campId, threadId }: { campId: number; threadId: number }) {
  const viewer = useUser();
  const coach = isCoachOrAdmin(viewer);
  const campQuery = useCamp(campId);
  // The camp's thread list is the same cached query the feed's tiles read, so
  // the thread is usually already in cache when a teaser is tapped. The list is
  // camp-scoped and the API filters it by visibility, so a thread absent from it
  // is one this viewer may not read.
  const threadsQuery = useThreadsForAnchor("camp", campId);

  const camp = campQuery.data;

  if (campQuery.isError) return <Navigate to="/dashboard" replace />;
  if (campQuery.isLoading || !camp) return <ThreadSkeleton />;

  // Same rule the camp page enforces: the camp's own student, or any coach.
  if (viewer.id !== camp.student_id && !coach) {
    return <Navigate to="/dashboard" replace />;
  }

  if (threadsQuery.isLoading) return <ThreadSkeleton />;

  const thread = (threadsQuery.data ?? []).find((t) => t.id === threadId);
  if (!thread) {
    return (
      <div className="container mx-auto space-y-3 px-4 py-6 sm:px-6 md:py-8">
        <h1 className="text-base font-semibold">Discussion unavailable</h1>
        <p className="text-sm text-muted-foreground">
          This discussion could not be loaded. It may have been deleted.
        </p>
        <Link to={`/camps/${campId}`} className="text-sm text-primary underline">
          Back to {camp.name}
        </Link>
      </div>
    );
  }

  return (
    <div className="container mx-auto space-y-4 px-4 py-6 sm:px-6 md:py-8">
      <header className="space-y-1">
        <h1 className="text-base font-semibold">Discussion</h1>
        <p className="text-xs text-muted-foreground">{`In ${camp.name}`}</p>
      </header>
      <div className="rounded-lg border border-border bg-card p-4">
        <ThreadView thread={thread} anchorKind="camp" anchorId={campId} />
      </div>
    </div>
  );
}

function ThreadSkeleton() {
  return (
    <div className="container mx-auto px-4 py-6 sm:px-6 md:py-8">
      <div className="h-6 w-40 animate-pulse rounded bg-muted" />
    </div>
  );
}
