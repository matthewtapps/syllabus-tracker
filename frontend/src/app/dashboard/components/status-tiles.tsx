import { cn } from "@/lib/utils";
import {
  STATUS_LABELS,
  STATUS_VALUES,
  statusToDotClass,
  statusToTextClass,
  type Status,
} from "@/lib/status";

interface StatusTilesProps {
  counts: Record<Status, number>;
  total?: number;
  className?: string;
}

export function StatusTiles({ counts, total, className }: StatusTilesProps) {
  const resolvedTotal = total ?? counts.red + counts.amber + counts.green;

  return (
    <div className={cn("grid grid-cols-3 gap-3 sm:gap-4", className)}>
      {STATUS_VALUES.map((status) => {
        const count = counts[status];
        const pct =
          resolvedTotal > 0 ? Math.round((count / resolvedTotal) * 100) : 0;
        return (
          <div
            key={status}
            className="rounded-lg border border-border bg-card p-4 sm:p-5"
          >
            <div className="flex items-center gap-2">
              <span
                className={cn("h-2 w-2 rounded-full", statusToDotClass(status))}
                aria-hidden
              />
              <span
                className={cn(
                  "text-xs font-medium uppercase tracking-wide",
                  statusToTextClass(status),
                )}
              >
                {STATUS_LABELS[status]}
              </span>
            </div>
            <div className="mt-2 flex items-baseline gap-2">
              <span className="text-3xl font-semibold tabular-nums sm:text-4xl">
                {count}
              </span>
              {resolvedTotal > 0 && (
                <span className="text-xs text-muted-foreground">{pct}%</span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
