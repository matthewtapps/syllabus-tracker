import { useEffect, useRef, useState, type RefObject } from "react";
import { useSearchParams } from "react-router-dom";
import type { ThreadView } from "@/lib/api";

/** How long a scrolled-to thread stays highlighted. */
const HIGHLIGHT_MS = 2200;

/**
 * The `?thread=<id>` deep link: scroll to that thread once its list has mounted,
 * highlight it briefly, then drop the param so a refresh or a back-forward does
 * not re-trigger it.
 *
 * The feed links here (alongside `?focus=`, which expands the right row). Two
 * surfaces host a thread list this way: a technique row's discussion and a
 * student profile. They resolve the param the same way, so the behaviour lives
 * here once instead of being re-derived per surface. (A camp's threads live in
 * its activity feed, which has no such list to scroll.)
 *
 * Only the surface whose list actually contains the target consumes the param;
 * the others leave it alone, so a page with several thread lists still routes
 * one link to one list.
 */
export function useThreadFocus(
  threads: ThreadView[],
  listRef: RefObject<HTMLElement | null>,
  isLoading: boolean,
): { highlightThreadId: number | null } {
  const [searchParams, setSearchParams] = useSearchParams();
  const [highlightThreadId, setHighlightThreadId] = useState<number | null>(null);
  // The thread we already scrolled to, so a refetch does not re-scroll it.
  const consumedTargetRef = useRef<number | null>(null);

  const raw = searchParams.get("thread");
  const parsed = raw == null ? Number.NaN : Number.parseInt(raw, 10);
  const targetThreadId = Number.isFinite(parsed) ? parsed : null;

  useEffect(() => {
    if (
      targetThreadId == null ||
      consumedTargetRef.current === targetThreadId ||
      isLoading
    ) {
      return;
    }
    if (!threads.some((t) => t.id === targetThreadId)) return;
    const el = listRef.current?.querySelector<HTMLElement>(
      `[data-thread-id="${targetThreadId}"]`,
    );
    if (!el) return;
    consumedTargetRef.current = targetThreadId;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    setHighlightThreadId(targetThreadId);
    const timer = setTimeout(() => setHighlightThreadId(null), HIGHLIGHT_MS);
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete("thread");
        return next;
      },
      { replace: true },
    );
    return () => clearTimeout(timer);
  }, [targetThreadId, isLoading, threads, listRef, setSearchParams]);

  return { highlightThreadId };
}
