import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { useSearchParams } from "react-router-dom";
import { campComponentKey, componentKey } from "@/components/camps/component-key";
import { useThreadDeepLink } from "@/components/threads/use-thread-focus";
import type { CampComponent } from "@/lib/api";

/** How long a jumped-to component stays ringed. */
const HIGHLIGHT_MS = 2200;

export interface CampAnchors {
  /** The component to ring right now, if any. */
  highlightKey: string | null;
  /** The component the URL addresses, which owns `?video=` and `?t=`. */
  anchorKey: string | null;
  videoId: number | null;
  resumeSeconds: number | null;
  /** Scroll to the component holding this thread. Used by camp search. */
  jumpToThread: (threadId: number) => void;
  /** Scroll to a camp-owned clip's component. Used by camp search. */
  jumpToVideo: (videoId: number) => void;
}

/**
 * The camp page's deep links, all of which land on a component: `?thread=` from
 * a feed teaser or camp search, `?technique=` and `?video=` from a tile that
 * named one item inside the camp.
 *
 * `?thread=` is consumed and dropped so a refresh does not re-jump;
 * `?technique=`/`?video=` stay, because `?video=` and `?t=` keep driving the
 * clip inside the component they addressed.
 */
export function useCampAnchors(
  components: CampComponent[],
  isLoading: boolean,
  listRef: RefObject<HTMLElement | null>,
): CampAnchors {
  const [params] = useSearchParams();
  const [highlightKey, setHighlightKey] = useState<string | null>(null);
  const timerRef = useRef<number | null>(null);
  const consumedRef = useRef<string | null>(null);

  useEffect(
    () => () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
    },
    [],
  );

  const jumpToKey = useCallback(
    (key: string) => {
      const el = listRef.current?.querySelector<HTMLElement>(
        `[data-component-key="${key}"]`,
      );
      if (!el) return;
      el.scrollIntoView({ behavior: "smooth", block: "start" });
      setHighlightKey(key);
      if (timerRef.current) window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => setHighlightKey(null), HIGHLIGHT_MS);
    },
    [listRef],
  );

  // A thread is either a note component or part of one component's discussion.
  const keyForThread = useCallback(
    (threadId: number) => {
      for (const component of components) {
        if (component.kind === "note" && component.id === threadId) {
          return componentKey(component);
        }
        if (component.threads.some((t) => t.id === threadId)) {
          return componentKey(component);
        }
      }
      return null;
    },
    [components],
  );

  const hasThread = useCallback(
    (threadId: number) => keyForThread(threadId) != null,
    [keyForThread],
  );
  const jumpToThread = useCallback(
    (threadId: number) => {
      const key = keyForThread(threadId);
      if (key) jumpToKey(key);
    },
    [keyForThread, jumpToKey],
  );
  useThreadDeepLink({ isLoading, has: hasThread, jump: jumpToThread });

  const jumpToVideo = useCallback(
    (videoId: number) => jumpToKey(campComponentKey("video", videoId)),
    [jumpToKey],
  );

  const techniqueId = parseIdParam(params.get("technique"));
  const videoId = parseIdParam(params.get("video"));
  const resumeSeconds = parseIdParam(params.get("t"));
  const anchorKey =
    techniqueId != null
      ? campComponentKey("technique", techniqueId)
      : videoId != null
        ? campComponentKey("video", videoId)
        : null;

  useEffect(() => {
    if (anchorKey == null || isLoading) return;
    if (consumedRef.current === anchorKey) return;
    if (!components.some((c) => componentKey(c) === anchorKey)) return;
    consumedRef.current = anchorKey;
    jumpToKey(anchorKey);
  }, [anchorKey, components, isLoading, jumpToKey]);

  return { highlightKey, anchorKey, videoId, resumeSeconds, jumpToThread, jumpToVideo };
}

function parseIdParam(raw: string | null): number | null {
  if (raw == null || !/^\d+$/.test(raw)) return null;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : null;
}
