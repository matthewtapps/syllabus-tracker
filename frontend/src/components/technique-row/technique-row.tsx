import { useEffect, useMemo, useState } from "react";
import * as AccordionPrimitive from "@radix-ui/react-accordion";
import { ChevronDownIcon } from "lucide-react";
import type { LibraryTechniqueRow } from "@/lib/api";
import { useUser } from "@/lib/current-user-context";
import {
  AccordionContent,
  AccordionItem,
} from "@/components/ui/accordion";
import { cn } from "@/lib/utils";
import { ExpandedPanel } from "./expanded-panel";
import { Header } from "./header";
import { PinButton } from "./pin-button";
import {
  TechniqueRowContext,
  type RowContext,
} from "./technique-row-context";

interface TechniqueRowProps {
  technique: LibraryTechniqueRow;
  context: RowContext;
  /** Stable value used as the Accordion item id; must be unique across the
   *  parent Accordion's children. */
  value: string;
  /** Drives lazy mount of the expanded panel. Wires to the parent
   *  Accordion's open value (e.g. `value === openValue`). */
  isOpen: boolean;
  scrollToVideoId?: number | null;
  onVideoScrolled?: () => void;
}

// Keeps the expanded panel mounted through the AccordionContent close
// animation so the height transition has children to measure. After the
// animation duration elapses we let the inner blocks unmount, so the
// long collapsed list doesn't keep N×K data queries alive.
function useDelayedFalse(open: boolean, delay = 250): boolean {
  const [active, setActive] = useState(open);
  useEffect(() => {
    if (open) {
      setActive(true);
      return;
    }
    const t = window.setTimeout(() => setActive(false), delay);
    return () => window.clearTimeout(t);
  }, [open, delay]);
  return active;
}

// One row component for every surface (global library, student pinned,
// student syllabus). Internal compound context populates `role`,
// `viewerIsOwner`, and the discriminated row context once at the top so
// hot block lists do not re-subscribe to useUser() per row. The pin
// button sits in the row chrome (next to the chevron) so students can
// pin/unpin without expanding the row.
//
// We render two AccordionPrimitive.Triggers in the same Item: the title
// area on the left (keyboard focusable, the canonical control) and the
// trailing chevron strip (mouse-only, tabIndex=-1 + aria-hidden) so
// tapping the caret on touch still toggles. The pin button is a real
// <button> placed between them, not nested, so it doesn't violate the
// "no interactive content inside a button" rule.
export function TechniqueRow({
  technique,
  context,
  value,
  isOpen,
  scrollToVideoId,
  onVideoScrolled,
}: TechniqueRowProps) {
  const user = useUser();
  const renderContent = useDelayedFalse(isOpen);

  const viewerIsOwner = useMemo(() => {
    switch (context.kind) {
      case "global-library":
        return user.role === "student";
      case "student-pinned":
      case "student-syllabus":
        return user.id === context.studentId;
    }
  }, [context, user.id, user.role]);

  const ctxValue = useMemo(
    () => ({
      context,
      technique,
      role: user.role,
      viewerIsOwner,
    }),
    [context, technique, user.role, viewerIsOwner],
  );

  // The pin button is reachable from the row chrome (no expand required)
  // for student viewers on the global library and student-pinned
  // surfaces. Coaches viewing either surface, and any student-syllabus
  // surface, don't render it.
  const showPinButton =
    viewerIsOwner &&
    (context.kind === "global-library" || context.kind === "student-pinned");

  // Left-border accent for the student-syllabus surface: status colour
  // when the row is open or already at amber/green, transparent when
  // the status is still red (the visual signal is reserved for
  // techniques the student has made progress on). Mirrors the legacy
  // student-techniques row.
  const sstStatus =
    context.kind === "student-syllabus" ? context.sst.status : null;
  const accentClass =
    sstStatus === "amber"
      ? "border-l-status-amber"
      : sstStatus === "green"
        ? "border-l-status-green"
        : "border-l-transparent";

  return (
    <TechniqueRowContext.Provider value={ctxValue}>
      <AccordionItem
        value={value}
        id={`technique-row-${technique.id}`}
        className={cn(
          "group border-b last:border-b-0",
          context.kind === "student-syllabus" && "border-l-4 transition-colors",
          context.kind === "student-syllabus" && accentClass,
        )}
      >
        <AccordionPrimitive.Header asChild>
          <div
            className={cn(
              "flex items-stretch transition-colors",
              "hover:bg-muted/40 group-data-[state=open]:bg-muted/30",
            )}
          >
            <AccordionPrimitive.Trigger
              className={cn(
                "flex min-w-0 flex-1 items-start gap-3 px-4 py-3 text-left text-sm font-medium outline-none",
                "focus-visible:bg-muted/50",
              )}
            >
              <Header />
            </AccordionPrimitive.Trigger>
            {showPinButton && (
              <div className="flex shrink-0 items-center pl-1">
                <PinButton />
              </div>
            )}
            <AccordionPrimitive.Trigger
              tabIndex={-1}
              aria-hidden
              className="flex shrink-0 items-center px-3 outline-none focus-visible:bg-muted/50"
            >
              <ChevronDownIcon
                className="h-4 w-4 text-muted-foreground transition-transform duration-200 group-data-[state=open]:rotate-180"
              />
            </AccordionPrimitive.Trigger>
          </div>
        </AccordionPrimitive.Header>
        <AccordionContent className="px-4 pb-4 pt-1">
          {renderContent ? (
            <ExpandedPanel
              scrollToVideoId={scrollToVideoId}
              onVideoScrolled={onVideoScrolled}
            />
          ) : null}
        </AccordionContent>
      </AccordionItem>
    </TechniqueRowContext.Provider>
  );
}
