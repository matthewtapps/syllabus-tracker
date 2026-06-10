import { useMemo } from "react";
import { Link } from "react-router-dom";
import { FolderOpen, PlayIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useLibraryTechniqueStats } from "@/lib/queries";
import type { AttemptWeekBucket, LibraryTechniqueStats } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useTechniqueRow } from "./technique-row-context";

// Coach-only block: collections list, status mix donut, attempts sparkline,
// video plays. Reads /api/techniques/<id>/stats, which is gated on
// ViewAllStudents server-side. Students never reach this block because the
// BLOCK_VISIBILITY registry filters it out.
export function LibraryStatsBlock() {
  const { technique } = useTechniqueRow();
  const statsQuery = useLibraryTechniqueStats(technique.id);
  const stats = statsQuery.data ?? null;
  const loading = statsQuery.isLoading;

  return (
    <>
      <CollectionsRow stats={stats} />
      <StatsStrip stats={stats} loading={loading} />
    </>
  );
}

function CollectionsRow({ stats }: { stats: LibraryTechniqueStats | null }) {
  return (
    <section className="space-y-2">
      <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Collections
      </h3>
      {stats === null ? (
        <p className="text-xs text-muted-foreground">Loading...</p>
      ) : stats.collections.length === 0 ? (
        <p className="text-xs italic text-muted-foreground">
          Not in any collection yet.
        </p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {stats.collections.map((c) => (
            <Badge key={c.id} variant="outline" asChild>
              <Link to={`/collections/${c.id}`} className="cursor-pointer">
                <FolderOpen className="mr-1 h-3 w-3" aria-hidden />
                {c.name}
              </Link>
            </Badge>
          ))}
        </div>
      )}
    </section>
  );
}

function StatsStrip({
  stats,
  loading,
}: {
  stats: LibraryTechniqueStats | null;
  loading: boolean;
}) {
  return (
    <section className="space-y-2">
      <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Usage
      </h3>
      {loading || !stats ? (
        <div className="h-16 animate-pulse rounded bg-muted/40" />
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <StatusMix counts={stats.status_counts} />
          <AttemptsStat
            total={stats.attempts_30d}
            buckets={stats.attempts_weekly_buckets}
          />
          <PlaysStat plays={stats.video_plays} />
        </div>
      )}
    </section>
  );
}

function StatusMix({
  counts,
}: {
  counts: LibraryTechniqueStats["status_counts"];
}) {
  const total = counts.red + counts.amber + counts.green;
  return (
    <div className="rounded-md border border-border bg-card p-2.5">
      <p className="text-xs text-muted-foreground">Status mix</p>
      {total === 0 ? (
        <p className="mt-1 text-sm italic text-muted-foreground">Not assigned</p>
      ) : (
        <div className="mt-1.5 flex items-center gap-3">
          <Donut counts={counts} />
          <div className="space-y-0.5 text-xs">
            <StatusLine color="bg-status-red" label="Red" value={counts.red} />
            <StatusLine color="bg-status-amber" label="Amber" value={counts.amber} />
            <StatusLine color="bg-status-green" label="Green" value={counts.green} />
          </div>
        </div>
      )}
    </div>
  );
}

function StatusLine({
  color,
  label,
  value,
}: {
  color: string;
  label: string;
  value: number;
}) {
  return (
    <p className="flex items-center gap-1.5">
      <span className={cn("h-1.5 w-1.5 rounded-full", color)} aria-hidden />
      <span className="text-muted-foreground">{label}</span>
      <span className="ml-1 font-medium tabular-nums">{value}</span>
    </p>
  );
}

function Donut({
  counts,
}: {
  counts: LibraryTechniqueStats["status_counts"];
}) {
  const total = counts.red + counts.amber + counts.green;
  const size = 48;
  const stroke = 8;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  if (total === 0) return null;
  const segments = [
    { color: "var(--status-red)", value: counts.red },
    { color: "var(--status-amber)", value: counts.amber },
    { color: "var(--status-green)", value: counts.green },
  ];
  let offset = 0;
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className="shrink-0"
    >
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="var(--muted)"
        strokeWidth={stroke}
      />
      {segments.map((seg, i) => {
        const length = (seg.value / total) * circumference;
        const dashArray = `${length} ${circumference - length}`;
        const rotate = (offset / circumference) * 360 - 90;
        offset += length;
        return (
          <circle
            key={i}
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={seg.color}
            strokeWidth={stroke}
            strokeDasharray={dashArray}
            transform={`rotate(${rotate} ${size / 2} ${size / 2})`}
          />
        );
      })}
    </svg>
  );
}

function AttemptsStat({
  total,
  buckets,
}: {
  total: number;
  buckets: AttemptWeekBucket[];
}) {
  return (
    <div className="rounded-md border border-border bg-card p-2.5">
      <p className="text-xs text-muted-foreground">Attempts · 30d</p>
      <div className="mt-1 flex items-end justify-between gap-2">
        <p className="text-lg font-semibold tabular-nums">{total}</p>
        <Sparkline buckets={buckets} />
      </div>
    </div>
  );
}

function Sparkline({ buckets }: { buckets: AttemptWeekBucket[] }) {
  const weeks = 8;
  const series = useMemo(() => {
    const counts = new Map<string, number>();
    for (const b of buckets) counts.set(b.date, b.count);
    const out: { count: number; key: string }[] = [];
    const monday = isoMondayUtc(new Date());
    for (let i = weeks - 1; i >= 0; i--) {
      const d = new Date(monday);
      d.setUTCDate(d.getUTCDate() - i * 7);
      const key = d.toISOString().slice(0, 10);
      out.push({ key, count: counts.get(key) ?? 0 });
    }
    return out;
  }, [buckets]);

  const max = Math.max(1, ...series.map((s) => s.count));
  const barW = 4;
  const gap = 2;
  const totalW = weeks * (barW + gap) - gap;
  const totalH = 28;
  return (
    <svg
      width={totalW}
      height={totalH}
      viewBox={`0 0 ${totalW} ${totalH}`}
      role="img"
      aria-label={`Attempts per week over the last ${weeks} weeks`}
      className="shrink-0 text-primary"
    >
      {series.map((s, i) => {
        const h = s.count === 0 ? 2 : Math.max(3, (s.count / max) * totalH);
        const x = i * (barW + gap);
        const y = totalH - h;
        return (
          <rect
            key={s.key}
            x={x}
            y={y}
            width={barW}
            height={h}
            rx={1}
            className={s.count > 0 ? "fill-current" : "fill-muted"}
          />
        );
      })}
    </svg>
  );
}

function isoMondayUtc(d: Date): Date {
  const date = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
  );
  const day = date.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  date.setUTCDate(date.getUTCDate() + diff);
  return date;
}

function PlaysStat({ plays }: { plays: number }) {
  return (
    <div className="rounded-md border border-border bg-card p-2.5">
      <p className="text-xs text-muted-foreground">Video plays</p>
      <p className="mt-1 flex items-baseline gap-1.5 text-lg font-semibold tabular-nums">
        {plays}
        <PlayIcon className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
      </p>
    </div>
  );
}
