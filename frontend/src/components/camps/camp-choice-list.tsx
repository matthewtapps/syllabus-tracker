import { cn } from "@/lib/utils";
import type { CampSummary } from "@/lib/api";

export type CampChoiceValue =
  | { kind: "create_new" }
  | { kind: "existing"; campId: number };

export function CampChoiceList({
  camps,
  value,
  onChange,
}: {
  camps: CampSummary[];
  value: CampChoiceValue;
  onChange: (v: CampChoiceValue) => void;
}) {
  const unlinked = camps.filter(
    (c) => c.competition_id == null && !c.archived_at,
  );
  return (
    <div
      role="radiogroup"
      aria-label="Camp for this competition"
      className="space-y-2"
    >
      <ChoiceCard
        selected={value.kind === "create_new"}
        onSelect={() => onChange({ kind: "create_new" })}
        label="Create a new camp"
        description="A fresh camp named after this competition. You can rename it later."
      />
      {unlinked.map((c) => (
        <ChoiceCard
          key={c.id}
          selected={value.kind === "existing" && value.campId === c.id}
          onSelect={() => onChange({ kind: "existing", campId: c.id })}
          label={`Promote: ${c.name}`}
          description="Link this existing camp to the competition."
        />
      ))}
    </div>
  );
}

function ChoiceCard({
  selected,
  onSelect,
  label,
  description,
}: {
  selected: boolean;
  onSelect: () => void;
  label: string;
  description: string;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={cn(
        "w-full rounded-lg border p-3 text-left transition-colors",
        selected
          ? "border-primary bg-primary/5 ring-1 ring-primary"
          : "border-border bg-card hover:bg-muted/40",
      )}
    >
      <p className="text-sm font-medium leading-tight">{label}</p>
      <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
    </button>
  );
}
