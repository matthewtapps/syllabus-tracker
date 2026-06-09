import { useMemo, useState } from 'react';
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
import { type Syllabus } from '@/lib/api';
import {
  useSyllabuses,
  useStudentUnassignedTechniques,
} from '@/lib/queries';
import {
  useAssignSyllabusToStudent,
  useAssignTechniquesToStudent,
  useCreateAndAssignTechnique,
} from '@/lib/mutations';
import { handleApiFormError, useFormWithValidation } from './hooks/useFormErrors';
import { TracedForm } from './traced-form';
import { toast } from 'sonner';

interface AssignTechniquesProps {
  studentId: number;
  canCreateTechniques: boolean;
  /**
   * If the dialog is opened in the context of a specific syllabus (e.g. when
   * the page is filtered to that syllabus), default new assignments to file
   * under it. Use `null` for "Loose".
   */
  defaultSyllabusId?: number | null;
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
  defaultSyllabusId,
  onAssignComplete,
}: AssignTechniquesProps) {
  const unassignedQuery = useStudentUnassignedTechniques(studentId);
  const syllabusesQuery = useSyllabuses();
  const unassignedTechniques = useMemo(
    () => unassignedQuery.data ?? [],
    [unassignedQuery.data],
  );
  const syllabuses: Syllabus[] = useMemo(
    () => syllabusesQuery.data ?? [],
    [syllabusesQuery.data],
  );
  const loading = unassignedQuery.isLoading;
  const error = unassignedQuery.error ? 'Failed to load available techniques.' : null;
  const assignMutation = useAssignTechniquesToStudent();
  const createMutation = useCreateAndAssignTechnique();
  const assignSyllabusMutation = useAssignSyllabusToStudent();
  const [filterText, setFilterText] = useState('');
  const [tagFilter, setTagFilter] = useState<string[]>([]);
  const availableTags = useMemo(() => {
    const set = new Set<string>();
    unassignedTechniques.forEach((t) => t.tags.forEach((tag) => set.add(tag.name)));
    return Array.from(set).sort();
  }, [unassignedTechniques]);
  const [tab, setTab] = useState<'assign' | 'create' | 'syllabus'>('assign');
  const [syllabusChoice, setSyllabusChoice] = useState<string>(
    defaultSyllabusId ? String(defaultSyllabusId) : LOOSE_VALUE,
  );
  const [bulkSyllabusId, setBulkSyllabusId] = useState<string>('');
  const [assigningSyllabus, setAssigningSyllabus] = useState(false);

  const createTechniqueForm = useFormWithValidation<CreateTechniqueFormValues>({
    defaultValues: { name: '', description: '' },
  });

  const assignForm = useFormWithValidation<AssignTechniquesFormValues>({
    defaultValues: { selected_technique_ids: [] },
  });

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

  function chosenSyllabusId(): number | null {
    if (syllabusChoice === LOOSE_VALUE) return null;
    const parsed = parseInt(syllabusChoice, 10);
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
    try {
      await assignMutation.mutateAsync({
        studentId,
        techniqueIds: data.selected_technique_ids,
        syllabusId: chosenSyllabusId(),
      });
      assignForm.reset();
      onAssignComplete();
    } catch (err) {
      const handled = await handleApiFormError(
        err,
        assignForm.setError,
        Object.keys(assignForm.getValues()),
      );
      if (!handled) toast.error(err instanceof Error ? err.message : 'Failed to assign techniques');
    }
  }

  async function handleCreateTechnique(data: CreateTechniqueFormValues) {
    if (!data.name.trim() || !data.description.trim()) return;
    try {
      await createMutation.mutateAsync({
        studentId,
        name: data.name,
        description: data.description,
        syllabusId: chosenSyllabusId(),
      });
      createTechniqueForm.reset();
      onAssignComplete();
    } catch (err) {
      const handled = await handleApiFormError(
        err,
        createTechniqueForm.setError,
        Object.keys(createTechniqueForm.getValues()),
      );
      if (!handled) toast.error(err instanceof Error ? err.message : 'Failed to create technique');
    }
  }

  async function handleAssignSyllabus() {
    const id = parseInt(bulkSyllabusId, 10);
    if (!Number.isFinite(id)) return;
    setAssigningSyllabus(true);
    try {
      await assignSyllabusMutation.mutateAsync({
        studentId,
        syllabusId: id,
      });
      onAssignComplete();
    } catch {
      toast.error('Failed to assign syllabus');
    } finally {
      setAssigningSyllabus(false);
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

  const fileUnderField = (
    <div className="space-y-2">
      <Label htmlFor="syllabus-choice" className="text-sm">
        File under
      </Label>
      <Select value={syllabusChoice} onValueChange={setSyllabusChoice}>
        <SelectTrigger id="syllabus-choice">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={LOOSE_VALUE}>Loose (no syllabus)</SelectItem>
          {syllabuses.map((s) => (
            <SelectItem key={s.id} value={String(s.id)}>
              {s.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p className="text-xs text-muted-foreground">
        Files these techniques under a syllabus on this student's profile.
        Pick "Loose (no syllabus)" to leave them unfiled.
      </p>
    </div>
  );

  return (
    <Tabs
      value={tab}
      onValueChange={(v) => setTab(v as 'assign' | 'create' | 'syllabus')}
      className="flex min-h-0 flex-1 flex-col"
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
          <TabsTrigger value="syllabus" className="flex-1 min-w-0 px-2 sm:px-3">
            Syllabus
          </TabsTrigger>
        </TabsList>

        <TabsContent value="assign" className="mt-4 flex min-h-0 flex-col">
          {unassignedTechniques.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              No unassigned techniques left to assign.
            </p>
          ) : (
            <TracedForm
              id="assign_techniques"
              onSubmit={assignForm.handleSubmit(handleAssignTechniques)}
              className="flex min-h-0 flex-1 flex-col gap-4"
            >
              {fileUnderField}

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

              <div className="grid min-h-0 flex-1 grid-cols-1 gap-2 overflow-y-auto pr-1 md:grid-cols-2">
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
          <TabsContent value="create" className="mt-4 min-h-0 overflow-y-auto">
            <TracedForm
              id="create_technique"
              onSubmit={createTechniqueForm.handleSubmit(handleCreateTechnique)}
              className="space-y-4"
            >
              {fileUnderField}
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

        <TabsContent value="syllabus" className="mt-4 min-h-0 space-y-4 overflow-y-auto">
          {syllabuses.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              No syllabuses yet. Create one from the Syllabuses page.
            </p>
          ) : (
            <>
              <div className="space-y-2">
                <Label htmlFor="bulk-syllabus">Syllabus</Label>
                <Select value={bulkSyllabusId} onValueChange={setBulkSyllabusId}>
                  <SelectTrigger id="bulk-syllabus">
                    <SelectValue placeholder="Pick a syllabus" />
                  </SelectTrigger>
                  <SelectContent>
                    {syllabuses.map((s) => (
                      <SelectItem key={s.id} value={String(s.id)}>
                        {s.name} ({s.technique_count}{' '}
                        {s.technique_count === 1 ? 'technique' : 'techniques'})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Assigns every technique in this syllabus to the student,
                  filed under it. Techniques the student already has are moved
                  into this syllabus (progress is preserved).
                </p>
              </div>
              <div className="flex justify-end">
                <Button
                  type="button"
                  onClick={handleAssignSyllabus}
                  disabled={!bulkSyllabusId || assigningSyllabus}
                >
                  {assigningSyllabus ? 'Assigning...' : 'Assign syllabus'}
                </Button>
              </div>
            </>
          )}
        </TabsContent>
    </Tabs>
  );
}
