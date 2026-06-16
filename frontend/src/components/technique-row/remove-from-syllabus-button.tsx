import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTechniqueRow } from "./technique-row-context";

// Trash affordance rendered next to the chevron in the syllabus-management
// chrome (coach editing a syllabus) and the camp detail page. Stops
// propagation so the click does not toggle the accordion.
//
// syllabus-management: the caller supplies onRemove on the context; the page
//   opens a modal with a propagation switch (syllabus only vs cascade).
// camp: the page supplies onRemove on the context; calls it directly (the
//   page already wires useRemoveCampTechnique behind the handler).
export function RemoveFromSyllabusButton() {
  const { context, technique } = useTechniqueRow();

  if (context.kind === "camp") {
    const { onRemove } = context;
    if (!onRemove) return null;
    return (
      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onRemove(technique);
        }}
        aria-label={`Remove ${technique.name} from camp`}
        className="h-8 w-8 text-muted-foreground hover:text-destructive"
      >
        <Trash2 className="h-4 w-4" aria-hidden />
      </Button>
    );
  }

  if (context.kind !== "syllabus-management") return null;
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        context.onRemove(technique);
      }}
      aria-label={`Remove ${technique.name} from syllabus`}
      className="h-8 w-8 text-muted-foreground hover:text-destructive"
    >
      <Trash2 className="h-4 w-4" aria-hidden />
    </Button>
  );
}
