import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { NewTechniqueForm } from "@/components/new-technique-form";
import type { CreatedLibraryTechnique } from "@/lib/api";
import { useLibraryTechniques } from "@/lib/queries";
import {
  useAddTechniqueToStudentSyllabus,
  useSetSstHidden,
} from "@/lib/mutations";
import { matchHiddenByName, type HiddenMatchCandidate } from "../sst-view";

interface AddToStudentDialogProps {
  open: boolean;
  onOpenChange: (b: boolean) => void;
  studentId: number;
  syllabusId: number;
  /** technique_ids on the syllabus and currently VISIBLE — excluded from the picker. */
  visibleTechniqueIds: Set<number>;
  /** technique_id -> sstId for rows on the syllabus but HIDDEN — kept (later: "make visible"). */
  hiddenTechniqueSstByTid: Map<number, number>;
}

export function AddToStudentDialog({
  open,
  onOpenChange,
  studentId,
  syllabusId,
  visibleTechniqueIds,
  hiddenTechniqueSstByTid,
}: AddToStudentDialogProps) {
  const libraryQuery = useLibraryTechniques();
  const techniques = useMemo(
    () => libraryQuery.data ?? [],
    [libraryQuery.data],
  );
  const addMutation = useAddTechniqueToStudentSyllabus();
  const unhideMutation = useSetSstHidden();
  const [search, setSearch] = useState("");
  const [activeTags, setActiveTags] = useState<string[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [addToGlobal, setAddToGlobal] = useState(true);

  useEffect(() => {
    if (!open) {
      setSelected(new Set());
      setSearch("");
      setActiveTags([]);
      setAddToGlobal(true);
    }
  }, [open]);

  const existingNamesForNudge = useMemo(
    () => techniques.map((t) => t.name),
    [techniques],
  );

  async function handleCreated(created: CreatedLibraryTechnique) {
    try {
      await addMutation.mutateAsync({
        studentId,
        syllabusId,
        techniqueId: created.id,
      });
      toast.success(
        addToGlobal
          ? `Added "${created.name}" (also in library)`
          : `Added "${created.name}" for this student`,
      );
      onOpenChange(false);
    } catch {
      toast.error("Created the technique but failed to add it to the syllabus");
    }
  }

  const availableTags = useMemo(() => {
    const set = new Set<string>();
    techniques.forEach((t) => t.tags.forEach((tag) => set.add(tag.name)));
    return Array.from(set).sort();
  }, [techniques]);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return techniques.filter((t) => {
      const matchesText =
        !needle ||
        t.name.toLowerCase().includes(needle) ||
        t.description.toLowerCase().includes(needle) ||
        t.tags.some((tag) => tag.name.toLowerCase().includes(needle));
      const matchesTags =
        activeTags.length === 0 ||
        activeTags.every((tag) => t.tags.some((x) => x.name === tag));
      const notAlreadyVisible = !visibleTechniqueIds.has(t.id);
      return matchesText && matchesTags && notAlreadyVisible;
    });
  }, [techniques, search, activeTags, visibleTechniqueIds]);

  const hiddenCandidates = useMemo<HiddenMatchCandidate[]>(() => {
    const byId = new Map(techniques.map((t) => [t.id, t.name]));
    const out: HiddenMatchCandidate[] = [];
    for (const [techniqueId, sstId] of hiddenTechniqueSstByTid) {
      const technique_name = byId.get(techniqueId);
      if (technique_name === undefined) continue;
      out.push({ technique_id: techniqueId, technique_name, sstId });
    }
    return out;
  }, [techniques, hiddenTechniqueSstByTid]);

  const hiddenMatch = matchHiddenByName(hiddenCandidates, search);

  function toggle(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleTag(tag: string) {
    setActiveTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag],
    );
  }

  async function handleAdd() {
    if (selected.size === 0) return;
    const ids = Array.from(selected);
    let added = 0;
    for (const id of ids) {
      try {
        await addMutation.mutateAsync({
          studentId,
          syllabusId,
          techniqueId: id,
        });
        added += 1;
      } catch {
        toast.error(`Failed after adding ${added} of ${ids.length}`);
        return;
      }
    }
    toast.success(
      added === 1 ? "Added 1 technique" : `Added ${added} techniques`,
    );
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex h-[85vh] flex-col gap-3 sm:h-[80vh]"
        aria-describedby={undefined}
      >
        <DialogHeader>
          <DialogTitle>Add to this student</DialogTitle>
        </DialogHeader>
        <Tabs defaultValue="existing" className="flex min-h-0 flex-1 flex-col">
          <TabsList className="grid grid-cols-2">
            <TabsTrigger value="existing">Add existing</TabsTrigger>
            <TabsTrigger value="create">Create new</TabsTrigger>
          </TabsList>

          <TabsContent
            value="existing"
            className="flex min-h-0 flex-1 flex-col gap-3"
          >
            <Input
              placeholder="Search techniques"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {availableTags.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {availableTags.map((tag) => (
                  <Badge
                    key={tag}
                    variant={activeTags.includes(tag) ? "default" : "outline"}
                    className="cursor-pointer select-none"
                    onClick={() => toggleTag(tag)}
                  >
                    {tag}
                  </Badge>
                ))}
                {activeTags.length > 0 && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2 text-xs"
                    onClick={() => setActiveTags([])}
                  >
                    Clear
                  </Button>
                )}
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              <span className="font-medium text-foreground">
                {selected.size}
              </span>{" "}
              selected · {filtered.length} of {techniques.length} shown
            </p>
            {hiddenMatch && (
              <div className="flex items-center justify-between gap-2 rounded border border-border bg-muted/40 px-3 py-2 text-sm">
                <span>{hiddenMatch.technique_name} is on their list but hidden.</span>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={unhideMutation.isPending}
                  onClick={async () => {
                    try {
                      await unhideMutation.mutateAsync({
                        sstId: hiddenMatch.sstId,
                        studentId,
                        syllabusId,
                        hidden: false,
                      });
                      toast.success(`Showing ${hiddenMatch.technique_name}`);
                    } catch {
                      toast.error("Failed to update visibility");
                    }
                  }}
                >
                  Make visible
                </Button>
              </div>
            )}
            <div className="min-h-0 flex-1 overflow-y-auto rounded border border-border bg-card">
              {filtered.length === 0 ? (
                <p className="px-4 py-6 text-center text-xs text-muted-foreground">
                  No techniques match the current filters.
                </p>
              ) : (
                <ul className="divide-y divide-border">
                  {filtered.map((t) => {
                    const checked = selected.has(t.id);
                    return (
                      <li key={t.id}>
                        <label
                          htmlFor={`add-to-student-${t.id}`}
                          className="flex cursor-pointer items-start gap-3 px-3 py-2 transition-colors hover:bg-muted/40"
                        >
                          <Checkbox
                            id={`add-to-student-${t.id}`}
                            checked={checked}
                            onCheckedChange={() => toggle(t.id)}
                            className="mt-0.5"
                          />
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium">
                              {t.name}
                            </p>
                          </div>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
            <DialogFooter className="grid grid-cols-2 gap-2 sm:flex-none sm:justify-stretch">
              <Button
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={addMutation.isPending}
                className="w-full"
              >
                Cancel
              </Button>
              <Button
                onClick={handleAdd}
                disabled={selected.size === 0 || addMutation.isPending}
                className="w-full"
              >
                {addMutation.isPending
                  ? "Adding..."
                  : selected.size === 0
                    ? "Add"
                    : selected.size === 1
                      ? "Add 1"
                      : `Add ${selected.size}`}
              </Button>
            </DialogFooter>
          </TabsContent>

          <TabsContent
            value="create"
            className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto"
          >
            <NewTechniqueForm
              existingNames={existingNamesForNudge}
              formId="sst-create"
              addToGlobal={addToGlobal}
              onAddToGlobalChange={setAddToGlobal}
              onCreated={handleCreated}
            />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
