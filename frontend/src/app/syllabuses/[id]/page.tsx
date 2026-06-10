import { useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  NotebookPen,
  Pencil,
  Plus,
  Search,
  Trash2,
  UserPlus,
  Users,
} from 'lucide-react';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { TracedForm } from '@/components/traced-form';
import { EmptyState } from '@/components/empty-state';
import { Accordion } from '@/components/ui/accordion';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { TechniqueRow } from '@/components/technique-row';
import {
  useLibraryTechniques,
  useStudents,
  useSyllabus,
  useSyllabusStudents,
} from '@/lib/queries';
import {
  useAddTechniqueToSyllabus,
  useDeleteSyllabus,
  useRemoveTechniqueFromSyllabus,
  useUpdateSyllabus,
} from '@/lib/mutations';
import {
  handleApiFormError,
  useFormWithValidation,
} from '@/components/hooks/useFormErrors';
import type {
  LibraryTechniqueRow,
  PropagationMode,
  SyllabusTechniqueRow,
  User,
} from '@/lib/api';
import { AssignStudentDialog } from '../components/assign-student-dialog';

const editSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100, 'Name is too long'),
  description: z.string().max(1000).optional(),
});
type EditValues = z.infer<typeof editSchema>;

// The syllabus detail endpoint returns SyllabusTechniqueRow shape; the
// shared TechniqueRow expects LibraryTechniqueRow. Adapt at the page
// boundary -- aggregate counts default to 0 since the detail response
// does not carry them.
function toLibraryShape(t: SyllabusTechniqueRow): LibraryTechniqueRow {
  return {
    id: t.technique_id,
    name: t.name,
    description: t.description,
    tags: t.tags,
    collection_ids: [],
    collection_count: 0,
    student_count: 0,
    video_count: 0,
    last_activity_at: null,
    is_pinned: false,
  };
}

export default function SyllabusDetailPage() {
  const params = useParams<{ id: string }>();
  const syllabusId = params.id ? parseInt(params.id, 10) : NaN;
  if (!Number.isFinite(syllabusId)) {
    return <Navigate to="/syllabuses" replace />;
  }
  return <SyllabusDetail syllabusId={syllabusId} />;
}

