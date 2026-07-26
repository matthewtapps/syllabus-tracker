import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { useSearchParams } from "react-router-dom";
import type { ThreadView } from "@/lib/api";

/** How long a jumped-to thread stays highlighted. */
const HIGHLIGHT_MS = 2200;

/**
 * The `?thread=<id>` deep link: once the surface holding that thread has
 * loaded, hand it to `jump` exactly once, then drop the param so a refresh or a
 * back-forward does not re-trigger it.
 *
 * The feed links here (alongside `?focus=`, which expands the right row), and
 * the surfaces that host threads differ in how they reach one: a technique
 * row's discussion and a student profile scroll a list, a camp scrolls its
 * activity feed to the tile carrying that thread. Only the param handling is
 * common, so that is all this owns; the jump belongs to the surface.
 *
 * A surface that does not hold the target leaves the param alone, so a page
 * with several thread lists still routes one link to one of them.
 */
export function useThreadDeepLink({
  isLoading,
  has,
  jump,
}: {
  isLoading: boolean;
  /** Whether this surface currently holds the thread. */
  has: (threadId: number) => boolean;
  /** Scroll to and highlight it. Called at most once per target. */
  jump: (threadId: number) => void;
}): void {
  const [searchParams, setSearchParams] = useSearchParams();
  const consumedRef = useRef<number | null>(null);

  const raw = searchParams.get("thread");
  const parsed = raw == null ? Number.NaN : Number.parseInt(raw, 10);
  const targetThreadId = Number.isFinite(parsed) ? parsed : null;

  useEffect(() => {
    if (targetThreadId == null || consumedRef.current === targetThreadId) return;
    if (isLoading || !has(targetThreadId)) return;
    consumedRef.current = targetThreadId;
    jump(targetThreadId);
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete("thread");
        return next;
      },
      { replace: true },
    );
  }, [targetThreadId, isLoading, has, jump, setSearchParams]);
}

/**
 * `useThreadDeepLink` for a surface that renders threads as a plain list:
 * scrolls the matching `[data-thread-id]` into view and highlights it briefly.
 * Used by the technique row's discussion and the student profile.
 */
export function useThreadFocus(
  threads: ThreadView[],
  listRef: RefObject<HTMLElement | null>,
  isLoading: boolean,
): { highlightThreadId: number | null } {
  const [highlightThreadId, setHighlightThreadId] = useState<number | null>(null);
  const timerRef = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
    },
    [],
  );

  const has = useCallback((id: number) => threads.some((t) => t.id === id), [threads]);
  const jump = useCallback(
    (id: number) => {
      const el = listRef.current?.querySelector<HTMLElement>(`[data-thread-id="${id}"]`);
      el?.scrollIntoView({ behavior: "smooth", block: "center" });
      setHighlightThreadId(id);
      if (timerRef.current) window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => setHighlightThreadId(null), HIGHLIGHT_MS);
    },
    [listRef],
  );

  useThreadDeepLink({ isLoading, has, jump });

  return { highlightThreadId };
}
