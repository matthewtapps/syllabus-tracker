import { cn } from "@/lib/utils";
import {
  STATUS_LABELS,
  STATUS_VALUES,
  statusToDotClass,
  type Status,
} from "@/lib/status";
import { DonutChart, type DonutSegment } from "@/components/donut-chart";

interface StatusDonutProps {
  counts: Record<Status, number>;
  className?: string;
}

const STATUS_COLORS: Record<Status, string> = {
  red: "var(--status-red)",
  amber: "var(--status-amber)",
  green: "var(--status-green)",
};

export function StatusDonut({ counts, className }: StatusDonutProps) {
  const total = counts.red + counts.amber + counts.green;
  const pctDone = total > 0 ? Math.round((counts.green / total) * 100) : 0;

  const segments: DonutSegment[] = STATUS_VALUES.map((s) => ({
    value: counts[s],
    color: STATUS_COLORS[s],
    label: STATUS_LABELS[s],
  }));

  return (
    <div
      className={cn(
        "flex flex-col items-center gap-5 rounded-lg border border-border bg-card p-5 sm:flex-row sm:gap-8 sm:px-8",
        className,
      )}
    >
      <DonutChart
        segments={segments}
        centerLabel={`${pctDone}%`}
        centerSubLabel="done"
        size={156}
        thickness={18}
        ariaLabel={`${pctDone}% done across ${total} techniques`}
      />
      <ul className="w-full max-w-xs space-y-2.5">
        {STATUS_VALUES.map((s) => {
          const count = counts[s];
          const pct = total > 0 ? Math.round((count / total) * 100) : 0;
          return (
            <li key={s} className="flex items-center gap-3">
              <span
                className={cn("h-2.5 w-2.5 shrink-0 rounded-full", statusToDotClass(s))}
                aria-hidden
              />
              <span className="text-sm font-medium">{STATUS_LABELS[s]}</span>
              <span className="ml-auto flex items-baseline gap-2 tabular-nums">
                <span className="text-sm font-semibold">{count}</span>
                <span className="text-xs text-muted-foreground">{pct}%</span>
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
