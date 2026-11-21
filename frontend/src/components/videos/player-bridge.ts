import type { PlayerEvents } from "./player-events";

/** Minimal slice of Vidstack player state the bridge needs. */
export interface PlayerSnapshot {
  currentTime: number;
  duration: number;
  paused: boolean;
}

/**
 * Map a player state snapshot to PlayerEvents calls. Returns the next value of
 * the one-shot `started` flag, which gates the single onPlay() watch event so it
 * fires once per playback session rather than on every unpause.
 */
export function applySnapshot(
  snap: PlayerSnapshot,
  events: PlayerEvents | undefined,
  started: boolean,
): boolean {
  if (Number.isFinite(snap.duration) && snap.duration > 0) {
    events?.onProgress?.(snap.currentTime, snap.duration);
  }
  events?.onPaused?.(snap.paused);
  if (!snap.paused && !started) {
    events?.onPlay?.();
    return true;
  }
  return started;
}
