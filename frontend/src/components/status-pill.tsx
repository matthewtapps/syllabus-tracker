import { cn } from "@/lib/utils";
import {
  STATUS_LABELS,
  statusToBgClass,
  statusToDotClass,
  statusToTextClass,
  type Status,
} from "@/lib/status";

interface StatusPillProps {
  status: Status;
  label?: string;
  variant?: "solid" | "dot";
  className?: string;
}

export function StatusPill({
  status,
  label,
  variant = "solid",
  className,
}: StatusPillProps) {
  const text = label ?? STATUS_LABELS[status];

  if (variant === "dot") {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1.5 text-xs font-medium",
          statusToTextClass(status),
          className,
        )}
      >
        <span
          className={cn("h-2 w-2 rounded-full", statusToDotClass(status))}
          aria-hidden
        />
        {text}
      </span>
    );
  }

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium",
        statusToBgClass(status),
        statusToTextClass(status),
        className,
      )}
    >
      <span
        className={cn("h-1.5 w-1.5 rounded-full", statusToDotClass(status))}
        aria-hidden
      />
      {text}
    </span>
  );
}
