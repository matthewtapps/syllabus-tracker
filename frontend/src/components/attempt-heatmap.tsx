import { useMemo } from "react";
import type { AttemptBucket } from "@/lib/api";

interface AttemptHeatmapProps {
  buckets: AttemptBucket[];
  /** Number of weeks (columns) to show; defaults to 52. */
  weeks?: number;
}

const CELL = 11;
const GAP = 2;
const DAY_LABELS = ["Mon", "Wed", "Fri"];

/**
 * GitHub-style activity grid. Reads attempts keyed by `YYYY-MM-DD` and lays
 * them out as `weeks` columns of 7 days (Mon-top, Sun-bottom). Counts beyond
 * 4 saturate to the darkest intensity bucket.
 */
export function AttemptHeatmap({ buckets, weeks = 52 }: AttemptHeatmapProps) {
  const today = useMemo(() => startOfUtcDay(new Date()), []);
  const start = useMemo(() => {
    // Anchor to the Monday at the start of the visible range.
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() - (weeks * 7 - 1));
    const day = d.getUTCDay();
    const diff = day === 0 ? -6 : 1 - day;
    d.setUTCDate(d.getUTCDate() + diff);
    return d;
  }, [today, weeks]);

  const lookup = useMemo(() => {
    const m = new Map<string, number>();
    for (const b of buckets) m.set(b.date, b.count);
    return m;
  }, [buckets]);

  const cells: { date: string; count: number; row: number; col: number }[] = [];
  for (let col = 0; col < weeks; col++) {
    for (let row = 0; row < 7; row++) {
      const d = new Date(start);
      d.setUTCDate(d.getUTCDate() + col * 7 + row);
      if (d > today) continue;
      const key = d.toISOString().slice(0, 10);
      cells.push({
        date: key,
        count: lookup.get(key) ?? 0,
        row,
        col,
      });
    }
  }

  const width = weeks * (CELL + GAP);
  const height = 7 * (CELL + GAP);

  return (
    <div className="overflow-x-auto">
      <svg
        width={width}
        height={height + 14}
        viewBox={`0 0 ${width + 28} ${height + 14}`}
        role="img"
        aria-label="Attempt activity over the last year"
      >
        {DAY_LABELS.map((label, i) => (
          <text
            key={label}
            x={0}
            y={(i * 2 + 1) * (CELL + GAP) + CELL - 2}
            fontSize={9}
            fill="currentColor"
            className="text-muted-foreground"
          >
            {label}
          </text>
        ))}
        <g transform="translate(24, 0)">
          {cells.map((cell) => (
            <rect
              key={`${cell.col}-${cell.row}`}
              x={cell.col * (CELL + GAP)}
              y={cell.row * (CELL + GAP)}
              width={CELL}
              height={CELL}
              rx={2}
              className={intensityClass(cell.count)}
            >
              <title>
                {cell.count} {cell.count === 1 ? "attempt" : "attempts"} on{" "}
                {cell.date}
              </title>
            </rect>
          ))}
        </g>
      </svg>
    </div>
  );
}

function intensityClass(count: number): string {
  if (count <= 0) return "fill-muted-foreground/15";
  if (count === 1) return "fill-primary/30";
  if (count === 2) return "fill-primary/55";
  if (count === 3) return "fill-primary/75";
  return "fill-primary";
}

function startOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}
