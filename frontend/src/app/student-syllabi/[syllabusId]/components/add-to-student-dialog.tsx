import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { useLibraryTechniques } from '@/lib/queries';
import { useAddTechniqueToStudentSyllabus } from '@/lib/mutations';

interface AddToStudentDialogProps {
  open: boolean;
  onOpenChange: (b: boolean) => void;
  studentId: number;
  syllabusId: number;
  /** Technique ids already present on the assignment's SST set (visible or
   *  hidden) so we can highlight them as already-there. */
  presentTechniqueIds: Set<number>;
}

export function AddToStudentDialog({
  open,
  onOpenChange,
  studentId,
  syllabusId,
  presentTechniqueIds,
}: AddToStudentDialogProps) {
  const libraryQuery = useLibraryTechniques();
  const techniques = useMemo(
    () => libraryQuery.data ?? [],
    [libraryQuery.data],
  );
  const addMutation = useAddTechniqueToStudentSyllabus();
  const [search, setSearch] = useState('');
  const [activeTags, setActiveTags] = useState<string[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());

  useEffect(() => {
    if (!open) {
      setSelected(new Set());
      setSearch('');
      setActiveTags([]);
    }
  }, [open]);

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
      return matchesText && matchesTags;
    });
  }, [techniques, search, activeTags]);

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
        await addMutation.mutateAsync({ studentId, syllabusId, techniqueId: id });
        added += 1;
      } catch {
        toast.error(`Failed after adding ${added} of ${ids.length}`);
        return;
      }
    }
    toast.success(
      added === 1 ? 'Added 1 technique' : `Added ${added} techniques`,
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
                variant={activeTags.includes(tag) ? 'default' : 'outline'}
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
          <span className="font-medium text-foreground">{selected.size}</span>{' '}
          selected · {filtered.length} of {techniques.length} shown
        </p>
        <div className="min-h-0 flex-1 overflow-y-auto rounded border border-border bg-card">
          {filtered.length === 0 ? (
            <p className="px-4 py-6 text-center text-xs text-muted-foreground">
              No techniques match the current filters.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {filtered.map((t) => {
                const checked = selected.has(t.id);
                const already = presentTechniqueIds.has(t.id);
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
                          {already && (
                            <span className="ml-2 text-xs font-normal text-muted-foreground">
                              (already in their list)
                            </span>
                          )}
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
              ? 'Adding...'
              : selected.size === 0
                ? 'Add'
                : selected.size === 1
                  ? 'Add 1'
                  : `Add ${selected.size}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
