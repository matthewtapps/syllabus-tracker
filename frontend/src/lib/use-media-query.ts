import { useEffect, useState } from "react";

/**
 * Subscribe to a CSS media-query and re-render when it changes. Returns
 * `false` on the first render (SSR-safe default) then settles to the real
 * value after mount.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mql = window.matchMedia(query);
    const update = () => setMatches(mql.matches);
    update();
    mql.addEventListener("change", update);
    return () => mql.removeEventListener("change", update);
  }, [query]);
  return matches;
}
