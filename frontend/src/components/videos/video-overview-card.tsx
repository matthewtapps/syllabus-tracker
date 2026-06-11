import { Link } from "react-router-dom";
import { PlayCircleIcon } from "lucide-react";
import { useDashboardVideoOverview } from "@/lib/queries";
import { Badge } from "@/components/ui/badge";

interface VideoOverviewCardProps {
  className?: string;
}

export function VideoOverviewCard({ className }: VideoOverviewCardProps) {
  const overviewQuery = useDashboardVideoOverview();
  const overview = overviewQuery.data ?? null;
  const error = overviewQuery.error ? "Could not load video activity" : null;

  return (
    <section
      className={
        "overflow-hidden rounded-lg border border-border bg-card " +
        (className ?? "")
      }
    >
      <header className="flex items-center gap-2.5 border-b border-border px-4 py-3">
        <PlayCircleIcon className="h-4 w-4 text-muted-foreground" aria-hidden />
        <div className="flex-1">
          <h2 className="text-sm font-semibold">Video activity (last 7 days)</h2>
          <p className="text-xs text-muted-foreground">
            What students are watching, and what's still cooking.
          </p>
        </div>
        {overview && overview.videos_processing > 0 && (
          <Badge variant="outline" className="text-xs">
            {overview.videos_processing} processing
          </Badge>
        )}
      </header>

      <div className="px-4 py-3">
        {error && <p className="text-sm text-destructive">{error}</p>}
        {!error && !overview && (
          <p className="text-sm italic text-muted-foreground">Loading...</p>
        )}
        {overview && (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              <span className="font-medium text-foreground">
                {formatTotalWatched(overview.total_seconds_watched)}
              </span>{" "}
              of video watched across the gym this week.
            </p>

            {overview.top_videos.length === 0 ? (
              <p className="text-sm italic text-muted-foreground">
                No one has played a video yet this week.
              </p>
            ) : (
              <ul className="space-y-1.5">
                {overview.top_videos.map((row) => (
                  <li
                    key={row.video_id}
                    className="flex items-center justify-between gap-3 text-sm"
                  >
                    <Link
                      to={`/library?focus=technique:${row.technique_id}&video=${row.video_id}`}
                      className="min-w-0 flex-1 truncate text-foreground underline-offset-2 hover:underline"
                    >
                      {row.video_title}
                    </Link>
                    <span className="text-xs text-muted-foreground">
                      {row.plays_this_window} plays · {row.unique_viewers}{" "}
                      viewers
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

function formatTotalWatched(seconds: number): string {
  if (seconds < 60) return `${seconds} seconds`;
  const mins = Math.round(seconds / 60);
  if (mins < 60) return `${mins} minutes`;
  const hours = Math.floor(mins / 60);
  const remMins = mins % 60;
  return `${hours}h ${remMins}m`;
}
