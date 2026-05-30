import { useMemo } from "react";
import type { Attempt } from "@/lib/api";

interface WeeklyAttemptBarsProps {
  attempts: Attempt[];
  /** Number of weekly columns to render, ending at the current week. */
  weeks?: number;
}

const BAR_W = 32;
const GAP = 12;
const COL_W = BAR_W + GAP;
const BAR_H = 120;
const COUNT_H = 18;
const LABEL_H = 16;
const PADDING = 4;

/**
 * Compact bar chart: one bar per week, count above, relative-week label
 * below ("8w", "7w", ..., "now"). Bars are sized linearly against the max
 * count in the visible window, with a 4px floor so non-zero weeks always
 * read as non-empty.
 */
export function WeeklyAttemptBars({
  attempts,
  weeks = 8,
}: WeeklyAttemptBarsProps) {
  const series = useMemo(() => {
    const counts = new Map<string, number>();
    for (const a of attempts) {
      const monday = isoWeekMondayUtc(new Date(a.attempted_at));
      counts.set(
        monday.toISOString().slice(0, 10),
        (counts.get(monday.toISOString().slice(0, 10)) ?? 0) + 1,
      );
    }
    const currentWeek = isoWeekMondayUtc(new Date());
    const out: { count: number; label: string; key: string; range: string }[] = [];
    for (let i = weeks - 1; i >= 0; i--) {
      const start = new Date(currentWeek);
      start.setUTCDate(start.getUTCDate() - i * 7);
      const end = new Date(start);
      end.setUTCDate(end.getUTCDate() + 6);
      const key = start.toISOString().slice(0, 10);
      out.push({
        key,
        count: counts.get(key) ?? 0,
        label: i === 0 ? "now" : `${i}w`,
        range: `${start.toISOString().slice(0, 10)} to ${end
          .toISOString()
          .slice(0, 10)}`,
      });
    }
    return out;
  }, [attempts, weeks]);

  const max = Math.max(1, ...series.map((s) => s.count));
  const totalW = weeks * COL_W - GAP;
  const totalH = COUNT_H + BAR_H + PADDING + LABEL_H;

  return (
    <svg
      width={totalW}
      height={totalH}
      viewBox={`0 0 ${totalW} ${totalH}`}
      role="img"
      aria-label={`Attempts per week over the last ${weeks} weeks`}
      className="text-primary"
    >
      {series.map((s, i) => {
        const drawnHeight = s.count > 0 ? Math.max(4, (s.count / max) * BAR_H) : 2;
        const x = i * COL_W;
        const y = COUNT_H + (BAR_H - drawnHeight);
        return (
          <g key={s.key}>
            {s.count > 0 && (
              <text
                x={x + BAR_W / 2}
                y={y - 4}
                textAnchor="middle"
                fontSize={11}
                fontWeight={500}
                className="fill-foreground"
              >
                {s.count}
              </text>
            )}
            <rect
              x={x}
              y={y}
              width={BAR_W}
              height={drawnHeight}
              rx={3}
              className={s.count > 0 ? "fill-current" : "fill-muted"}
            >
              <title>
                {s.count} {s.count === 1 ? "attempt" : "attempts"} ({s.range})
              </title>
            </rect>
            <text
              x={x + BAR_W / 2}
              y={totalH - 4}
              textAnchor="middle"
              fontSize={10}
              className="fill-muted-foreground"
            >
              {s.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function isoWeekMondayUtc(d: Date): Date {
  const date = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
  );
  const day = date.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  date.setUTCDate(date.getUTCDate() + diff);
  return date;
}
