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
