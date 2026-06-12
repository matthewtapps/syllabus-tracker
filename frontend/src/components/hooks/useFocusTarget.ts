import { useEffect, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { parseFocusToken, type EntityRef } from "@/lib/entity-ref";

interface UseFocusTargetArgs {
  /** True once the list/data needed to act on the focus is loaded. */
  ready: boolean;
  /** Called once, with the parsed ref and the optional &video=<id>. Return
   *  true if the focus was consumed (the params are then stripped). */
  onFocus: (ref: EntityRef, videoId: number | null) => boolean;
}

/**
 * Reads `?focus=<type>:<id>` (and optional `&video=<id>`), invokes onFocus once
 * when ready, and strips the consumed params so back/forward does not re-fire.
 */
export function useFocusTarget({ ready, onFocus }: UseFocusTargetArgs): void {
  const [searchParams, setSearchParams] = useSearchParams();
  const consumedRef = useRef(false);

  useEffect(() => {
    if (consumedRef.current || !ready) return;
    const ref = parseFocusToken(searchParams.get("focus"));
    if (!ref) return;
    const rawVideo = searchParams.get("video");
    const videoId = rawVideo && /^\d+$/.test(rawVideo) ? Number.parseInt(rawVideo, 10) : null;
    const consumed = onFocus(ref, videoId);
    if (!consumed) return;
    consumedRef.current = true;
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete("focus");
        next.delete("video");
        return next;
      },
      { replace: true },
    );
  }, [ready, searchParams, setSearchParams, onFocus]);
}
