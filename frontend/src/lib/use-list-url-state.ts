import { useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import { parseFocusToken, refToken, type EntityRef } from "./entity-ref";

/**
 * Backs a list page's view state in the URL query string so the view is
 * shareable and restored on back/forward:
 *   - q=<search>
 *   - tags=<comma,separated>
 *   - focus=<type>:<id>  (the expanded row)
 *   - video=<id>         (deep-link to a video inside the expanded row)
 *
 * All writes use `replace` so typing/expanding does not spam history. The
 * caller maps `focus` (an EntityRef) to/from its own accordion value.
 */
export interface ListUrlState {
  search: string;
  setSearch: (value: string) => void;
  tags: string[];
  setTags: (next: string[]) => void;
  focus: EntityRef | null;
  setFocus: (ref: EntityRef | null) => void;
  videoId: number | null;
  /** Top-most visible row (?at=), the shareable scroll anchor. */
  anchor: EntityRef | null;
}

export function useListUrlState(): ListUrlState {
  const [params, setParams] = useSearchParams();

  const search = params.get("q") ?? "";
  const tags = (params.get("tags") ?? "").split(",").filter(Boolean);
  const focus = parseFocusToken(params.get("focus"));
  const anchor = parseFocusToken(params.get("at"));
  const rawVideo = params.get("video");
  const videoId = rawVideo && /^\d+$/.test(rawVideo) ? Number.parseInt(rawVideo, 10) : null;

  const update = useCallback(
    (mutate: (p: URLSearchParams) => void) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          mutate(next);
          return next;
        },
        { replace: true },
      );
    },
    [setParams],
  );

  const setSearch = useCallback(
    (value: string) => update((p) => (value ? p.set("q", value) : p.delete("q"))),
    [update],
  );
  const setTags = useCallback(
    (next: string[]) =>
      update((p) => (next.length ? p.set("tags", next.join(",")) : p.delete("tags"))),
    [update],
  );
  const setFocus = useCallback(
    (ref: EntityRef | null) =>
      update((p) => {
        if (ref) {
          p.set("focus", refToken(ref));
        } else {
          p.delete("focus");
          // The video deep-link only makes sense alongside an expanded row.
          p.delete("video");
        }
      }),
    [update],
  );

  return { search, setSearch, tags, setTags, focus, setFocus, videoId, anchor };
}
