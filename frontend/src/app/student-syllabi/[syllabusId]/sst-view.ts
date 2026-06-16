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
