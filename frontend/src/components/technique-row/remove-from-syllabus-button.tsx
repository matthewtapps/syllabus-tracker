import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTechniqueRow } from "./technique-row-context";

// Trash affordance rendered next to the chevron in the syllabus-management
// chrome (coach editing a syllabus). Stops propagation so the click does
// not toggle the accordion. The caller decides what 'remove' means: the
// global syllabus detail page opens a modal with a propagation switch
// (syllabus only vs cascade to active assignments).
export function RemoveFromSyllabusButton() {
  const { context, technique } = useTechniqueRow();
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
      aria-label={`Remove ${technique.name}`}
      className="h-8 w-8 text-muted-foreground hover:text-destructive"
    >
      <Trash2 className="h-4 w-4" aria-hidden />
    </Button>
  );
}
