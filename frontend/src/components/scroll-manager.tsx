import { useEffect, useRef } from "react";
import { useLocation, useNavigationType } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";

export type ScrollAction = "top" | "restore" | "none";

/**
 * What the scroll manager should do for a given navigation type:
 * - PUSH (link/button/breadcrumb): fresh view at the top.
 * - POP (back/forward): restore the prior scroll position.
 * - REPLACE (programmatic, e.g. stripping ?focus=): leave everything as-is.
 */
export function scrollActionFor(navType: "POP" | "PUSH" | "REPLACE"): ScrollAction {
  if (navType === "PUSH") return "top";
  if (navType === "POP") return "restore";
  return "none";
}

/**
 * Window scroll restoration for the component router (which has no built-in
 * <ScrollRestoration>). Restores pixel position on back/forward, resets to the
 * top on link/button navigation, and refetches active queries on PUSH so a
 * button-navigated view feels fresh rather than stale.
 */
export function ScrollManager() {
  const location = useLocation();
  const navType = useNavigationType();
  const queryClient = useQueryClient();
  const positions = useRef<Map<string, number>>(new Map());
  const currentKey = useRef(location.key);

  // Continuously record the current history entry's scroll position (rAF-throttled).
  useEffect(() => {
    let frame = 0;
    const onScroll = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        positions.current.set(currentKey.current, window.scrollY);
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, []);

  useEffect(() => {
    currentKey.current = location.key;
    const action = scrollActionFor(navType);
    if (action === "none") return;
    if (action === "top") {
      window.scrollTo(0, 0);
      // Button/link navigation should show fresh data, not a stale cache.
      queryClient.invalidateQueries({ refetchType: "active" });
      return;
    }
    // restore (POP): jump to the saved position after paint, with one short
    // retry in case async data grew the page after the first attempt.
    const saved = positions.current.get(location.key) ?? 0;
    const restore = () => window.scrollTo(0, saved);
    const frame = window.requestAnimationFrame(restore);
    const timer = window.setTimeout(restore, 120);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(timer);
    };
  }, [location.key, navType, queryClient]);

  return null;
}