function SyllabusDetail({ syllabusId }: { syllabusId: number }) {
  const navigate = useNavigate();
  const syllabusQuery = useSyllabus(syllabusId);
  const studentsQuery = useSyllabusStudents(syllabusId);
  const syllabus = syllabusQuery.data;
  const assignedIds = useMemo(
    () => studentsQuery.data ?? [],
    [studentsQuery.data],
  );

  const [editing, setEditing] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<{ id: number; name: string } | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [techSearch, setTechSearch] = useState('');
  const [techTags, setTechTags] = useState<string[]>([]);
  const [techExpanded, setTechExpanded] = useState<string>('');
  const [studentSearch, setStudentSearch] = useState('');

  const deleteMutation = useDeleteSyllabus();

  if (syllabusQuery.isLoading) {
    return (
      <div className="container mx-auto px-4 py-6 sm:px-6 md:py-8">
        <div className="h-6 w-1/3 animate-pulse rounded bg-muted" />
        <div className="mt-2 h-4 w-2/3 animate-pulse rounded bg-muted" />
      </div>
    );
  }
  if (!syllabus) {
    return (
      <div className="container mx-auto px-4 py-6 sm:px-6 md:py-8">
        <EmptyState
          icon={NotebookPen}
          title="Syllabus not found"
          description="It may have been deleted or you may not have access."
          action={
            <Button variant="outline" onClick={() => navigate('/syllabuses')}>
              Back to syllabuses
            </Button>
          }
        />
      </div>
    );
  }

  const syllabusName = syllabus.name;
  async function handleDelete() {
    try {
      await deleteMutation.mutateAsync(syllabusId);
      toast.success(`Deleted ${syllabusName}`);
      navigate('/syllabuses');
    } catch {
      toast.error('Failed to delete syllabus');
    }
  }

  return (
    <div className="container mx-auto px-4 py-6 sm:px-6 md:py-8 space-y-6">
      <div>
        <Button
          variant="ghost"
          size="sm"
          className="mb-3 -ml-2 gap-1.5"
          onClick={() => navigate('/syllabuses')}
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
          Back to Syllabus Library
        </Button>
        {editing ? (
          <EditHeader syllabus={syllabus} onDone={() => setEditing(false)} />
        ) : (
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h1 className="flex items-center gap-2 text-base font-semibold">
                <NotebookPen className="h-4 w-4" aria-hidden />
                {syllabus.name}
              </h1>
              {syllabus.description && (
                <p className="mt-1 text-xs text-muted-foreground whitespace-pre-wrap">
                  {syllabus.description}
                </p>
              )}
            </div>
            <div className="flex shrink-0 gap-1">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setEditing(true)}
                aria-label="Edit"
              >
                <Pencil className="h-4 w-4" aria-hidden />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setDeleteOpen(true)}
                aria-label="Delete"
              >
                <Trash2 className="h-4 w-4 text-destructive" aria-hidden />
              </Button>
            </div>
          </div>
        )}
      </div>

      <Tabs defaultValue="techniques" className="space-y-3">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="techniques" className="gap-1.5">
            <NotebookPen className="h-3.5 w-3.5" aria-hidden />
            Techniques
            <span className="text-muted-foreground">
              ({syllabus.techniques.length})
            </span>
          </TabsTrigger>
          <TabsTrigger value="students" className="gap-1.5">
            <Users className="h-3.5 w-3.5" aria-hidden />
            Students
            <span className="text-muted-foreground">
              ({assignedIds.length})
            </span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="techniques" className="mt-0">
          <TechniquesSection
            syllabusId={syllabusId}
            techniques={syllabus.techniques}
            techSearch={techSearch}
            setTechSearch={setTechSearch}
            techTags={techTags}
            setTechTags={setTechTags}
            techExpanded={techExpanded}
            setTechExpanded={setTechExpanded}
            onAdd={() => setAddOpen(true)}
            onRemove={(id, name) => setRemoveTarget({ id, name })}
          />
        </TabsContent>

        <TabsContent value="students" className="mt-0 space-y-2">
          {assignedIds.length > 0 && (
            <div className="relative">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
              <Input
                placeholder="Search students"
                value={studentSearch}
                onChange={(e) => setStudentSearch(e.target.value)}
                className="pl-9"
              />
            </div>
          )}
          <Button
            className="w-full gap-1.5"
            onClick={() => setAssignOpen(true)}
          >
            <UserPlus className="h-4 w-4" aria-hidden />
            Assign student
          </Button>
          <div className="overflow-hidden rounded-lg border border-border bg-card">
            {assignedIds.length === 0 ? (
              <p className="px-6 py-8 text-center text-sm text-muted-foreground">
                Nobody is assigned yet.
              </p>
            ) : (
              <AssignedStudentsList
                studentIds={assignedIds}
                syllabusId={syllabusId}
                filterText={studentSearch}
              />
            )}
          </div>
        </TabsContent>
      </Tabs>

      <AddTechniqueDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        syllabusId={syllabusId}
        existingTechniqueIds={new Set(syllabus.techniques.map((t) => t.technique_id))}
      />
      <RemoveTechniqueDialog
        target={removeTarget}
        onClose={() => setRemoveTarget(null)}
        syllabusId={syllabusId}
      />
      <AssignStudentDialog
        open={assignOpen}
        onOpenChange={setAssignOpen}
        syllabusId={syllabusId}
        syllabusName={syllabus.name}
      />
      <DeleteSyllabusDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        onConfirm={handleDelete}
        syllabusName={syllabus.name}
      />
    </div>
  );
}

