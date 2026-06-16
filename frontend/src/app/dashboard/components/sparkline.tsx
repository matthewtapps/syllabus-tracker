interface SparklineProps {
  values: number[];
  className?: string;
}

/** Tiny bar sparkline. Pure presentational; scales to the local max. */
export function Sparkline({ values, className }: SparklineProps) {
  const max = Math.max(1, ...values);
  return (
    <div
      className={className}
      aria-hidden
      style={{ display: "flex", alignItems: "flex-end", gap: 2, height: 22 }}
    >
      {values.map((v, i) => (
        <span
          key={i}
          className="flex-1 rounded-sm bg-primary/40 last:bg-primary"
          style={{ height: `${Math.max(8, (v / max) * 100)}%` }}
        />
      ))}
    </div>
  );
}
