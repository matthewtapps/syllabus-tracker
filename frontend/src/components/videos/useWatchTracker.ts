import { useCallback, useEffect, useRef } from "react";
import type { PlayerEvents } from "./player-events";

export interface WatchContext {
  technique_id: number;
  syllabus_id?: number;
  sst_id?: number;
}

interface WatchEventPayload {
  event: string;
  seconds_watched?: number;
}

interface PendingState {
  playId: string;
  buffer: WatchEventPayload[];
  emittedThresholds: Set<string>;
  startedFired: boolean;
  completedFired: boolean;
  maxSeconds: number;
  lastFlushedSeconds: number;
}

const FLUSH_DEBOUNCE_MS = 5_000;
const PROGRESS_THRESHOLDS: Array<{ ratio: number; event: string }> = [
  { ratio: 0.25, event: "progress_25" },
  { ratio: 0.5, event: "progress_50" },
  { ratio: 0.75, event: "progress_75" },
];

function generatePlayId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `play-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function endpoint(videoId: number): string {
  return `/api/videos/${videoId}/watch-events`;
}

export function useWatchTracker(videoId: number, context?: WatchContext): PlayerEvents {
  const stateRef = useRef<PendingState>({
    playId: generatePlayId(),
    buffer: [],
    emittedThresholds: new Set(),
    startedFired: false,
    completedFired: false,
    maxSeconds: 0,
    lastFlushedSeconds: 0,
  });
  const flushTimerRef = useRef<number | null>(null);
  const contextRef = useRef(context);
  useEffect(() => {
    contextRef.current = context;
  }, [context]);

  const flush = useCallback(
    (useBeacon: boolean = false) => {
      const state = stateRef.current;
      if (state.buffer.length === 0) return;
      const ctx = contextRef.current;
      const payload = {
        play_id: state.playId,
        events: state.buffer,
        ...(ctx ? { context: ctx } : {}),
      };
      state.buffer = [];
      state.lastFlushedSeconds = state.maxSeconds;
      if (flushTimerRef.current) {
        window.clearTimeout(flushTimerRef.current);
        flushTimerRef.current = null;
      }
      const body = JSON.stringify(payload);
      if (useBeacon && typeof navigator !== "undefined" && navigator.sendBeacon) {
        const blob = new Blob([body], { type: "application/json" });
        navigator.sendBeacon(endpoint(videoId), blob);
        return;
      }
      // Fire and forget. We do not surface ingestion errors to the user.
      fetch(endpoint(videoId), {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body,
        keepalive: true,
      }).catch((err) => {
        console.warn("watch event flush failed", err);
      });
    },
    [videoId],
  );

  const scheduleFlush = useCallback(() => {
    if (flushTimerRef.current) window.clearTimeout(flushTimerRef.current);
    flushTimerRef.current = window.setTimeout(() => {
      flush(false);
    }, FLUSH_DEBOUNCE_MS);
  }, [flush]);

  const buffer = useCallback(
    (event: WatchEventPayload) => {
      stateRef.current.buffer.push(event);
      scheduleFlush();
    },
    [scheduleFlush],
  );

  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === "hidden") flush(true);
    };
    const handlePageHide = () => flush(true);
    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("pagehide", handlePageHide);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("pagehide", handlePageHide);
      flush(true);
    };
  }, [flush]);

  useEffect(() => {
    stateRef.current = {
      playId: generatePlayId(),
      buffer: [],
      emittedThresholds: new Set(),
      startedFired: false,
      completedFired: false,
      maxSeconds: 0,
      lastFlushedSeconds: 0,
    };
  }, [videoId]);

  const onPlay = useCallback(() => {
    const state = stateRef.current;
    if (state.startedFired) return;
    state.startedFired = true;
    buffer({ event: "started" });
  }, [buffer]);

  const onProgress = useCallback(
    (currentTime: number, duration: number) => {
      const state = stateRef.current;
      if (!Number.isFinite(duration) || duration <= 0) return;
      const seconds = Math.max(0, Math.floor(currentTime));
      if (seconds > state.maxSeconds) {
        state.maxSeconds = seconds;
      }
      for (const threshold of PROGRESS_THRESHOLDS) {
        if (state.emittedThresholds.has(threshold.event)) continue;
        if (currentTime >= duration * threshold.ratio) {
          state.emittedThresholds.add(threshold.event);
          buffer({
            event: threshold.event,
            seconds_watched: state.maxSeconds,
          });
        }
      }
    },
    [buffer],
  );

  const onEnded = useCallback(() => {
    const state = stateRef.current;
    if (state.completedFired) return;
    state.completedFired = true;
    buffer({
      event: "completed",
      seconds_watched: state.maxSeconds,
    });
    flush(false);
  }, [buffer, flush]);

  const onOpened = useCallback(() => {
    buffer({ event: "opened" });
    flush(false);
  }, [buffer, flush]);

  return { onPlay, onProgress, onEnded, onOpened };
}
