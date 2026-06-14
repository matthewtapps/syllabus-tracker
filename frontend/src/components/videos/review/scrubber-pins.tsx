import { formatTimestamp } from "@/lib/dates";
import { cn } from "@/lib/utils";
import type { ThreadView } from "@/lib/api";

export interface PinGroup {
  /** Position along the track, 0..1. */
  position: number;
  threads: ThreadView[];
}

/**
 * Group timestamped threads into pins, merging any whose track positions are
 * within `gapFraction` of each other (so dense comments do not overlap).
 * Threads without seconds, and any input when duration <= 0, yield no pins.
 */
export function clusterPins(
  threads: ThreadView[],
  duration: number,
  gapFraction: number,
): PinGroup[] {
  if (duration <= 0) return [];
  const stamped = threads
    .filter((t) => t.video_ts_seconds != null)
    .map((t) => ({ t, pos: (t.video_ts_seconds as number) / duration }))
    .sort((a, b) => a.pos - b.pos);

  const groups: PinGroup[] = [];
  for (const { t, pos } of stamped) {
    const last = groups[groups.length - 1];
    if (last && pos - last.position <= gapFraction) {
      last.threads.push(t);
    } else {
      groups.push({ position: pos, threads: [t] });
    }
  }
  return groups;
}

interface ScrubberPinsProps {
  threads: ThreadView[];
  duration: number;
  activeThreadId: number | null;
  onPinClick: (thread: ThreadView) => void;
  onClusterClick: (threads: ThreadView[]) => void;
}

export function ScrubberPins({
  threads,
  duration,
  activeThreadId,
  onPinClick,
  onClusterClick,
}: ScrubberPinsProps) {
  const groups = clusterPins(threads, duration, 0.04);
  return (
    <div className="pointer-events-none absolute inset-0">
      {groups.map((g, i) => {
        const isCluster = g.threads.length > 1;
        const active =
          activeThreadId != null &&
          g.threads.some((t) => t.id === activeThreadId);
        const label = isCluster
          ? `${g.threads.length} comments`
          : `comment at ${formatTimestamp(g.threads[0].video_ts_seconds as number)}`;
        return (
          <button
            key={i}
            type="button"
            aria-label={label}
            onClick={() =>
              isCluster ? onClusterClick(g.threads) : onPinClick(g.threads[0])
            }
            style={{ left: `${g.position * 100}%` }}
            className="pointer-events-auto absolute top-1/2 flex h-7 w-7 -translate-x-1/2 -translate-y-1/2 items-center justify-center"
          >
            <span
              className={cn(
                "rounded-full border-2 border-black bg-primary",
                isCluster
                  ? "flex h-3.5 min-w-[1.25rem] items-center justify-center px-1 text-[9px] font-bold text-white"
                  : "h-3 w-3",
                active && "bg-white ring-2 ring-primary",
              )}
            >
              {isCluster ? g.threads.length : null}
            </span>
          </button>
        );
      })}
    </div>
  );
}
