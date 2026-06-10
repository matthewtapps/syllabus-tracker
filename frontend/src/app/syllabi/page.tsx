import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  FolderKanban,
  NotebookPen,
  Plus,
  Search,
  UserPlus,
  Users,
} from 'lucide-react';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
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
import { useSyllabi } from '@/lib/queries';
import { useCreateSyllabus } from '@/lib/mutations';
import {
  handleApiFormError,
  useFormWithValidation,
} from '@/components/hooks/useFormErrors';
import { AssignStudentDialog } from './components/assign-student-dialog';

const createSchema = z.object({
  name: z
    .string()
    .min(1, 'Name is required')
    .max(100, 'Name must be under 100 characters'),
  description: z.string().max(1000, 'Description is too long').optional(),
});
type CreateValues = z.infer<typeof createSchema>;

export default function SyllabiPage() {
  const navigate = useNavigate();
  const syllabiQuery = useSyllabi();
  const syllabi = useMemo(
    () => syllabiQuery.data ?? [],
    [syllabiQuery.data],
  );
  const [search, setSearch] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  // Target of the quick-assign button. `null` when the dialog is closed.
  const [assignTarget, setAssignTarget] = useState<
    | { syllabusId: number; syllabusName: string }
    | null
  >(null);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return syllabi;
    return syllabi.filter(
      (s) =>
        s.name.toLowerCase().includes(needle) ||
        s.description.toLowerCase().includes(needle),
    );
  }, [syllabi, search]);

  return (
    <div className="container mx-auto px-4 py-6 sm:px-6 md:py-8">
      <div className="mb-4 flex items-end justify-between gap-3">
        <h1 className="flex items-center gap-2 text-base font-semibold">
          <NotebookPen className="h-4 w-4" aria-hidden />
          Syllabus Library
        </h1>
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button size="sm" className="gap-1.5">
              <Plus className="h-4 w-4" aria-hidden />
              <span>New syllabus</span>
            </Button>
          </DialogTrigger>
          <CreateSyllabusDialog
            onCreated={(id) => {
              setCreateOpen(false);
              navigate(`/syllabi/${id}`);
            }}
          />
        </Dialog>
      </div>

      <div className="mb-4 relative">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <Input
          placeholder="Search syllabi"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      <div className="overflow-hidden rounded-lg border border-border bg-card">
        {syllabiQuery.isLoading ? (
          <div className="divide-y divide-border">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="px-4 py-4">
                <div className="h-4 w-1/3 animate-pulse rounded bg-muted" />
                <div className="mt-2 h-3 w-2/3 animate-pulse rounded bg-muted" />
              </div>
            ))}
          </div>
        ) : syllabi.length === 0 ? (
          <EmptyState
            icon={NotebookPen}
            title="No syllabi yet"
            description="Create your first syllabus to start curating techniques for your students."
          />
        ) : filtered.length === 0 ? (
          <p className="px-6 py-10 text-center text-sm text-muted-foreground">
            No syllabi match the current search.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {filtered.map((s) => (
              <li
                key={s.id}
                className="flex items-stretch transition-colors hover:bg-muted/40"
              >
                <Link
                  to={`/syllabi/${s.id}`}
                  className="min-w-0 flex-1 space-y-1 px-4 py-3"
                >
                  <p className="truncate text-sm font-semibold">{s.name}</p>
                  {s.description && (
                    <p className="line-clamp-2 text-xs text-muted-foreground">
                      {s.description}
                    </p>
                  )}
                  <p className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                    <span className="inline-flex items-center gap-1">
                      <FolderKanban className="h-3 w-3 shrink-0" aria-hidden />
                      {s.technique_count}{' '}
                      {s.technique_count === 1 ? 'technique' : 'techniques'}
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <Users className="h-3 w-3 shrink-0" aria-hidden />
                      {s.active_assignment_count}{' '}
                      {s.active_assignment_count === 1 ? 'student' : 'students'}
                    </span>
                  </p>
                </Link>
                <div className="flex shrink-0 items-center pr-3 pl-1">
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    aria-label={`Assign ${s.name} to a student`}
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setAssignTarget({
                        syllabusId: s.id,
                        syllabusName: s.name,
                      });
                    }}
                  >
                    <UserPlus className="h-4 w-4" aria-hidden />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <AssignStudentDialog
        open={assignTarget !== null}
        onOpenChange={(b) => {
          if (!b) setAssignTarget(null);
        }}
        syllabusId={assignTarget?.syllabusId ?? 0}
        syllabusName={assignTarget?.syllabusName}
      />
    </div>
  );
}

function CreateSyllabusDialog({ onCreated }: { onCreated: (id: number) => void }) {
  const createMutation = useCreateSyllabus();
  const form = useFormWithValidation<CreateValues>({
    resolver: zodResolver(createSchema),
    defaultValues: { name: '', description: '' },
  });

  async function handleSubmit(values: CreateValues) {
    try {
      const { id } = await createMutation.mutateAsync({
        name: values.name,
        description: values.description || undefined,
      });
      toast.success(`Created ${values.name}`);
      onCreated(id);
    } catch (err) {
      const handled = await handleApiFormError(
        err,
        form.setError,
        Object.keys(form.getValues()),
      );
      if (!handled) toast.error('Failed to create syllabus');
    }
  }

  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>New syllabus</DialogTitle>
        <DialogDescription>
          Add a name and optional description. You can add techniques after.
        </DialogDescription>
      </DialogHeader>
      <Form {...form}>
        <TracedForm
          id="create_syllabus"
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
          <DialogFooter>
            <Button
              type="submit"
              size="sm"
              disabled={form.formState.isSubmitting}
            >
              {form.formState.isSubmitting ? 'Creating...' : 'Create'}
            </Button>
          </DialogFooter>
        </TracedForm>
      </Form>
    </DialogContent>
  );
}
