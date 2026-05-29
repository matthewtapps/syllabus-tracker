import type { AttemptBucket } from "@/lib/api";

interface AttemptSparklineProps {
  buckets: AttemptBucket[];
  weeks: number;
}

/**
 * Compact weekly bar chart. We always render `weeks` columns ending at the
 * current ISO week so the row never collapses to a single bar.
 */
export function AttemptSparkline({ buckets, weeks }: AttemptSparklineProps) {
  const seriesEnd = isoWeekMonday(new Date());
  const series: number[] = [];
  const byDate = new Map(buckets.map((b) => [b.date, b.count]));
  for (let i = weeks - 1; i >= 0; i--) {
    const d = new Date(seriesEnd);
    d.setUTCDate(d.getUTCDate() - i * 7);
    const key = d.toISOString().slice(0, 10);
    series.push(byDate.get(key) ?? 0);
  }
  const max = Math.max(1, ...series);
  const width = weeks * 6 + (weeks - 1) * 2;
  const height = 24;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      aria-label={`Attempts over the last ${weeks} weeks`}
      className="shrink-0 text-primary"
    >
      {series.map((value, i) => {
        const x = i * 8;
        const h = (value / max) * height;
        return (
          <rect
            key={i}
            x={x}
            y={height - h}
            width={6}
            height={h || 1}
            rx={1}
            className={value > 0 ? "fill-current" : "fill-muted-foreground/30"}
          />
        );
      })}
    </svg>
  );
}

function isoWeekMonday(d: Date): Date {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = date.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  date.setUTCDate(date.getUTCDate() + diff);
  return date;
}
