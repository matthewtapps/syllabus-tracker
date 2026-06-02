import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

/**
 * Inline popover content used by the eye-icon button on a video row when
 * viewed in the context of a specific student. Lets the coach toggle
 * global hide AND the per-student override from one place, and shows the
 * effective "what does the student actually see" state at the bottom.
 *
 * In the library context (no student), this component is not rendered —
 * the eye icon toggles global hide directly instead.
 */
interface VisibilityPopoverProps {
  hiddenGlobally: boolean;
  overrideForStudent: "show" | "hide" | null;
  studentDisplayName: string;
  onSetGlobal: (hidden: boolean) => void;
  onSetOverride: (visible: boolean | null) => void;
}

export function VisibilityPopover({
  hiddenGlobally,
  overrideForStudent,
  studentDisplayName,
  onSetGlobal,
  onSetOverride,
}: VisibilityPopoverProps) {
  // Local mirrors so toggling feels instant; parent mutations carry the
  // real state. Reset whenever props change (parent refetches).
  const [localGlobal, setLocalGlobal] = useState(hiddenGlobally);
  const [localOverride, setLocalOverride] = useState(overrideForStudent);
  if (localGlobal !== hiddenGlobally) setLocalGlobal(hiddenGlobally);
  if (localOverride !== overrideForStudent) setLocalOverride(overrideForStudent);

  const effectiveVisible = (() => {
    if (localOverride === "show") return true;
    if (localOverride === "hide") return false;
    return !localGlobal;
  })();

  function handleGlobalToggle(visible: boolean) {
    const nextHidden = !visible;
    setLocalGlobal(nextHidden);
    onSetGlobal(nextHidden);
  }

  function handleOverride(next: "follow" | "show" | "hide") {
    const nextValue: "show" | "hide" | null = next === "follow" ? null : next;
    setLocalOverride(nextValue);
    onSetOverride(
      next === "follow" ? null : next === "show" ? true : false,
    );
  }

  return (
    <div className="space-y-4">
      <header>
        <p className="text-sm font-semibold">Visibility</p>
      </header>

      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium">For everyone</p>
          <p className="text-xs text-muted-foreground">
            Hides this video from every student.
          </p>
        </div>
        <Switch
          checked={!localGlobal}
          onCheckedChange={handleGlobalToggle}
          aria-label="Visible to everyone"
        />
      </div>

      <div className="border-t border-border" />

      <div className="space-y-2">
        <p className="text-sm font-medium">
          Just for{" "}
          <span className="text-foreground">{studentDisplayName}</span>
        </p>
        <div className="flex gap-1">
          <OverrideButton
            label="Follow global"
            active={localOverride === null}
            onClick={() => handleOverride("follow")}
          />
          <OverrideButton
            label="Show"
            active={localOverride === "show"}
            onClick={() => handleOverride("show")}
          />
          <OverrideButton
            label="Hide"
            active={localOverride === "hide"}
            onClick={() => handleOverride("hide")}
          />
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        {studentDisplayName} sees this:{" "}
        <span
          className={cn(
            "font-semibold",
            effectiveVisible ? "text-status-green" : "text-status-red",
          )}
        >
          {effectiveVisible ? "yes" : "no"}
        </span>
      </p>
    </div>
  );
}

function OverrideButton({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      type="button"
      size="sm"
      variant={active ? "default" : "outline"}
      className="flex-1 px-2 text-xs"
      onClick={onClick}
    >
      {label}
    </Button>
  );
}
