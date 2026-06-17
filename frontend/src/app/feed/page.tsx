import { Link } from "react-router-dom";
import { Activity, LayoutDashboard } from "lucide-react";
import { ActivityTileFeed } from "@/components/activity-feed/activity-tile-feed";
import { useStudentActivityFeed, useActivityFeed } from "@/lib/queries";
import { useUser } from "@/lib/current-user-context";
import { isCoachOrAdmin } from "@/lib/api";

/**
 * The social feed: the default landing for students and coaches. Students see
 * their own activity; coaches see the gym-wide feed from their perspective.
 * The classic dashboard stays reachable at /dashboard/classic.
 */
export default function SocialFeedPage() {
  const user = useUser();
  return isCoachOrAdmin(user) ? <CoachFeed /> : <StudentFeed studentId={user.id} />;
}

function StudentFeed({ studentId }: { studentId: number }) {
  const feed = useStudentActivityFeed(studentId, 50);
  return (
    <Shell title="Your feed">
      <ActivityTileFeed
        rows={feed.data ?? []}
        isLoading={feed.isLoading}
        scope={{ kind: "student", studentId }}
        showAvatar={false}
        emptyText="Nothing here yet. Train, log attempts, and watch videos to fill your feed."
      />
    </Shell>
  );
}

function CoachFeed() {
  const feed = useActivityFeed(true, 50);
  return (
    <Shell title="Gym feed" showClassicLink>
      <ActivityTileFeed
        rows={feed.data ?? []}
        isLoading={feed.isLoading}
        scope={{ kind: "gym" }}
        emptyText="No gym activity yet."
      />
    </Shell>
  );
}

function Shell({
  title,
  children,
  showClassicLink = false,
}: {
  title: string;
  children: React.ReactNode;
  showClassicLink?: boolean;
}) {
  return (
    <div className="container mx-auto max-w-2xl px-4 py-6 sm:px-6 md:py-8 space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="flex items-center gap-2 text-base font-semibold">
          <Activity className="h-4 w-4" aria-hidden />
          {title}
        </h1>
        {showClassicLink && (
          <Link
            to="/dashboard/classic"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <LayoutDashboard className="h-3.5 w-3.5" aria-hidden />
            Classic dashboard
          </Link>
        )}
      </div>
      {children}
    </div>
  );
}
