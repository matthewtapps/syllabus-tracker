import type { ReactNode } from "react";

/** The card every teaser tile sits in, whatever kind it is. */
export function TileShell({ children }: { children: ReactNode }) {
  return (
    <div className="mx-3 mb-3 overflow-hidden rounded-md border border-border bg-card">
      {children}
    </div>
  );
}

/** Fixed-height placeholder while a tile hydrates, so async hydration never
 *  shifts the feed (CLS = 0). */
export function TileSkeleton() {
  return (
    <div className="mx-3 mb-3 rounded-md border border-border bg-card px-4 py-3">
      <div className="h-4 w-2/5 animate-pulse rounded bg-muted" />
      <div className="mt-2 h-3 w-1/4 animate-pulse rounded bg-muted" />
    </div>
  );
}
