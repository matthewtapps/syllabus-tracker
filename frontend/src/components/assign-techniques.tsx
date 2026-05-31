import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  assignCollectionToStudent,
  assignTechniquesToStudent,
  createAndAssignTechnique,
  getCollections,
  getTechniquesForAssignment,
  type AssignableTechnique,
  type Collection,
} from '@/lib/api';
import { useFormWithValidation } from './hooks/useFormErrors';
import { TracedForm } from './traced-form';
import { toast } from 'sonner';

interface AssignTechniquesProps {
  studentId: number;
  canCreateTechniques: boolean;
  /**
   * If the dialog is opened in the context of a specific collection (e.g. when
   * the page is filtered to that collection), default new assignments to file
   * under it. Use `null` for "Loose".
   */
  defaultCollectionId?: number | null;
  onAssignComplete: () => void;
}

interface CreateTechniqueFormValues {
  name: string;
  description: string;
}

interface AssignTechniquesFormValues {
  selected_technique_ids: number[];
}

const LOOSE_VALUE = 'loose';

export default function AssignTechniques({
  studentId,
  canCreateTechniques,
  defaultCollectionId,
  onAssignComplete,
}: AssignTechniquesProps) {
  const [unassignedTechniques, setUnassignedTechniques] = useState<
    AssignableTechnique[]
  >([]);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filterText, setFilterText] = useState('');
  const [tagFilter, setTagFilter] = useState<string[]>([]);
  const [availableTags, setAvailableTags] = useState<string[]>([]);
  const [tab, setTab] = useState<'assign' | 'create' | 'collection'>('assign');
  const [collectionChoice, setCollectionChoice] = useState<string>(
    defaultCollectionId ? String(defaultCollectionId) : LOOSE_VALUE,
  );
  const [bulkCollectionId, setBulkCollectionId] = useState<string>('');
  const [assigningCollection, setAssigningCollection] = useState(false);

  const createTechniqueForm = useFormWithValidation<CreateTechniqueFormValues>({
    defaultValues: { name: '', description: '' },
  });

  const assignForm = useFormWithValidation<AssignTechniquesFormValues>({
    defaultValues: { selected_technique_ids: [] },
  });

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        setLoading(true);
        const [techniques, cols] = await Promise.all([
          getTechniquesForAssignment(studentId),
          getCollections().catch(() => [] as Collection[]),
        ]);
        if (cancelled) return;
        setUnassignedTechniques(techniques);
        setCollections(cols);
        const uniqueTags = new Set<string>();
        techniques.forEach((technique) => {
          technique.tags.forEach((tag) => uniqueTags.add(tag.name));
        });
        setAvailableTags(Array.from(uniqueTags).sort());
        setError(null);
      } catch (err) {
        if (cancelled) return;
        setError('Failed to load available techniques.');
        console.error(err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [studentId]);

  const selectedIds = assignForm.watch('selected_technique_ids');

  const filteredTechniques = useMemo(() => {
    const needle = filterText.trim().toLowerCase();
    return unassignedTechniques.filter((technique) => {
      const matchesText =
        !needle ||
        technique.name.toLowerCase().includes(needle) ||
        technique.description.toLowerCase().includes(needle) ||
        technique.tags.some((tag) => tag.name.toLowerCase().includes(needle));
      const matchesTags =
        tagFilter.length === 0 ||
        tagFilter.every((tag) => technique.tags.some((t) => t.name === tag));
      return matchesText && matchesTags;
    });
  }, [unassignedTechniques, filterText, tagFilter]);

  function chosenCollectionId(): number | null {
    if (collectionChoice === LOOSE_VALUE) return null;
    const parsed = parseInt(collectionChoice, 10);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function handleCheck(id: number) {
    const current = assignForm.getValues('selected_technique_ids');
    const next = current.includes(id)
      ? current.filter((t) => t !== id)
      : [...current, id];
    assignForm.setValue('selected_technique_ids', next);
  }

  function selectAllVisible() {
    const ids = filteredTechniques.map((t) => t.id);
    const current = assignForm.getValues('selected_technique_ids');
    assignForm.setValue(
      'selected_technique_ids',
      Array.from(new Set([...current, ...ids])),
    );
  }

  function deselectAllVisible() {
    const visible = new Set(filteredTechniques.map((t) => t.id));
    const current = assignForm.getValues('selected_technique_ids');
    assignForm.setValue(
      'selected_technique_ids',
      current.filter((id) => !visible.has(id)),
    );
  }

  function toggleTagFilter(tagName: string) {
    setTagFilter((prev) =>
      prev.includes(tagName) ? prev.filter((t) => t !== tagName) : [...prev, tagName],
    );
  }

  async function handleAssignTechniques(data: AssignTechniquesFormValues) {
    if (data.selected_technique_ids.length === 0) return;
    const response = await assignTechniquesToStudent(
      studentId,
      data.selected_technique_ids,
      chosenCollectionId(),
    );
    if (!response.ok) throw response;
    assignForm.reset();
    onAssignComplete();
  }

  async function handleCreateTechnique(data: CreateTechniqueFormValues) {
    if (!data.name.trim() || !data.description.trim()) return;
    const response = await createAndAssignTechnique(
      studentId,
      data.name,
      data.description,
      chosenCollectionId(),
    );
    if (!response.ok) throw response;
    createTechniqueForm.reset();
    onAssignComplete();
  }

  async function handleAssignCollection() {
    const id = parseInt(bulkCollectionId, 10);
    if (!Number.isFinite(id)) return;
    setAssigningCollection(true);
    try {
      const response = await assignCollectionToStudent(studentId, id);
      if (!response.ok) {
        toast.error('Failed to assign collection');
        return;
      }
      onAssignComplete();
    } finally {
      setAssigningCollection(false);
    }
  }

  if (loading) {
    return (
      <div className="py-6 text-center text-sm text-muted-foreground">
        Loading available techniques...
      </div>
    );
  }
  if (error) {
    return <div className="text-sm text-destructive">{error}</div>;
  }

  return (
    <div className="space-y-4">
      {tab !== 'collection' && (
        <div className="space-y-2">
          <Label htmlFor="collection-choice" className="text-sm">
            File under
          </Label>
          <Select value={collectionChoice} onValueChange={setCollectionChoice}>
            <SelectTrigger id="collection-choice">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={LOOSE_VALUE}>Loose (no collection)</SelectItem>
              {collections.map((c) => (
                <SelectItem key={c.id} value={String(c.id)}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            Files these techniques under a collection on this student's
            syllabus. Pick "Loose (no collection)" to leave them unfiled.
          </p>
        </div>
      )}

      <Tabs
        value={tab}
        onValueChange={(v) => setTab(v as 'assign' | 'create' | 'collection')}
      >
        <TabsList className="w-full">
          <TabsTrigger value="assign" className="flex-1 min-w-0 px-2 sm:px-3">
            Pick
          </TabsTrigger>
          {canCreateTechniques && (
            <TabsTrigger value="create" className="flex-1 min-w-0 px-2 sm:px-3">
              Create
            </TabsTrigger>
          )}
          <TabsTrigger value="collection" className="flex-1 min-w-0 px-2 sm:px-3">
            Collection
          </TabsTrigger>
        </TabsList>

        <TabsContent value="assign" className="mt-4 space-y-4">
          {unassignedTechniques.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              No unassigned techniques left to assign.
            </p>
          ) : (
            <TracedForm
              id="assign_techniques"
              onSubmit={assignForm.handleSubmit(handleAssignTechniques)}
              setFieldErrors={assignForm.setFieldErrors}
              className="space-y-4"
            >
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
                        onClick={() => toggleTagFilter(tag)}
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
                  disabled={filteredTechniques.length === 0}
                >
                  Select all
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={deselectAllVisible}
                  disabled={
                    filteredTechniques.length === 0 ||
                    !filteredTechniques.some((t) => selectedIds.includes(t.id))
                  }
                >
                  Deselect all
                </Button>
                <span className="ml-auto text-xs text-muted-foreground">
                  {filteredTechniques.length} of {unassignedTechniques.length}
                </span>
              </div>

              <div className="grid max-h-72 grid-cols-1 gap-2 overflow-y-auto pr-1 md:grid-cols-2">
                {filteredTechniques.map((technique) => (
                  <label
                    key={technique.id}
                    className="flex cursor-pointer items-start gap-2 rounded-md border border-border p-2 hover:bg-muted/40"
                  >
                    <Checkbox
                      checked={selectedIds.includes(technique.id)}
                      onCheckedChange={() => handleCheck(technique.id)}
                    />
                    <div className="min-w-0 flex-1">
                      <span className="text-sm font-medium">{technique.name}</span>
                      {technique.tags.length > 0 && (
                        <div className="mt-1 flex flex-wrap gap-1">
                          {technique.tags.map((tag) => (
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
                  type="submit"
                  disabled={
                    selectedIds.length === 0 || assignForm.formState.isSubmitting
                  }
                >
                  {assignForm.formState.isSubmitting
                    ? 'Assigning...'
                    : `Assign ${selectedIds.length || ''} technique${selectedIds.length === 1 ? '' : 's'}`.trim()}
                </Button>
              </div>
            </TracedForm>
          )}
        </TabsContent>

        {canCreateTechniques && (
          <TabsContent value="create" className="mt-4">
            <TracedForm
              id="create_technique"
              onSubmit={createTechniqueForm.handleSubmit(handleCreateTechnique)}
              setFieldErrors={createTechniqueForm.setFieldErrors}
              className="space-y-4"
            >
              <div className="space-y-2">
                <Label htmlFor="new-technique-name">Technique name</Label>
                <Input
                  id="new-technique-name"
                  {...createTechniqueForm.register('name')}
                  placeholder="e.g. Armbar from closed guard"
                  aria-invalid={!!createTechniqueForm.formState.errors.name}
                />
                {createTechniqueForm.formState.errors.name && (
                  <p className="text-sm text-destructive">
                    {String(
                      createTechniqueForm.formState.errors.name.message ||
                        'Technique name is required',
                    )}
                  </p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="new-technique-description">Description</Label>
                <Textarea
                  id="new-technique-description"
                  {...createTechniqueForm.register('description')}
                  placeholder="How to execute it, common mistakes, finishing details..."
                  className="min-h-24"
                  aria-invalid={!!createTechniqueForm.formState.errors.description}
                />
                {createTechniqueForm.formState.errors.description && (
                  <p className="text-sm text-destructive">
                    {String(
                      createTechniqueForm.formState.errors.description.message ||
                        'Description is required',
                    )}
                  </p>
                )}
              </div>
              <div className="flex justify-end">
                <Button type="submit" disabled={createTechniqueForm.formState.isSubmitting}>
                  {createTechniqueForm.formState.isSubmitting
                    ? 'Creating...'
                    : 'Create & assign'}
                </Button>
              </div>
            </TracedForm>
          </TabsContent>
        )}

        <TabsContent value="collection" className="mt-4 space-y-4">
          {collections.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              No collections yet. Create one from the Collections page.
            </p>
          ) : (
            <>
              <div className="space-y-2">
                <Label htmlFor="bulk-collection">Collection</Label>
                <Select value={bulkCollectionId} onValueChange={setBulkCollectionId}>
                  <SelectTrigger id="bulk-collection">
                    <SelectValue placeholder="Pick a collection" />
                  </SelectTrigger>
                  <SelectContent>
                    {collections.map((c) => (
                      <SelectItem key={c.id} value={String(c.id)}>
                        {c.name} ({c.technique_count}{' '}
                        {c.technique_count === 1 ? 'technique' : 'techniques'})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Assigns every technique in this collection to the student,
                  filed under it. Techniques the student already has are moved
                  into this collection (progress is preserved).
                </p>
              </div>
              <div className="flex justify-end">
                <Button
                  type="button"
                  onClick={handleAssignCollection}
                  disabled={!bulkCollectionId || assigningCollection}
                >
                  {assigningCollection ? 'Assigning...' : 'Assign collection'}
                </Button>
              </div>
            </>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
