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
