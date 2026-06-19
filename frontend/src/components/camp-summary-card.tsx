import { Link } from "react-router-dom";
import { formatRelativeShort } from "@/lib/dates";
import type { CampSummary } from "@/lib/api";

/**
 * A trailhead card for a single camp, shown on the student profile (and the
 * full camps list). The whole card links to the camp detail page. Presentational
 * only: no interaction beyond the link.
 */
export function CampSummaryCard({ camp }: { camp: CampSummary }) {
  const techLabel = `${camp.technique_count} ${camp.technique_count === 1 ? "technique" : "techniques"}`;
  const videoLabel = `${camp.video_count} ${camp.video_count === 1 ? "video" : "videos"}`;
  return (
    <Link
      to={`/camps/${camp.id}`}
      className="block rounded-lg border border-border bg-card p-4 transition-colors hover:bg-muted/40"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold">{camp.name}</span>
      </div>
      {camp.description && (
        <p className="mt-1 truncate text-sm text-muted-foreground">{camp.description}</p>
      )}
      <p className="mt-2 text-xs text-muted-foreground">
        {techLabel} · {videoLabel}
        {camp.last_activity_at ? ` · updated ${formatRelativeShort(camp.last_activity_at)}` : ""}
      </p>
    </Link>
  );
}
