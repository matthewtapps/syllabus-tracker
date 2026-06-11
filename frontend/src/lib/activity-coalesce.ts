import type { ActivityRow } from "./activity-line";

export interface CoalescedActivity {
  /** The representative (most recent) row of the group. */
  row: ActivityRow;
  /** How many rows were merged (1 = no coalescing). */
  count: number;
  /** Distinct other technique names in the group, for display copy. */
  extraTechniques: string[];
  /** All rows in the group, newest first. members[0] === row. */
  members: ActivityRow[];
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
      last.members.push(row);
      const name = row.technique_name;
      if (name && name !== last.row.technique_name && !last.extraTechniques.includes(name)) {
        last.extraTechniques.push(name);
      }
    } else {
      out.push({ row, count: 1, extraTechniques: [], members: [row] });
    }
  }
  return out;
}
