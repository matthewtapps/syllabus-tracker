import { StudentAvatar } from "@/components/student-avatar";
import { formatTimestamp } from "@/lib/dates";
import type { ThreadView } from "@/lib/api";

const LEAD_IN = 3;
const LEAD_OUT = 3;

/**
 * The timestamped thread whose display window [t-LEAD_IN, t+LEAD_OUT] contains
 * `currentTime`. When several overlap, the one whose anchor is nearest to
 * `currentTime` wins. Returns null when none are active.
 */
export function activeMoment(threads: ThreadView[], currentTime: number, leadIn = LEAD_IN, leadOut = LEAD_OUT): ThreadView | null {
  let best: ThreadView | null = null;
  let bestDist = Infinity;
  for (const t of threads) {
    if (t.video_ts_seconds == null) continue;
    const s = t.video_ts_seconds;
    if (currentTime >= s - leadIn && currentTime <= s + leadOut) {
      const dist = Math.abs(currentTime - s);
      if (dist < bestDist) {
        best = t;
        bestDist = dist;
      }
    }
  }
  return best;
}

interface MomentOverlayProps {
  threads: ThreadView[];
  currentTime: number;
  /** A pin/feed selection forces this thread to show, overriding the window. */
  pinnedThread: ThreadView | null;
  onOpen: (thread: ThreadView) => void;
}

export function MomentOverlay({ threads, currentTime, pinnedThread, onOpen }: MomentOverlayProps) {
  const moment = pinnedThread ?? activeMoment(threads, currentTime);
  if (!moment || moment.body == null) return null;
  return (
    <button
      type="button"
      onClick={() => onOpen(moment)}
      className="absolute inset-x-0 bottom-0 flex items-end gap-2 bg-gradient-to-t from-black/75 via-black/30 to-transparent px-3 pb-5 pt-8 text-left"
    >
      <StudentAvatar id={moment.author_id} name={moment.author_name} size="sm" />
      <div className="min-w-0 flex-1 [text-shadow:0_1px_3px_rgba(0,0,0,0.85)]">
        <div className="text-xs font-bold text-white">
          {moment.author_name}
          <span className="ml-1.5 font-semibold tabular-nums text-violet-300">
            {formatTimestamp(moment.video_ts_seconds as number)}
          </span>
        </div>
        <div className="line-clamp-2 text-[13px] text-zinc-100">{moment.body}</div>
      </div>
    </button>
  );
}
