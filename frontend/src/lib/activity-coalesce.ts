import type { ActivityRow } from "./activity-line";

export interface CoalescedActivity {
  /** The representative (most recent) row of the group. */
  row: ActivityRow;
  /** How many rows were merged (1 = no coalescing). */
  count: number;
  /** Distinct other technique names in the group, for "and N more" copy. */
  extraTechniques: string[];
}

/**
 * Collapse runs of consecutive rows that share actor + verb into one entry, so
 * one keen student does not flood the feed. Input must already be sorted newest
 * first (as the feed endpoint returns it).
 */
export function coalesceActivity(rows: ActivityRow[]): CoalescedActivity[] {
  const out: CoalescedActivity[] = [];
  for (const row of rows) {
    const last = out[out.length - 1];
    if (last && last.row.actor_user_id === row.actor_user_id && last.row.verb === row.verb) {
      last.count += 1;
      const name = row.technique_name;
      if (name && name !== last.row.technique_name && !last.extraTechniques.includes(name)) {
        last.extraTechniques.push(name);
      }
    } else {
      out.push({ row, count: 1, extraTechniques: [] });
    }
  }
  return out;
}

/** Suffix for a coalesced group, e.g. " and 2 more". Empty when count === 1. */
export function coalescedSuffix(item: CoalescedActivity): string {
  if (item.count <= 1) return "";
  const others = item.count - 1;
  return ` and ${others} more`;
}
