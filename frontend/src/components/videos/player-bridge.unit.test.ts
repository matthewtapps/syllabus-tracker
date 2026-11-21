import { describe, it, expect, vi } from "vitest";
import { applySnapshot, type PlayerSnapshot } from "./vidstack-bridge";
import type { PlayerEvents } from "./player-events";

function mkEvents() {
  return {
    onPlay: vi.fn(),
    onProgress: vi.fn(),
    onPaused: vi.fn(),
    onEnded: vi.fn(),
  } satisfies PlayerEvents;
}

const playing: PlayerSnapshot = { currentTime: 5, duration: 60, paused: false };

describe("applySnapshot", () => {
  it("reports progress when duration is finite and positive", () => {
    const e = mkEvents();
    applySnapshot(playing, e, false);
    expect(e.onProgress).toHaveBeenCalledWith(5, 60);
  });

  it("skips progress when duration is not yet known", () => {
    const e = mkEvents();
    applySnapshot({ currentTime: 0, duration: NaN, paused: true }, e, false);
    expect(e.onProgress).not.toHaveBeenCalled();
  });

  it("always reports the paused state", () => {
    const e = mkEvents();
    applySnapshot({ ...playing, paused: true }, e, true);
    expect(e.onPaused).toHaveBeenCalledWith(true);
  });

  it("fires onPlay exactly once: only when unpaused and not yet started", () => {
    const e = mkEvents();
    const after = applySnapshot(playing, e, false);
    expect(e.onPlay).toHaveBeenCalledTimes(1);
    expect(after).toBe(true);
    applySnapshot(playing, e, after);
    expect(e.onPlay).toHaveBeenCalledTimes(1);
  });

  it("does not fire onPlay while paused", () => {
    const e = mkEvents();
    const after = applySnapshot({ ...playing, paused: true }, e, false);
    expect(e.onPlay).not.toHaveBeenCalled();
    expect(after).toBe(false);
  });

  it("tolerates an undefined events object", () => {
    expect(() => applySnapshot(playing, undefined, false)).not.toThrow();
    expect(applySnapshot(playing, undefined, false)).toBe(true);
  });
});
