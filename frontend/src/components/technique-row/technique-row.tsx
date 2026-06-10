import { useEffect, useMemo, useState } from "react";
import type { LibraryTechniqueRow } from "@/lib/api";
import { useUser } from "@/lib/current-user-context";
import {
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { ExpandedPanel } from "./expanded-panel";
import { Header } from "./header";
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
// student syllabus). The internal compound context populates `role`,
// `viewerIsOwner`, and the discriminated row context once at the top so
// hot block lists do not re-subscribe to useUser() per row. Trigger and
// content live inside the same Radix Accordion item so opening flows
// directly out of the header instead of stacking a second card below.
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

  return (
    <TechniqueRowContext.Provider value={ctxValue}>
      <AccordionItem
        value={value}
        id={`technique-row-${technique.id}`}
        className="border-b last:border-b-0"
      >
        <AccordionTrigger className="px-4 py-3 hover:bg-muted/40 hover:no-underline data-[state=open]:bg-muted/30">
          <Header />
        </AccordionTrigger>
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
