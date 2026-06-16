import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Award, Calendar, Plus } from 'lucide-react';
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
import { TracedForm } from '@/components/traced-form';
import { EmptyState } from '@/components/empty-state';
import { useCompetitions } from '@/lib/queries';
import { useCreateCompetition } from '@/lib/mutations';
import {
  handleApiFormError,
  useFormWithValidation,
} from '@/components/hooks/useFormErrors';
import { useUser } from '@/lib/current-user-context';
import { isCoachOrAdmin } from '@/lib/api';

const createSchema = z.object({
  name: z
    .string()
    .min(1, 'Name is required')
    .max(200, 'Name must be under 200 characters'),
  date: z.string().optional(),
});
type CreateValues = z.infer<typeof createSchema>;

export default function CompetitionsPage() {
  const navigate = useNavigate();
  const viewer = useUser();
  const isCoach = isCoachOrAdmin(viewer);

  const competitionsQuery = useCompetitions();
  const competitions = useMemo(
    () => competitionsQuery.data ?? [],
    [competitionsQuery.data],
  );

  const [createOpen, setCreateOpen] = useState(false);

  return (
    <div className="container mx-auto px-4 py-6 sm:px-6 md:py-8">
      <div className="mb-4 flex items-end justify-between gap-3">
        <h1 className="flex items-center gap-2 text-base font-semibold">
          <Award className="h-4 w-4" aria-hidden />
          Competitions
        </h1>
        {isCoach && (
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger asChild>
              <Button size="sm" className="gap-1.5">
                <Plus className="h-4 w-4" aria-hidden />
                <span>New competition</span>
              </Button>
            </DialogTrigger>
            <CreateCompetitionDialog
              onCreated={(id) => {
                setCreateOpen(false);
                navigate(`/competitions/${id}`);
              }}
            />
          </Dialog>
        )}
      </div>

      <div className="overflow-hidden rounded-lg border border-border bg-card">
        {competitionsQuery.isLoading ? (
          <div className="divide-y divide-border">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="px-4 py-4">
                <div className="h-4 w-1/3 animate-pulse rounded bg-muted" />
                <div className="mt-2 h-3 w-1/4 animate-pulse rounded bg-muted" />
              </div>
            ))}
          </div>
        ) : competitionsQuery.isError ? (
          <p className="px-6 py-10 text-center text-sm text-muted-foreground">
            Failed to load competitions. Please try again.
          </p>
        ) : competitions.length === 0 ? (
          <EmptyState
            icon={Award}
            title="No competitions yet"
            description={
              isCoach
                ? 'Create a competition to start tracking student registrations.'
                : 'No competitions have been created yet.'
            }
          />
        ) : (
          <ul className="divide-y divide-border">
            {competitions.map((c) => (
              <li
                key={c.id}
                className="transition-colors hover:bg-muted/40"
              >
                <Link
                  to={`/competitions/${c.id}`}
                  className="flex min-w-0 items-center gap-3 px-4 py-3"
                >
                  <div className="min-w-0 flex-1 space-y-0.5">
                    <p className="truncate text-sm font-semibold">{c.name}</p>
                    {c.date && (
                      <p className="flex items-center gap-1 text-xs text-muted-foreground">
                        <Calendar className="h-3 w-3 shrink-0" aria-hidden />
                        {formatDate(c.date)}
                      </p>
                    )}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function formatDate(dateStr: string): string {
  try {
    return new Date(dateStr + 'T00:00:00').toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  } catch {
    return dateStr;
  }
}

function CreateCompetitionDialog({
  onCreated,
}: {
  onCreated: (id: number) => void;
}) {
  const createMutation = useCreateCompetition();
  const form = useFormWithValidation<CreateValues>({
    resolver: zodResolver(createSchema),
    defaultValues: { name: '', date: '' },
  });

  async function handleSubmit(values: CreateValues) {
    try {
      const { id } = await createMutation.mutateAsync({
        name: values.name,
        date: values.date || null,
      });
      toast.success(`Created ${values.name}`);
      onCreated(id);
    } catch (err) {
      const handled = await handleApiFormError(
        err,
        form.setError,
        Object.keys(form.getValues()),
      );
      if (!handled) toast.error('Failed to create competition');
    }
  }

  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>New competition</DialogTitle>
        <DialogDescription>
          Add a name and optional date. Students can be registered after.
        </DialogDescription>
      </DialogHeader>
      <Form {...form}>
        <TracedForm
          id="create_competition"
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
            name="date"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Date (optional)</FormLabel>
                <FormControl>
                  <Input type="date" {...field} />
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
