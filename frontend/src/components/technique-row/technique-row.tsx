import { useEffect, useState } from "react";
import * as AccordionPrimitive from "@radix-ui/react-accordion";
import { ChevronDownIcon, FolderPlus } from "lucide-react";
import type { LibraryTechniqueRow } from "@/lib/api";
import {
  AccordionContent,
  AccordionItem,
} from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ExpandedPanel } from "./expanded-panel";
import { Header } from "./header";
import { HiddenToggleButton } from "./hidden-toggle-button";
import { PinButton } from "./pin-button";
import { RemoveFromSyllabusButton } from "./remove-from-syllabus-button";
import { TechniqueRowProvider } from "./technique-row-provider";
import {
  useTechniqueRow,
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
  /** Seconds to resume `scrollToVideoId` at, from a feed tile's `?t=`. */
  resumeSeconds?: number | null;
  onVideoScrolled?: () => void;
  /** Renders the row ghosted (reduced opacity). Used by the
   *  student-syllabus surface to keep a just-hidden row lingering in the
   *  Main tab for the rest of the visit. */
  ghost?: boolean;
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

// The expand-in-place row, used on every surface that owns techniques
// (global library, student pinned, student syllabus, syllabus management,
// camp). TechniqueRowProvider holds the shared compound state; the feed's
// teaser and detail wrappers mount the same provider around different
// bodies, so all three stay one row.
export function TechniqueRow({
  technique,
  context,
  value,
  isOpen,
  scrollToVideoId,
  resumeSeconds,
  onVideoScrolled,
  ghost,
}: TechniqueRowProps) {
  return (
    <TechniqueRowProvider technique={technique} context={context}>
      <RowItem
        value={value}
        isOpen={isOpen}
        scrollToVideoId={scrollToVideoId}
        resumeSeconds={resumeSeconds}
        onVideoScrolled={onVideoScrolled}
        ghost={ghost}
      />
    </TechniqueRowProvider>
  );
}

// Inner half of the row: reads the compound state the provider derived rather
// than deriving `viewerIsOwner` a second time.
//
// We render two AccordionPrimitive.Triggers in the same Item: the title
// area on the left (keyboard focusable, the canonical control) and the
// trailing chevron strip (mouse-only, tabIndex=-1 + aria-hidden) so
// tapping the caret on touch still toggles. The pin button is a real
// <button> placed between them, not nested, so it doesn't violate the
// "no interactive content inside a button" rule.
function RowItem({
  value,
  isOpen,
  scrollToVideoId,
  resumeSeconds,
  onVideoScrolled,
  ghost,
}: Omit<TechniqueRowProps, "technique" | "context">) {
  const { context, technique, role, viewerIsOwner } = useTechniqueRow();
  const renderContent = useDelayedFalse(isOpen);

  // The pin button is reachable from the row chrome (no expand required)
  // for student viewers on the global library and student-pinned
  // surfaces. Coaches viewing either surface, and any student-syllabus
  // surface, don't render it.
  const showPinButton =
    viewerIsOwner &&
    (context.kind === "global-library" || context.kind === "student-pinned");

  // Coach-only "Add to camp" button on the student-pinned surface.
  const showAddToCampButton =
    context.kind === "student-pinned" &&
    !viewerIsOwner &&
    (role === "coach" || role === "admin") &&
    !!context.onAddToCampIntent;

  const showRemoveButton =
    context.kind === "syllabus-management" ||
    (context.kind === "camp" && context.onRemove != null);
  const showHiddenToggle =
    context.kind === "student-syllabus" &&
    (role === "coach" || role === "admin");

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
    <AccordionItem
      value={value}
      id={`technique-row-${technique.id}`}
      className={cn(
        "group border-b last:border-b-0",
        context.kind === "student-syllabus" && "border-l-4 transition-colors",
        context.kind === "student-syllabus" && accentClass,
        ghost && "opacity-50 transition-opacity",
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
          {showAddToCampButton && context.kind === "student-pinned" && (
            <div className="flex shrink-0 items-center pl-1">
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-muted-foreground hover:text-foreground"
                aria-label="Add to camp"
                title="Add to camp"
                onClick={(e) => {
                  e.stopPropagation();
                  context.onAddToCampIntent?.(technique);
                }}
              >
                <FolderPlus className="h-4 w-4" aria-hidden />
              </Button>
            </div>
          )}
          {showHiddenToggle && (
            <div className="flex shrink-0 items-center pl-1">
              <HiddenToggleButton />
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
          {showRemoveButton && (
            <div className="flex shrink-0 items-center pr-2">
              <RemoveFromSyllabusButton />
            </div>
          )}
        </div>
      </AccordionPrimitive.Header>
      <AccordionContent className="px-4 pb-4 pt-1">
        {renderContent ? (
          <ExpandedPanel
            scrollToVideoId={scrollToVideoId}
            resumeSeconds={resumeSeconds}
            onVideoScrolled={onVideoScrolled}
          />
        ) : null}
      </AccordionContent>
    </AccordionItem>
  );
}
