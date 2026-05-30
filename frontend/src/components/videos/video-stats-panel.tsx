import { useEffect, useState } from "react";
import type { VideoStatsSnapshot } from "@/lib/api";
import { getVideoStats } from "@/lib/api";

interface VideoStatsPanelProps {
  videoId: number;
}

export function VideoStatsPanel({ videoId }: VideoStatsPanelProps) {
  const [stats, setStats] = useState<VideoStatsSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const next = await getVideoStats(videoId);
        if (!cancelled) {
          setStats(next);
          setError(null);
        }
      } catch (err) {
        console.error(err);
        if (!cancelled) setError("Could not load stats");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [videoId]);

  if (error) {
    return <p className="text-xs text-destructive">{error}</p>;
  }
  if (!stats) {
    return <p className="text-xs text-muted-foreground">Loading stats...</p>;
  }

  return (
    <dl className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
      <Stat label="Viewers" value={stats.unique_viewers.toString()} />
      <Stat label="Plays" value={stats.total_plays.toString()} />
      <Stat
        label="Completion"
        value={`${Math.round(stats.completion_rate * 100)}%`}
      />
      <Stat
        label="Watched"
        value={formatTotalSeconds(stats.total_seconds_watched)}
      />
    </dl>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-muted/20 p-2">
      <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd className="text-sm font-medium text-foreground">{value}</dd>
    </div>
  );
}

function formatTotalSeconds(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.floor(seconds / 60);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  return `${hours}h ${mins % 60}m`;
}
