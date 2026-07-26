import { ChevronRight } from "lucide-react";
import { Link } from "react-router-dom";
import type { LibraryTechniqueRow } from "@/lib/api";
import { Header } from "./header";
import { TechniqueRowProvider } from "./technique-row-provider";
import type { RowContext } from "./technique-row-context";

interface TechniqueRowTeaserProps {
  technique: LibraryTechniqueRow;
  context: RowContext;
  /** The technique in its real surface. The teaser itself never expands. */
  href: string;
}

// The row as a preview: the same Header the expandable row shows, inside one
// link. No aria-expanded (nothing expands here), a ChevronRight instead of a
// rotating caret (the tap goes to the technique in its surface, it does not
// unfold in place), and no curation chrome: pin, hidden-toggle, remove and
// add-to-camp all live on the surfaces that own the technique, not in a feed
// preview. One link with no interactive descendants keeps the whole row a
// single tap target.
export function TechniqueRowTeaser({
  technique,
  context,
  href,
}: TechniqueRowTeaserProps) {
  return (
    <TechniqueRowProvider technique={technique} context={context}>
      <Link
        to={href}
        className="flex w-full items-start gap-3 px-4 py-3 text-left text-sm font-medium outline-none transition-colors hover:bg-muted/30 focus-visible:bg-muted/50 active:bg-muted/50"
      >
        <Header />
        <ChevronRight
          className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground"
          aria-hidden
        />
      </Link>
    </TechniqueRowProvider>
  );
}