function EditHeader({
  syllabus,
  onDone,
}: {
  syllabus: { id: number; name: string; description: string };
  onDone: () => void;
}) {
  const updateMutation = useUpdateSyllabus();
  const form = useFormWithValidation<EditValues>({
    resolver: zodResolver(editSchema),
    defaultValues: {
      name: syllabus.name,
      description: syllabus.description,
    },
  });

  async function handleSubmit(values: EditValues) {
    try {
      await updateMutation.mutateAsync({
        syllabusId: syllabus.id,
        data: {
          name: values.name,
          description: values.description ?? null,
        },
      });
      toast.success('Syllabus updated');
      onDone();
    } catch (err) {
      const handled = await handleApiFormError(
        err,
        form.setError,
        Object.keys(form.getValues()),
      );
      if (!handled) toast.error('Failed to update syllabus');
    }
  }

  return (
    <Form {...form}>
      <TracedForm
        id="update_syllabus"
        onSubmit={form.handleSubmit(handleSubmit)}
        className="space-y-3"
      >
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Name</FormLabel>
              <FormControl>
                <Input autoFocus {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="description"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Description</FormLabel>
              <FormControl>
                <Textarea {...field} className="min-h-20" />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" size="sm" onClick={onDone}>
            Cancel
          </Button>
          <Button size="sm" type="submit" disabled={form.formState.isSubmitting}>
            Save
          </Button>
        </div>
      </TracedForm>
    </Form>
  );
}

function AddTechniqueDialog({
  open,
  onOpenChange,
  syllabusId,
  existingTechniqueIds,
}: {
  open: boolean;
  onOpenChange: (b: boolean) => void;
  syllabusId: number;
  existingTechniqueIds: Set<number>;
}) {
  const libraryQuery = useLibraryTechniques();
  const techniques = useMemo(
    () => (libraryQuery.data ?? []).filter((t) => !existingTechniqueIds.has(t.id)),
    [libraryQuery.data, existingTechniqueIds],
  );
  const addMutation = useAddTechniqueToSyllabus();
  const [propagateToActive, setPropagateToActive] = useState(true);
  const [search, setSearch] = useState('');
  const [activeTags, setActiveTags] = useState<string[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());

  // Reset everything when the modal closes so re-open starts clean.
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

  // Counters for the "X of Y" line. Selection is independent of the
  // filter: hiding a row via search or tag doesn't deselect it.
  const visibleSelectedCount = useMemo(
    () => filtered.filter((t) => selected.has(t.id)).length,
    [filtered, selected],
  );
  const allVisibleSelected =
    filtered.length > 0 && visibleSelectedCount === filtered.length;

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

  function selectAllVisible() {
    setSelected((prev) => {
      const next = new Set(prev);
      filtered.forEach((t) => next.add(t.id));
      return next;
    });
  }

  function deselectAllVisible() {
    setSelected((prev) => {
      const next = new Set(prev);
      filtered.forEach((t) => next.delete(t.id));
      return next;
    });
  }

  async function handleAdd() {
    if (selected.size === 0) return;
    const propagation: PropagationMode = propagateToActive
      ? 'cascade'
      : 'syllabus_only';
    const ids = Array.from(selected);
    let added = 0;
    for (const id of ids) {
      try {
        await addMutation.mutateAsync({
          syllabusId,
          techniqueId: id,
          propagation,
        });
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
        // Fixed height so the modal does not jump shorter when the user
        // filters the list down to a couple of rows. The list reservation
        // below absorbs the difference instead.
        className="flex h-[85vh] flex-col gap-3 sm:h-[80vh]"
        aria-describedby={undefined}
      >
        <DialogHeader>
          <DialogTitle>Add techniques</DialogTitle>
        </DialogHeader>

        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search techniques"
        />

        {availableTags.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {availableTags.map((tag) => {
              const on = activeTags.includes(tag);
              return (
                <Badge
                  key={tag}
                  variant={on ? 'default' : 'outline'}
                  className="cursor-pointer select-none"
                  onClick={() => toggleTag(tag)}
                >
                  {tag}
                </Badge>
              );
            })}
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

        <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
          <span>
            <span className="font-medium text-foreground">
              {selected.size}
            </span>{' '}
            selected · {filtered.length} of {techniques.length} shown
          </span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-xs"
            disabled={filtered.length === 0}
            onClick={allVisibleSelected ? deselectAllVisible : selectAllVisible}
          >
            {allVisibleSelected ? 'Deselect all visible' : 'Select all visible'}
          </Button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto rounded border border-border bg-card">
          {filtered.length === 0 ? (
            <p className="px-4 py-6 text-center text-xs text-muted-foreground">
              {techniques.length === 0
                ? 'Every library technique is already in this syllabus.'
                : 'No techniques match the current filters.'}
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {filtered.map((t) => {
                const checked = selected.has(t.id);
                return (
                  <li key={t.id}>
                    <label
                      htmlFor={`add-tech-${t.id}`}
                      className="flex cursor-pointer items-start gap-3 px-3 py-2 transition-colors hover:bg-muted/40"
                    >
                      <Checkbox
                        id={`add-tech-${t.id}`}
                        checked={checked}
                        onCheckedChange={() => toggle(t.id)}
                        className="mt-0.5"
                      />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{t.name}</p>
                        {t.tags.length > 0 && (
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
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <label
          htmlFor="add-propagate-switch"
          className="flex cursor-pointer items-center justify-between gap-3 rounded-md border border-border bg-muted/30 p-3"
        >
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-medium">
              Update active assignments
            </span>
            <span className="block text-xs text-muted-foreground">
              Students currently working through this syllabus get a new technique.
            </span>
          </span>
          <Switch
            id="add-propagate-switch"
            checked={propagateToActive}
            onCheckedChange={setPropagateToActive}
          />
        </label>

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
                  ? 'Add 1 technique'
                  : `Add ${selected.size} techniques`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RemoveTechniqueDialog({
  target,
  onClose,
  syllabusId,
}: {
  target: { id: number; name: string } | null;
  onClose: () => void;
  syllabusId: number;
}) {
  const removeMutation = useRemoveTechniqueFromSyllabus();
  const [propagateToActive, setPropagateToActive] = useState(true);

  // Reset to the safe default whenever a new target opens the dialog.
  useEffect(() => {
    setPropagateToActive(true);
  }, [target?.id]);

  if (!target) return null;

  async function handleConfirm() {
    if (!target) return;
    const propagation: PropagationMode = propagateToActive
      ? 'cascade'
      : 'syllabus_only';
    try {
      await removeMutation.mutateAsync({
        syllabusId,
        techniqueId: target.id,
        propagation,
      });
      toast.success(`Removed ${target.name}`);
      onClose();
    } catch {
      toast.error('Failed to remove technique');
    }
  }

  return (
    <Dialog open={!!target} onOpenChange={(o) => !o && onClose()}>
      <DialogContent aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>Remove {target.name}?</DialogTitle>
        </DialogHeader>
        <label
          htmlFor="remove-propagate-switch"
          className="flex cursor-pointer items-center justify-between gap-3 rounded-md border border-border bg-muted/30 p-3"
        >
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-medium">
              Update active assignments
            </span>
            <span className="block text-xs text-muted-foreground">
              Students currently working through this syllabus lose this
              technique. Their attempts and notes are preserved.
            </span>
          </span>
          <Switch
            id="remove-propagate-switch"
            checked={propagateToActive}
            onCheckedChange={setPropagateToActive}
          />
        </label>
        <DialogFooter className="grid grid-cols-2 gap-2 sm:flex-none sm:justify-stretch">
          <Button
            variant="outline"
            onClick={onClose}
            className="w-full"
            disabled={removeMutation.isPending}
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={handleConfirm}
            className="w-full"
            disabled={removeMutation.isPending}
          >
            {removeMutation.isPending ? 'Removing...' : 'Remove'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AssignedStudentsList({
  studentIds,
  syllabusId,
  filterText,
}: {
  studentIds: number[];
  syllabusId: number;
  filterText: string;
}) {
  const usersQuery = useStudents('alphabetical', false);
  const studentsById = useMemo(() => {
    const map = new Map<number, User>();
    (usersQuery.data ?? []).forEach((u: User) => map.set(u.id, u));
    return map;
  }, [usersQuery.data]);

  const filtered = useMemo(() => {
    const needle = filterText.trim().toLowerCase();
    if (!needle) return studentIds;
    return studentIds.filter((id) => {
      const u = studentsById.get(id);
      if (!u) return false;
      return (
        (u.display_name?.toLowerCase().includes(needle) ?? false) ||
        u.username.toLowerCase().includes(needle)
      );
    });
  }, [studentIds, studentsById, filterText]);

  if (filtered.length === 0) {
    return (
      <p className="px-6 py-8 text-center text-sm text-muted-foreground">
        No students match the search.
      </p>
    );
  }

  return (
    <ul className="divide-y divide-border">
      {filtered.map((id) => {
        const user = studentsById.get(id);
        return (
          <li key={id}>
            <Link
              to={`/student/${id}/syllabuses/${syllabusId}`}
              className="block px-4 py-3 transition-colors hover:bg-muted/40"
            >
              <p className="truncate text-sm font-medium">
                {user?.display_name || user?.username || `Student ${id}`}
              </p>
              {user?.username && (
                <p className="truncate text-xs text-muted-foreground">
                  {user.username}
                </p>
              )}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function TechniquesSection({
  syllabusId,
  techniques,
  techSearch,
  setTechSearch,
  techTags,
  setTechTags,
  techExpanded,
  setTechExpanded,
  onAdd,
  onRemove,
}: {
  syllabusId: number;
  techniques: SyllabusTechniqueRow[];
  techSearch: string;
  setTechSearch: (v: string) => void;
  techTags: string[];
  setTechTags: (v: string[]) => void;
  techExpanded: string;
  setTechExpanded: (v: string) => void;
  onAdd: () => void;
  onRemove: (techniqueId: number, name: string) => void;
}) {
  const availableTags = useMemo(() => {
    const set = new Set<string>();
    techniques.forEach((t) => t.tags.forEach((tag) => set.add(tag.name)));
    return Array.from(set).sort();
  }, [techniques]);

  const filtered = useMemo(() => {
    const needle = techSearch.trim().toLowerCase();
    return techniques.filter((t) => {
      const matchesText =
        !needle ||
        t.name.toLowerCase().includes(needle) ||
        t.description.toLowerCase().includes(needle) ||
        t.tags.some((tag) => tag.name.toLowerCase().includes(needle));
      const matchesTags =
        techTags.length === 0 ||
        techTags.every((tag) => t.tags.some((x) => x.name === tag));
      return matchesText && matchesTags;
    });
  }, [techniques, techSearch, techTags]);

  function toggleTag(tag: string) {
    setTechTags(
      techTags.includes(tag) ? techTags.filter((t) => t !== tag) : [...techTags, tag],
    );
  }

  return (
    <section className="space-y-2">
      <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Techniques
      </h2>
      {techniques.length > 0 && (
        <div className="space-y-2">
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              placeholder="Search techniques"
              value={techSearch}
              onChange={(e) => setTechSearch(e.target.value)}
              className="pl-9"
            />
          </div>
          {availableTags.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {availableTags.map((tag) => {
                const active = techTags.includes(tag);
                return (
                  <Badge
                    key={tag}
                    variant={active ? 'default' : 'outline'}
                    className="cursor-pointer select-none"
                    onClick={() => toggleTag(tag)}
                  >
                    {tag}
                  </Badge>
                );
              })}
              {techTags.length > 0 && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2 text-xs"
                  onClick={() => setTechTags([])}
                >
                  Clear
                </Button>
              )}
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            {filtered.length === techniques.length
              ? `${techniques.length} ${
                  techniques.length === 1 ? 'technique' : 'techniques'
                }`
              : `${filtered.length} of ${techniques.length} techniques`}
          </p>
        </div>
      )}
      <Button className="w-full gap-1.5" onClick={onAdd}>
        <Plus className="h-4 w-4" aria-hidden />
        Add technique
      </Button>
      <div className="overflow-hidden rounded-lg border border-border bg-card">
        {techniques.length === 0 ? (
          <EmptyState
            icon={NotebookPen}
            title="No techniques yet"
            description="Add techniques from the library to build out this syllabus."
          />
        ) : filtered.length === 0 ? (
          <p className="px-6 py-10 text-center text-sm text-muted-foreground">
            No techniques match the current filters.
          </p>
        ) : (
          <Accordion
            type="single"
            collapsible
            value={techExpanded}
            onValueChange={setTechExpanded}
          >
            {filtered.map((t) => {
              const value = String(t.technique_id);
              return (
                <TechniqueRow
                  key={t.technique_id}
                  technique={toLibraryShape(t)}
                  context={{
                    kind: 'syllabus-management',
                    syllabusId,
                    onRemove: (tech) => onRemove(tech.id, tech.name),
                  }}
                  value={value}
                  isOpen={techExpanded === value}
                />
              );
            })}
          </Accordion>
        )}
      </div>
    </section>
  );
}

function DeleteSyllabusDialog({
  open,
  onOpenChange,
  onConfirm,
  syllabusName,
}: {
  open: boolean;
  onOpenChange: (b: boolean) => void;
  onConfirm: () => void;
  syllabusName: string;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete {syllabusName}?</DialogTitle>
          <DialogDescription>
            Removes the syllabus, all its memberships, and every student assignment to it.
            Attempts and notes already logged are removed too. This cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={onConfirm}>
            Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
