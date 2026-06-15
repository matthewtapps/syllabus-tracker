/**
 * Whether the theater (comments-beside-video) layout should be shown.
 * `canTheater` reflects available room (landscape video + wide viewport).
 * `pref` is the user's explicit choice: `null` means auto (follow the room).
 */
export function effectiveTheater(canTheater: boolean, pref: boolean | null): boolean {
  return canTheater && (pref ?? true);
}

export interface PinFocusActions {
  /** Leave fullscreen so the feed (beside the video) is reachable. */
  exitFullscreen: boolean;
  /** Force the theater layout on so the focused thread is visible. */
  forceTheater: boolean;
}

/**
 * What to do when a timeline pin is focused. Tapping a pin in fullscreen drills
 * out to the theater layout and scrolls to the thread; outside fullscreen the
 * panel already shows the feed, so neither action is needed.
 */
export function resolvePinFocus(isFullscreen: boolean): PinFocusActions {
  return { exitFullscreen: isFullscreen, forceTheater: isFullscreen };
}
