export interface PlayerEvents {
  onPlay?: () => void;
  onProgress?: (currentTime: number, duration: number) => void;
  onEnded?: () => void;
  onOpened?: () => void;
  /** Fired on play/pause transitions so the review surface can track state. */
  onPaused?: (paused: boolean) => void;
  /** Player hands up a seek function; absent for embeds that cannot seek. */
  registerSeek?: (fn: (seconds: number) => void) => void;
  /** Player hands up a fullscreen-exit function; absent for embeds. */
  registerExitFullscreen?: (fn: () => void) => void;
  /** Fired when the player enters/leaves fullscreen. */
  onFullscreenChange?: (fullscreen: boolean) => void;
}
