import { useEffect, useRef } from "react";
import { useSearchParams } from "react-router-dom";

export interface AnchorRow {
  /** DOM id of the row element (e.g. `technique-row-5`). */
  elementId: string;
  /** Entity token written to `?at=` (e.g. `technique:5` or `sst:42`). */
  token: string;
}

/** Header offset (px) below which a row counts as "the top-most visible one". */
const TOP_OFFSET = 80;

/**
 * Writes the top-most visible row to `?at=<token>` (replace, debounced) so the
 * scroll position is shareable as a robust anchor rather than a brittle pixel
 * offset. Pass `enabled = false` while a row is expanded (the `?focus=` row is
 * the shareable position then).
 */
export function useScrollAnchor(rows: AnchorRow[], enabled: boolean): void {
  const [, setParams] = useSearchParams();
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const lastToken = useRef<string | null>(null);

  useEffect(() => {
    if (!enabled || rows.length === 0) return;

    let timer: number | undefined;
    const writeTopmost = () => {
      let best: { token: string; top: number } | null = null;
      for (const r of rowsRef.current) {
        const el = document.getElementById(r.elementId);
        if (!el) continue;
        const top = el.getBoundingClientRect().top;
        if (top <= TOP_OFFSET) {
          // The last row that is still at/above the header line is the topmost.
          if (!best || top > best.top) best = { token: r.token, top };
        } else if (!best) {
          // Nothing has crossed the line yet (scrolled to the very top); the
          // first row below it is the anchor.
          best = { token: r.token, top };
          break;
        }
      }
      if (!best || best.token === lastToken.current) return;
      lastToken.current = best.token;
      const token = best.token;
      setParams(
        (prev) => {
          if (prev.get("at") === token) return prev;
          const next = new URLSearchParams(prev);
          next.set("at", token);
          return next;
        },
        { replace: true },
      );
    };

    const onScroll = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(writeTopmost, 250);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.clearTimeout(timer);
    };
  }, [enabled, rows.length, setParams]);
}
