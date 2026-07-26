import type { ThreadView } from "@/lib/api";

/** How many teaser lines a video tile previews. A fixed budget: the tile never
 *  grows with the conversation, the sheet holds the rest. */
export const TEASER_BUDGET = 2;

/**
 * Which threads a video teaser tile previews, in order. The thread the feed
 * event is about comes first when there is one; the rest fill the budget newest
 * first. A watch or an add carries no focus thread, and previews the newest
 * threads instead: video tiles preview comments even when the event is not one.
 */
export function selectTeaserThreads(
  threads: ThreadView[],
  focusThreadId: number | null,
  budget = TEASER_BUDGET,
): ThreadView[] {
  const newestFirst = [...threads].sort((a, b) => b.created_at.localeCompare(a.created_at));
  const focus =
    focusThreadId != null ? newestFirst.find((t) => t.id === focusThreadId) ?? null : null;
  const rest = newestFirst.filter((t) => t.id !== focus?.id);
  return (focus ? [focus, ...rest] : rest).slice(0, budget);
}

/** Roots plus replies across every thread on the video: what "View all n
 *  comments" counts. */
export function countThreadComments(threads: ThreadView[]): number {
  return threads.reduce((n, t) => n + 1 + t.comments.length, 0);
}

/**
 * Add `?t=` to a feed tile's link so the surface resumes the clip where the
 * feed player is, instead of restarting it. Whole seconds: a fractional value
 * is noise in a shared URL. Returns the href untouched when there is no
 * meaningful position (an embed that cannot report time, or the very start).
 */
export function withResumeParam(
  href: string | null,
  seconds: number,
  canReadTime: boolean,
): string | null {
  if (href == null) return null;
  const whole = Math.floor(seconds);
  if (!canReadTime || !Number.isFinite(whole) || whole <= 0) return href;
  return `${href}${href.includes("?") ? "&" : "?"}t=${whole}`;
}

export interface PinFocusActions {
  /** Leave fullscreen so the feed (stacked below the video) is reachable. */
  exitFullscreen: boolean;
}

/**
 * What to do when a timeline pin is focused. Tapping a pin in fullscreen drills
 * back out to the stacked layout and scrolls to the thread; outside fullscreen
 * the feed is already on screen, so nothing extra is needed.
 */
export function resolvePinFocus(isFullscreen: boolean): PinFocusActions {
  return { exitFullscreen: isFullscreen };
}
