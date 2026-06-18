import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { ExternalLink, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from "@/components/ui/accordion";
import { useCampsForStudent, useCamp } from "@/lib/queries";
import { useAddCampTechnique } from "@/lib/mutations";

export function PullFromPrevious({
  currentCampId,
  studentId,
  referencesCampId,
}: {
  currentCampId: number;
  studentId: number;
  referencesCampId: number | null;
}) {
  const [open, setOpen] = useState(false);
  const campsQuery = useCampsForStudent(studentId);
  const others = useMemo(
    () => (campsQuery.data ?? []).filter((c) => c.id !== currentCampId),
    [campsQuery.data, currentCampId],
  );
  const defaultValue = referencesCampId ? `camp-${referencesCampId}` : undefined;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="ghost" className="h-7 gap-1.5 text-xs">
          Pull from previous work
        </Button>
      </DialogTrigger>
      <DialogContent
        className="flex max-h-[85vh] flex-col"
        aria-describedby={undefined}
      >
        <DialogHeader>
          <DialogTitle>Pull from previous work</DialogTitle>
        </DialogHeader>
        {others.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No other camps for this student yet.
          </p>
        ) : (
          <Accordion
            type="single"
            collapsible
            defaultValue={defaultValue}
            className="overflow-y-auto"
          >
            {others.map((c) => (
              <AccordionItem key={c.id} value={`camp-${c.id}`}>
                <AccordionTrigger className="text-sm">
                  <span className="flex-1 text-left">
                    {c.name}
                    {c.archived_at ? " (archived)" : ""}
                  </span>
                </AccordionTrigger>
                <AccordionContent>
                  <SourceCampTechniques
                    sourceCampId={c.id}
                    currentCampId={currentCampId}
                  />
                  <Link
                    to={`/camps/${c.id}`}
                    className="mt-2 inline-flex items-center gap-1 text-xs text-primary hover:underline"
                  >
                    <ExternalLink className="h-3 w-3" aria-hidden />
                    View camp
                  </Link>
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        )}
      </DialogContent>
    </Dialog>
  );
}

function SourceCampTechniques({
  sourceCampId,
  currentCampId,
}: {
  sourceCampId: number;
  currentCampId: number;
}) {
  const campQuery = useCamp(sourceCampId);
  const add = useAddCampTechnique(currentCampId);
  const techs = campQuery.data?.techniques ?? [];

  if (campQuery.isLoading) {
    return <div className="h-4 w-1/3 animate-pulse rounded bg-muted" />;
  }
  if (techs.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        No techniques in this camp.
      </p>
    );
  }
  return (
    <ul className="divide-y divide-border rounded border border-border">
      {techs.map((t) => (
        <li key={t.technique_id} className="flex items-center gap-2 px-3 py-2">
          <span className="min-w-0 flex-1 truncate text-sm">{t.name}</span>
          <Button
            size="sm"
            variant="outline"
            className="h-6 gap-1 px-2 text-xs"
            disabled={add.isPending}
            onClick={() =>
              add.mutate(t.technique_id, {
                onSuccess: () => toast.success(`Added ${t.name}`),
                onError: () => toast.error("Failed to add technique"),
              })
            }
          >
            <Plus className="h-3 w-3" aria-hidden />
            Add
          </Button>
        </li>
      ))}
    </ul>
  );
}
