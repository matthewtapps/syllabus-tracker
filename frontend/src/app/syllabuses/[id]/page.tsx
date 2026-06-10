import { useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, NotebookPen, Pencil, Plus, Trash2, UserPlus, Users, X } from 'lucide-react';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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
import {
  useLibraryTechniques,
  useStudents,
  useSyllabus,
  useSyllabusStudents,
} from '@/lib/queries';
import {
  useAddTechniqueToSyllabus,
  useAssignSyllabusToStudent,
  useDeleteSyllabus,
  useRemoveTechniqueFromSyllabus,
  useUpdateSyllabus,
} from '@/lib/mutations';
import {
  handleApiFormError,
  useFormWithValidation,
} from '@/components/hooks/useFormErrors';
import type { PropagationMode, User } from '@/lib/api';

const editSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100, 'Name is too long'),
  description: z.string().max(1000).optional(),
});
type EditValues = z.infer<typeof editSchema>;

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
          Back
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

      <section className="space-y-2">
        <div className="flex items-end justify-between gap-2">
          <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Techniques
          </h2>
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5"
            onClick={() => setAddOpen(true)}
          >
            <Plus className="h-4 w-4" aria-hidden />
            Add technique
          </Button>
        </div>
        <div className="overflow-hidden rounded-lg border border-border bg-card">
          {syllabus.techniques.length === 0 ? (
            <EmptyState
              icon={NotebookPen}
              title="No techniques yet"
              description="Add techniques from the library to build out this syllabus."
            />
          ) : (
            <ul className="divide-y divide-border">
              {syllabus.techniques.map((t) => (
                <li
                  key={t.technique_id}
                  className="flex items-center justify-between gap-2 px-4 py-3"
                >
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
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() =>
                      setRemoveTarget({ id: t.technique_id, name: t.name })
                    }
                    aria-label={`Remove ${t.name}`}
                  >
                    <X className="h-4 w-4 text-muted-foreground" aria-hidden />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <section className="space-y-2">
        <div className="flex items-end justify-between gap-2">
          <h2 className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            <Users className="h-3.5 w-3.5" aria-hidden />
            Assigned students
          </h2>
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5"
            onClick={() => setAssignOpen(true)}
          >
            <UserPlus className="h-4 w-4" aria-hidden />
            Assign student
          </Button>
        </div>
        <div className="overflow-hidden rounded-lg border border-border bg-card">
          {assignedIds.length === 0 ? (
            <p className="px-6 py-8 text-center text-sm text-muted-foreground">
              Nobody is assigned yet.
            </p>
          ) : (
            <AssignedStudentsList
              studentIds={assignedIds}
              syllabusId={syllabusId}
            />
          )}
        </div>
      </section>

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
        assignedIds={assignedIds}
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
  const [propagation, setPropagation] = useState<PropagationMode>('cascade');
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return techniques;
    return techniques.filter((t) => t.name.toLowerCase().includes(needle));
  }, [techniques, search]);

  async function handleAdd(techniqueId: number, name: string) {
    try {
      await addMutation.mutateAsync({
        syllabusId,
        techniqueId,
        propagation,
      });
      toast.success(`Added ${name}`);
    } catch {
      toast.error('Failed to add technique');
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Add technique</DialogTitle>
          <DialogDescription>
            Pick a technique from the library to add to this syllabus.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search techniques"
          />
          <fieldset className="space-y-1.5 rounded-md border border-border p-3">
            <legend className="px-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Apply to existing assignments
            </legend>
            <label className="flex items-start gap-2 text-sm">
              <input
                type="radio"
                name="add-propagation"
                value="cascade"
                checked={propagation === 'cascade'}
                onChange={() => setPropagation('cascade')}
                className="mt-1"
              />
              <span>
                <span className="block font-medium">Add to every active assignment</span>
                <span className="text-xs text-muted-foreground">
                  Students working through this syllabus get a new red entry.
                </span>
              </span>
            </label>
            <label className="flex items-start gap-2 text-sm">
              <input
                type="radio"
                name="add-propagation"
                value="syllabus_only"
                checked={propagation === 'syllabus_only'}
                onChange={() => setPropagation('syllabus_only')}
                className="mt-1"
              />
              <span>
                <span className="block font-medium">Just this syllabus</span>
                <span className="text-xs text-muted-foreground">
                  Existing assignments do not change. Future assignments include it.
                </span>
              </span>
            </label>
          </fieldset>
          <div className="max-h-64 overflow-y-auto rounded border border-border bg-card">
            {filtered.length === 0 ? (
              <p className="px-4 py-6 text-center text-xs text-muted-foreground">
                {techniques.length === 0
                  ? 'Every library technique is already in this syllabus.'
                  : 'No techniques match the search.'}
              </p>
            ) : (
              <ul className="divide-y divide-border">
                {filtered.map((t) => (
                  <li
                    key={t.id}
                    className="flex items-center justify-between gap-2 px-3 py-2"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{t.name}</p>
                      {t.description && (
                        <p className="truncate text-xs text-muted-foreground">
                          {t.description}
                        </p>
                      )}
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleAdd(t.id, t.name)}
                      disabled={addMutation.isPending}
                    >
                      Add
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Done
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
  const [propagation, setPropagation] = useState<PropagationMode | null>(null);

  // Reset selection when target changes so the next open requires a fresh choice.
  useEffect(() => {
    setPropagation(null);
  }, [target?.id]);

  if (!target) return null;

  async function handleConfirm() {
    if (!propagation || !target) return;
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
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Remove {target.name}?</DialogTitle>
          <DialogDescription>
            Pick how this should affect students already working through this syllabus.
          </DialogDescription>
        </DialogHeader>
        <fieldset className="space-y-2">
          <label className="flex items-start gap-2 text-sm">
            <input
              type="radio"
              name="remove-propagation"
              value="syllabus_only"
              checked={propagation === 'syllabus_only'}
              onChange={() => setPropagation('syllabus_only')}
              className="mt-1"
            />
            <span>
              <span className="block font-medium">Remove from syllabus only</span>
              <span className="text-xs text-muted-foreground">
                Existing student assignments keep this technique with its progress.
              </span>
            </span>
          </label>
          <label className="flex items-start gap-2 text-sm">
            <input
              type="radio"
              name="remove-propagation"
              value="cascade"
              checked={propagation === 'cascade'}
              onChange={() => setPropagation('cascade')}
              className="mt-1"
            />
            <span>
              <span className="block font-medium">Remove from syllabus AND existing student assignments</span>
              <span className="text-xs text-muted-foreground">
                Hides the technique for each student. Their attempts and notes are preserved.
              </span>
            </span>
          </label>
        </fieldset>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!propagation || removeMutation.isPending}
            onClick={handleConfirm}
          >
            Remove
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AssignStudentDialog({
  open,
  onOpenChange,
  syllabusId,
  assignedIds,
}: {
  open: boolean;
  onOpenChange: (b: boolean) => void;
  syllabusId: number;
  assignedIds: number[];
}) {
  const studentsQuery = useStudents('alphabetical', false);
  const assignMutation = useAssignSyllabusToStudent();
  const [search, setSearch] = useState('');
  const assigned = useMemo(() => new Set(assignedIds), [assignedIds]);
  const students = useMemo(
    () => (studentsQuery.data ?? []).filter((s: User) => s.role === 'student'),
    [studentsQuery.data],
  );
  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return students;
    return students.filter(
      (s: User) =>
        (s.display_name?.toLowerCase().includes(needle) ?? false) ||
        s.username.toLowerCase().includes(needle),
    );
  }, [students, search]);

  async function handleAssign(student: User) {
    try {
      await assignMutation.mutateAsync({
        studentId: student.id,
        syllabusId,
      });
      toast.success(`Assigned ${student.display_name || student.username}`);
    } catch {
      toast.error('Failed to assign');
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Assign syllabus</DialogTitle>
          <DialogDescription>
            Pick a student. They will see the syllabus immediately with every technique at red.
          </DialogDescription>
        </DialogHeader>
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search students"
        />
        <div className="max-h-72 overflow-y-auto rounded border border-border bg-card">
          {filtered.length === 0 ? (
            <p className="px-4 py-6 text-center text-xs text-muted-foreground">
              No matching students.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {filtered.map((s: User) => {
                const already = assigned.has(s.id);
                return (
                  <li
                    key={s.id}
                    className="flex items-center justify-between gap-2 px-3 py-2"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">
                        {s.display_name || s.username}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {s.username}
                      </p>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={already || assignMutation.isPending}
                      onClick={() => handleAssign(s)}
                    >
                      {already ? 'Assigned' : 'Assign'}
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AssignedStudentsList({
  studentIds,
  syllabusId,
}: {
  studentIds: number[];
  syllabusId: number;
}) {
  const usersQuery = useStudents('alphabetical', false);
  const studentsById = useMemo(() => {
    const map = new Map<number, User>();
    (usersQuery.data ?? []).forEach((u: User) => map.set(u.id, u));
    return map;
  }, [usersQuery.data]);

  return (
    <ul className="divide-y divide-border">
      {studentIds.map((id) => {
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
