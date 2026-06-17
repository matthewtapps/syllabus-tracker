import type { ActivityRow } from "./activity-line";

/** A quick hide-then-unhide (coach fixing a mis-click) within this window is
 *  treated as an undo: the unhide is suppressed. */
export const HIDE_UNHIDE_UNDO_MS = 10 * 60 * 1000;

/** An unhide followed by a re-hide of the same technique within this (wider)
 *  window ends net-hidden, so the unhide is suppressed. */
export const UNHIDE_REHIDE_MS = 24 * 60 * 60 * 1000;

function ms(iso: string): number {
  return Date.parse(iso);
}

/**
 * Drop hide/unhide curation noise from a feed by net visibility. Pure; preserves
 * input order. Pairs on `sst_id` (the hidden/unhidden subject), independent of
 * actor.
 *
 * - Every `sst_hidden` row is removed (hiding is never feed-worthy).
 * - An `sst_unhidden` row is removed when a same-`sst_id` `sst_hidden` exists
 *   within UNDO_MS *before* it (quick mistake) or within REHIDE_MS *after* it
 *   (re-hidden, net hidden). Otherwise it survives as a genuine "made visible".
 */
export function suppressHideUnhide(rows: ActivityRow[]): ActivityRow[] {
  const hidesBySst = new Map<number, number[]>();
  for (const row of rows) {
    if (row.verb === "sst_hidden" && row.sst_id != null) {
      const list = hidesBySst.get(row.sst_id) ?? [];
      list.push(ms(row.occurred_at));
      hidesBySst.set(row.sst_id, list);
    }
  }

  return rows.filter((row) => {
    if (row.verb === "sst_hidden") return false;
    if (row.verb === "sst_unhidden") {
      if (row.sst_id == null) return true;
      const unhideAt = ms(row.occurred_at);
      const hides = hidesBySst.get(row.sst_id) ?? [];
      const paired = hides.some((hideAt) => {
        if (hideAt <= unhideAt) return unhideAt - hideAt <= HIDE_UNHIDE_UNDO_MS;
        return hideAt - unhideAt <= UNHIDE_REHIDE_MS;
      });
      return !paired;
    }
    return true;
  });
}
