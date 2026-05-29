import { cn } from "@/lib/utils";

export interface DonutSegment {
  value: number;
  color: string;
  label: string;
}

interface DonutChartProps {
  segments: DonutSegment[];
  size?: number;
  thickness?: number;
  centerLabel?: string;
  centerSubLabel?: string;
  className?: string;
  ariaLabel?: string;
}

/**
 * Compact SVG donut chart. Segments are drawn proportional to their value;
 * empty segments are skipped. Uses CSS custom properties for colors so callers
 * pass `var(--status-...)` strings.
 */
export function DonutChart({
  segments,
  size = 140,
  thickness = 16,
  centerLabel,
  centerSubLabel,
  className,
  ariaLabel,
}: DonutChartProps) {
  const total = segments.reduce((acc, s) => acc + s.value, 0);
  const radius = 50 - thickness / 2;
  const circumference = 2 * Math.PI * radius;

  let cumulative = 0;

  return (
    <div
      className={cn("relative inline-flex items-center justify-center", className)}
      style={{ width: size, height: size }}
      role="img"
      aria-label={ariaLabel ?? (centerLabel ? `${centerLabel} ${centerSubLabel ?? ""}` : "Donut chart")}
    >
      <svg viewBox="0 0 100 100" width={size} height={size} className="-rotate-90">
        <circle
          cx="50"
          cy="50"
          r={radius}
          fill="none"
          stroke="var(--muted)"
          strokeWidth={thickness}
        />
        {total > 0 &&
          segments.map((seg, i) => {
            if (seg.value <= 0) return null;
            const arc = (seg.value / total) * circumference;
            const offset = (cumulative / total) * circumference;
            cumulative += seg.value;
            return (
              <circle
                key={i}
                cx="50"
                cy="50"
                r={radius}
                fill="none"
                stroke={seg.color}
                strokeWidth={thickness}
                strokeDasharray={`${arc} ${circumference - arc}`}
                strokeDashoffset={-offset}
                strokeLinecap="butt"
              />
            );
          })}
      </svg>
      {(centerLabel || centerSubLabel) && (
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          {centerLabel && (
            <span className="text-2xl font-semibold tabular-nums">{centerLabel}</span>
          )}
          {centerSubLabel && (
            <span className="text-xs uppercase tracking-wide text-muted-foreground">
              {centerSubLabel}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
