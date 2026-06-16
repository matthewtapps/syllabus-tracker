import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigationType } from "react-router-dom";
import { useListUrlState } from "@/lib/use-list-url-state";
import { useScrollAnchor } from "@/lib/use-scroll-anchor";
import { scrollToTopWhenStable } from "@/lib/scroll-when-stable";
import type { EntityRef } from "@/lib/entity-ref";

export interface TechniqueListNav<Row> {
  /** Rows after search + tag filtering, in display order. */
  filtered: Row[];
  /** All tag names present across the unfiltered items, sorted. */
  availableTags: string[];
  search: string;
  setSearch: (value: string) => void;
  tags: string[];
  toggleTag: (tag: string) => void;
  clearTags: () => void;
  /** Accordion value derived from ?focus=; setter writes it back. */
  expandedValue: string;
  setExpandedValue: (value: string) => void;
  /** ?video= deep-link target inside the expanded row (null once consumed). */
  videoId: number | null;
  consumeVideo: () => void;
}

interface Options<Row> {
  /** The full, unfiltered list. */
  items: Row[];
  /** The focus/anchor entity kind for this page. */
  kind: "technique" | "sst";
  /** The entity id used in the ?focus=/?at= token (technique.id or sst.id). */
  rowId: (row: Row) => number;
  /** The DOM id of the row element to scroll to (e.g. `technique-row-5`). */
  rowElementId: (row: Row) => string;
  /** Tag names on a row, for the tag filter + availableTags. */
  tagsOf: (row: Row) => string[];
  /** Whether a row matches the (lower-cased, trimmed) search needle. */
  matchesSearch: (row: Row, needle: string) => boolean;
}

function valueFor(kind: "technique" | "sst", id: number): string {
  return kind === "sst" ? `sst-${id}` : String(id);
}

function idFromValue(kind: "technique" | "sst", value: string): number {
  return kind === "sst" ? Number(value.slice(4)) : Number(value);
}

/**
 * Shared URL-backed list behavior for the technique list pages (library,
 * pinned, student-syllabus): search/tags/expansion in the URL, filtering,
 * scroll-to-row on arrival (focus or anchor, skipped on POP where the scroll
 * manager restores pixel position), and a shareable scroll anchor while no row
 * is expanded.
 */
export function useTechniqueListNav<Row>({
  items,
  kind,
  rowId,
  rowElementId,
  tagsOf,
  matchesSearch,
}: Options<Row>): TechniqueListNav<Row> {
  const navType = useNavigationType();
  const { search, setSearch, tags, setTags, focus, setFocus, videoId, anchor } =
    useListUrlState();

  const availableTags = useMemo(() => {
    const set = new Set<string>();
    for (const row of items) for (const t of tagsOf(row)) set.add(t);
    return Array.from(set).sort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items]);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return items.filter(
      (row) =>
        (!needle || matchesSearch(row, needle)) &&
        (tags.length === 0 || tags.every((tag) => tagsOf(row).includes(tag))),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, search, tags]);

  const expandedValue = focus?.type === kind ? valueFor(kind, focus.id) : "";
  const setExpandedValue = (value: string) => {
    if (!value) return setFocus(null);
    const id = idFromValue(kind, value);
    setFocus(Number.isFinite(id) ? { type: kind, id } : null);
  };

  const toggleTag = (tag: string) =>
    setTags(tags.includes(tag) ? tags.filter((t) => t !== tag) : [...tags, tag]);

  const [videoConsumed, setVideoConsumed] = useState(false);

  const anchorRows = useMemo(
    () => filtered.map((row) => ({ elementId: rowElementId(row), token: `${kind}:${rowId(row)}` })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [filtered, kind],
  );
  useScrollAnchor(anchorRows, !focus);

  // Scroll to the focused (expanded) row, or the anchor when none is expanded,
  // once on arrival. Skipped on POP.
  const didScroll = useRef(false);
  useEffect(() => {
    if (didScroll.current || filtered.length === 0) return;
    const ref: EntityRef | null = focus ?? anchor;
    if (!ref || ref.type !== kind) {
      didScroll.current = true;
      return;
    }
    const row = filtered.find((r) => rowId(r) === ref.id);
    if (!row) return;
    didScroll.current = true;
    if (navType === "POP") return;
    requestAnimationFrame(() => {
      const el = document.getElementById(rowElementId(row));
      if (el) scrollToTopWhenStable(el);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered, focus, anchor, navType, kind]);

  return {
    filtered,
    availableTags,
    search,
    setSearch,
    tags,
    toggleTag,
    clearTags: () => setTags([]),
    expandedValue,
    setExpandedValue,
    videoId: videoConsumed ? null : videoId,
    consumeVideo: () => setVideoConsumed(true),
  };
}
