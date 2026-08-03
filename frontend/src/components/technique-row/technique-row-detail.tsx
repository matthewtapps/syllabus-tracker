import type { LibraryTechniqueRow } from "@/lib/api";
import { ExpandedPanel } from "./expanded-panel";
import { TechniqueRowProvider } from "./technique-row-provider";
import type { RowContext } from "./technique-row-context";

interface TechniqueRowDetailProps {
  technique: LibraryTechniqueRow;
  context: RowContext;
  scrollToVideoId?: number | null;
  /** Seconds to resume `scrollToVideoId` at, carried by `?t=` from a feed player. */
  resumeSeconds?: number | null;
  onVideoScrolled?: () => void;
}

// The row's body without the row: the same blocks the accordion reveals, on a
// page that IS the technique. No AccordionItem, no header and no trigger,
// because arriving here is the expansion. Mounts the same provider
// TechniqueRow and TechniqueRowTeaser do, so the blocks cannot drift between a
// technique read in place and the same technique read on its own page.
export function TechniqueRowDetail({
  technique,
  context,
  scrollToVideoId,
  resumeSeconds,
  onVideoScrolled,
}: TechniqueRowDetailProps) {
  return (
    <TechniqueRowProvider technique={technique} context={context}>
      <ExpandedPanel
        scrollToVideoId={scrollToVideoId}
        resumeSeconds={resumeSeconds}
        onVideoScrolled={onVideoScrolled}
      />
    </TechniqueRowProvider>
  );
}
