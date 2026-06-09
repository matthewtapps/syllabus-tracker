import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
  addTechniquesToCollection,
  createTechniqueInCollection,
  getTechniquesForAssignment,
  type LibraryTechnique,
} from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { handleApiFormError, useFormWithValidation } from './hooks/useFormErrors';
import { TracedForm } from './traced-form';

interface AddTechniquesToCollectionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  collectionId: number;
  collectionName: string;
  alreadyAssignedIds: Set<number>;
  canCreate: boolean;
  onAdded: (techniques: LibraryTechnique[]) => void;
}

interface LibraryRow {
  id: number;
  name: string;
  description: string;
  coach_id: number;
  coach_name: string;
  tags: { id: number; name: string }[];
}

interface CreateValues {
  name: string;
  description: string;
}

export default function AddTechniquesToCollectionDialog({
  open,
  onOpenChange,
  collectionId,
  collectionName,
  alreadyAssignedIds,
  canCreate,
  onAdded,
}: AddTechniquesToCollectionDialogProps) {
  const [tab, setTab] = useState<'pick' | 'create'>('pick');
  const [library, setLibrary] = useState<LibraryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [filterText, setFilterText] = useState('');
  const [tagFilter, setTagFilter] = useState<string[]>([]);
  const [submittingPick, setSubmittingPick] = useState(false);

  const createForm = useFormWithValidation<CreateValues>({
    defaultValues: { name: '', description: '' },
  });

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    async function load() {
      try {
        setLoading(true);
        const techs: LibraryRow[] = await getTechniquesForAssignment(0);
        if (cancelled) return;
        setLibrary(techs);
        setError(null);
      } catch (err) {
        if (cancelled) return;
        console.error(err);
        setError('Failed to load technique library.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    if (!open) {
      setSelectedIds([]);
      setFilterText('');
      setTagFilter([]);
      setTab('pick');
      createForm.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const candidates = useMemo(
    () => library.filter((t) => !alreadyAssignedIds.has(t.id)),
    [library, alreadyAssignedIds],
  );

  const availableTags = useMemo(() => {
    const set = new Set<string>();
    candidates.forEach((t) => t.tags?.forEach((tag) => set.add(tag.name)));
    return Array.from(set).sort();
  }, [candidates]);

  const filtered = useMemo(() => {
    const needle = filterText.trim().toLowerCase();
    return candidates.filter((t) => {
      const matchesText =
        !needle ||
        t.name.toLowerCase().includes(needle) ||
        t.description.toLowerCase().includes(needle) ||
        (t.tags && t.tags.some((tag) => tag.name.toLowerCase().includes(needle)));
      const matchesTags =
        tagFilter.length === 0 ||
        tagFilter.every(
          (tag) => t.tags && t.tags.some((tt) => tt.name === tag),
        );
      return matchesText && matchesTags;
    });
  }, [candidates, filterText, tagFilter]);

  function toggle(id: number) {
    setSelectedIds((current) =>
      current.includes(id) ? current.filter((x) => x !== id) : [...current, id],
    );
  }

  function selectAllVisible() {
    const ids = filtered.map((t) => t.id);
    setSelectedIds((current) => Array.from(new Set([...current, ...ids])));
  }

  function deselectAllVisible() {
    const visible = new Set(filtered.map((t) => t.id));
    setSelectedIds((current) => current.filter((id) => !visible.has(id)));
  }

  function toggleTag(name: string) {
    setTagFilter((prev) =>
      prev.includes(name) ? prev.filter((t) => t !== name) : [...prev, name],
    );
  }

  async function handlePickSubmit() {
    if (selectedIds.length === 0) return;
    setSubmittingPick(true);
    try {
      const response = await addTechniquesToCollection(collectionId, selectedIds);
      if (!response.ok) {
        toast.error('Failed to add techniques');
        return;
      }
      const added: LibraryTechnique[] = candidates
        .filter((t) => selectedIds.includes(t.id))
        .map((t) => ({
          id: t.id,
          name: t.name,
          description: t.description,
          coach_id: t.coach_id,
          coach_name: t.coach_name,
        }));
      onAdded(added);
      toast.success(
        `Added ${added.length} ${added.length === 1 ? 'technique' : 'techniques'}`,
      );
      onOpenChange(false);
    } finally {
      setSubmittingPick(false);
    }
  }

  async function handleCreateSubmit(values: CreateValues) {
    if (!values.name.trim() || !values.description.trim()) return;
    try {
      const response = await createTechniqueInCollection(
        collectionId,
        values.name,
        values.description,
      );
      if (!response.ok) throw response;
      const created: LibraryTechnique = await response.json();
      onAdded([created]);
      toast.success(`Created "${created.name}"`);
      createForm.reset();
    } catch (err) {
      const handled = await handleApiFormError(
        err,
        createForm.setError,
        Object.keys(createForm.getValues()),
      );
      if (!handled) toast.error(err instanceof Error ? err.message : 'Failed to create technique');
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] w-[calc(100vw-1rem)] max-w-xl overflow-y-auto p-4 sm:p-6">
        <DialogHeader>
          <DialogTitle>Add techniques</DialogTitle>
          <DialogDescription>
            Pick existing techniques or create a brand new one inside{' '}
            <span className="font-medium">{collectionName}</span>.
          </DialogDescription>
        </DialogHeader>

        <Tabs value={tab} onValueChange={(v) => setTab(v as 'pick' | 'create')}>
          <TabsList className="w-full">
            <TabsTrigger value="pick" className="flex-1 min-w-0 px-2 sm:px-3">
              Pick existing
            </TabsTrigger>
            {canCreate && (
              <TabsTrigger value="create" className="flex-1 min-w-0 px-2 sm:px-3">
                Create new
              </TabsTrigger>
            )}
          </TabsList>

          <TabsContent value="pick" className="mt-4 space-y-4">
            {loading ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                Loading library...
              </p>
            ) : error ? (
              <p className="py-6 text-center text-sm text-destructive">{error}</p>
            ) : candidates.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                Every technique in your library is already in this collection.
              </p>
            ) : (
              <>
                <Input
                  placeholder="Filter techniques..."
                  value={filterText}
                  onChange={(e) => setFilterText(e.target.value)}
                />

                {availableTags.length > 0 && (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs uppercase tracking-wide text-muted-foreground">
                      Tags
                    </span>
                    <div className="flex flex-wrap gap-1.5">
                      {availableTags.map((tag) => (
                        <Badge
                          key={tag}
                          variant={tagFilter.includes(tag) ? 'default' : 'outline'}
                          className="cursor-pointer"
                          onClick={() => toggleTag(tag)}
                        >
                          {tag}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}

                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={selectAllVisible}
                    disabled={filtered.length === 0}
                  >
                    Select all
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={deselectAllVisible}
                    disabled={
                      filtered.length === 0 ||
                      !filtered.some((t) => selectedIds.includes(t.id))
                    }
                  >
                    Deselect all
                  </Button>
                  <span className="ml-auto text-xs text-muted-foreground">
                    {filtered.length} of {candidates.length}
                  </span>
                </div>

                <div className="grid max-h-72 grid-cols-1 gap-2 overflow-y-auto pr-1 md:grid-cols-2">
                  {filtered.map((t) => (
                    <label
                      key={t.id}
                      className="flex cursor-pointer items-start gap-2 rounded-md border border-border p-2 hover:bg-muted/40"
                    >
                      <Checkbox
                        checked={selectedIds.includes(t.id)}
                        onCheckedChange={() => toggle(t.id)}
                      />
                      <div className="min-w-0 flex-1">
                        <span className="text-sm font-medium">{t.name}</span>
                        {t.tags && t.tags.length > 0 && (
                          <div className="mt-1 flex flex-wrap gap-1">
                            {t.tags.map((tag) => (
                              <Badge
                                key={tag.id}
                                variant="outline"
                                className="px-1.5 py-0 text-[10px]"
                              >
                                {tag.name}
                              </Badge>
                            ))}
                          </div>
                        )}
                      </div>
                    </label>
                  ))}
                </div>

                <div className="flex justify-end pt-2">
                  <Button
                    type="button"
                    onClick={handlePickSubmit}
                    disabled={selectedIds.length === 0 || submittingPick}
                  >
                    {submittingPick
                      ? 'Adding...'
                      : `Add ${selectedIds.length || ''} technique${selectedIds.length === 1 ? '' : 's'}`.trim()}
                  </Button>
                </div>
              </>
            )}
          </TabsContent>

          {canCreate && (
            <TabsContent value="create" className="mt-4">
              <TracedForm
                id="create_technique_in_collection"
                onSubmit={createForm.handleSubmit(handleCreateSubmit)}
                className="space-y-4"
              >
                <div className="space-y-2">
                  <Label htmlFor="new-collection-technique-name">
                    Technique name
                  </Label>
                  <Input
                    id="new-collection-technique-name"
                    {...createForm.register('name')}
                    placeholder="e.g. Armbar from closed guard"
                    aria-invalid={!!createForm.formState.errors.name}
                  />
                  {createForm.formState.errors.name && (
                    <p className="text-sm text-destructive">
                      {String(
                        createForm.formState.errors.name.message ||
                          'Technique name is required',
                      )}
                    </p>
                  )}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="new-collection-technique-description">
                    Description
                  </Label>
                  <Textarea
                    id="new-collection-technique-description"
                    {...createForm.register('description')}
                    placeholder="How to execute it, common mistakes, finishing details..."
                    className="min-h-24 max-h-72"
                    aria-invalid={!!createForm.formState.errors.description}
                  />
                  {createForm.formState.errors.description && (
                    <p className="text-sm text-destructive">
                      {String(
                        createForm.formState.errors.description.message ||
                          'Description is required',
                      )}
                    </p>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  Creates a global technique in your library and files it under{' '}
                  <span className="font-medium">{collectionName}</span>. The form
                  stays open so you can add a few in a row.
                </p>
                <div className="flex justify-end">
                  <Button
                    type="submit"
                    disabled={createForm.formState.isSubmitting}
                  >
                    {createForm.formState.isSubmitting
                      ? 'Creating...'
                      : 'Create technique'}
                  </Button>
                </div>
              </TracedForm>
            </TabsContent>
          )}
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
