import { useActivityDigest } from "@/lib/queries";
import { cn } from "@/lib/utils";
import { Sparkline } from "./sparkline";

function deltaText(delta: number): string {
  if (delta === 0) return "No change vs last week";
  if (delta > 0) return `Up ${delta} vs last week`;
  return `${Math.abs(delta)} fewer vs last week`;
}

export function ActivityDigest({ className }: { className?: string }) {
  const { data, isLoading, error } = useActivityDigest();

  if (isLoading) {
    return (
      <div className={cn("grid grid-cols-2 gap-3", className)}>
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-28 animate-pulse rounded-xl bg-muted" />
        ))}
      </div>
    );
  }
  if (error || !data) {
    return (
      <p className={cn("rounded-xl border border-border bg-card px-4 py-6 text-center text-sm text-muted-foreground", className)}>
        Could not load recent activity.
      </p>
    );
  }

  return (
    <div className={cn("grid grid-cols-2 gap-3", className)}>
      {data.metrics.map((m) => (
        <div key={m.key} className="rounded-xl border border-border bg-card p-4">
          <div className="text-2xl font-bold leading-none">{m.count}</div>
          <div className="mt-1 text-xs text-muted-foreground">{m.label}</div>
          <Sparkline values={m.daily} className="mt-2" />
          <div className={cn("mt-2 text-[11px]", m.delta >= 0 ? "text-status-green" : "text-muted-foreground")}>
            {deltaText(m.delta)}
          </div>
        </div>
      ))}
    </div>
  );
}
