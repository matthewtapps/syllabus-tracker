import { cn } from "@/lib/utils";
import {
  STATUS_LABELS,
  STATUS_VALUES,
  statusToDotClass,
  type Status,
} from "@/lib/status";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

interface StatusToggleProps {
  value: Status;
  onChange: (next: Status) => void;
  size?: "sm" | "default";
  disabled?: boolean;
  className?: string;
}

export function StatusToggle({
  value,
  onChange,
  size = "default",
  disabled,
  className,
}: StatusToggleProps) {
  return (
    <ToggleGroup
      type="single"
      value={value}
      onValueChange={(next) => {
        if (next && next !== value) onChange(next as Status);
      }}
      variant="outline"
      size={size}
      disabled={disabled}
      className={className}
      aria-label="Technique status"
    >
      {STATUS_VALUES.map((s) => (
        <ToggleGroupItem
          key={s}
          value={s}
          aria-label={STATUS_LABELS[s]}
          className="gap-1.5 data-[state=on]:bg-accent"
        >
          <span
            className={cn("h-2 w-2 rounded-full", statusToDotClass(s))}
            aria-hidden
          />
          {STATUS_LABELS[s]}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
