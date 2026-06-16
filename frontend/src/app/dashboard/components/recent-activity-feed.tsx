import { Activity } from "lucide-react";
import { ActivityFeedList } from "@/components/activity-feed-list";
import { useDashboardActivityFeed } from "@/lib/queries";

export function RecentActivityFeed() {
  const { data, isLoading } = useDashboardActivityFeed();
  return (
    <section className="mb-8 overflow-hidden rounded-lg border border-border bg-card">
      <header className="flex items-center gap-2.5 border-b border-border px-4 py-3">
        <Activity className="h-4 w-4 text-muted-foreground" aria-hidden />
        <h2 className="text-sm font-semibold">Recent activity</h2>
      </header>
      <ActivityFeedList
        rows={data ?? []}
        isLoading={isLoading}
        coalesce
        maxRows={6}
        emptyText="No recent student activity yet."
      />
    </section>
  );
}
