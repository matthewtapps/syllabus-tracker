import type { SstRow } from '@/lib/api';

export interface SstPartition {
  main: SstRow[];
  custom: SstRow[];
  hidden: SstRow[];
}

export function partitionSsts(
  rows: SstRow[],
  ghostTechniqueIds: Set<number>,
): SstPartition {
  const main = rows.filter(
    (r) => r.hidden_at == null || ghostTechniqueIds.has(r.technique_id),
  );
  const custom = rows.filter((r) => r.hidden_at == null && !r.is_global);
  const hidden = rows.filter((r) => r.hidden_at != null);
  return { main, custom, hidden };
}

export interface HiddenMatchCandidate {
  technique_id: number;
  technique_name: string;
  sstId: number;
}

export function matchHiddenByName(
  hidden: HiddenMatchCandidate[],
  query: string,
): HiddenMatchCandidate | null {
  const needle = query.trim().toLowerCase();
  if (!needle) return null;
  return (
    hidden.find((h) => h.technique_name.toLowerCase().includes(needle)) ?? null
  );
}

export type SstSort = 'recent' | 'alphabetical';

function recencyScore(s: SstRow): number {
  const ts = [s.last_attempt_at, s.last_coach_update_at, s.last_student_update_at]
    .filter((t): t is string => t != null)
    .map((t) => new Date(t).getTime());
  return ts.length ? Math.max(...ts) : 0;
}

export function sortSsts(rows: SstRow[], sort: SstSort): SstRow[] {
  const copy = [...rows];
  if (sort === 'alphabetical') {
    return copy.sort((a, b) => a.technique_name.localeCompare(b.technique_name));
  }
  return copy.sort((a, b) => recencyScore(b) - recencyScore(a));
}
