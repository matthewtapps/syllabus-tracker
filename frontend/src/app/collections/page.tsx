import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { BookOpen, ChevronRight, Plus, Users } from 'lucide-react';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { type Collection } from '@/lib/api';
import { useCollections } from '@/lib/queries';
import { useCreateCollection } from '@/lib/mutations';
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
import { EmptyState } from '@/components/empty-state';
import { SkeletonListRow } from '@/components/skeleton-row';
import { TracedForm } from '@/components/traced-form';
import { useFormWithValidation } from '@/components/hooks/useFormErrors';

const newCollectionSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100, 'Name is too long'),
  description: z.string().optional(),
});
type NewCollectionValues = z.infer<typeof newCollectionSchema>;

export default function CollectionsPage() {
  const navigate = useNavigate();
  const collectionsQuery = useCollections();
  const createMutation = useCreateCollection();
  const collections = collectionsQuery.data ?? null;
  const error = collectionsQuery.error ? 'Failed to load collections.' : null;
  const [createDialogOpen, setCreateDialogOpen] = useState(false);

  const form = useFormWithValidation<NewCollectionValues>({
    resolver: zodResolver(newCollectionSchema),
    defaultValues: { name: '', description: '' },
  });

  async function handleCreate(values: NewCollectionValues) {
    const response = await createMutation.mutateAsync({
      name: values.name,
      description: values.description,
    });
    const created: Collection = await response.json();
    setCreateDialogOpen(false);
    form.reset();
    toast.success('Collection created');
    navigate(`/collections/${created.id}`);
  }

  return (
    <div className="container mx-auto px-4 py-6 sm:px-6 md:py-8">
      <div className="mb-6 flex items-end justify-between gap-4">
        <p className="text-sm text-muted-foreground sm:text-base">
          Organize techniques into reusable syllabi or training tracks.
        </p>
        <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
          <DialogTrigger asChild>
            <Button className="shrink-0">
              <Plus className="mr-2 h-4 w-4" aria-hidden />
              New collection
            </Button>
          </DialogTrigger>
          <DialogContent className="w-[calc(100vw-1rem)] max-w-md p-4 sm:p-6">
            <DialogHeader>
              <DialogTitle>New collection</DialogTitle>
              <DialogDescription>
                Give it a name and a short description. You'll add techniques
                on the next screen.
              </DialogDescription>
            </DialogHeader>
            <Form {...form}>
              <TracedForm
                id="create_collection"
                onSubmit={form.handleSubmit(handleCreate)}
                setFieldErrors={form.setFieldErrors}
                className="space-y-4"
              >
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Name</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          autoFocus
                          placeholder="e.g. Blue Belt syllabus"
                        />
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
                        <Textarea
                          {...field}
                          placeholder="What does this collection cover?"
                          className="min-h-24"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <DialogFooter className="gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setCreateDialogOpen(false)}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    disabled={form.formState.isSubmitting}
                  >
                    {form.formState.isSubmitting ? 'Creating...' : 'Create'}
                  </Button>
                </DialogFooter>
              </TracedForm>
            </Form>
          </DialogContent>
        </Dialog>
      </div>

      <div className="overflow-hidden rounded-lg border border-border bg-card">
        {collections === null && !error ? (
          <div className="divide-y divide-border">
            {Array.from({ length: 3 }).map((_, i) => (
              <SkeletonListRow key={i} />
            ))}
          </div>
        ) : error ? (
          <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
            <p className="text-sm text-destructive">{error}</p>
            <Button variant="outline" onClick={() => collectionsQuery.refetch()}>
              Try again
            </Button>
          </div>
        ) : collections && collections.length === 0 ? (
          <EmptyState
            icon={BookOpen}
            title="No collections yet"
            description="Create your first collection to bundle techniques together."
            action={
              <Button onClick={() => setCreateDialogOpen(true)}>
                <Plus className="mr-2 h-4 w-4" aria-hidden />
                New collection
              </Button>
            }
          />
        ) : (
          <ul className="divide-y divide-border">
            {collections!.map((c) => (
              <li key={c.id}>
                <Link
                  to={`/collections/${c.id}`}
                  className="flex items-center gap-4 px-4 py-4 transition-colors hover:bg-muted/40"
                >
                  <div className="min-w-0 flex-1 space-y-1">
                    <p className="font-medium">{c.name}</p>
                    {c.description && (
                      <p className="line-clamp-1 text-sm text-muted-foreground">
                        {c.description}
                      </p>
                    )}
                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                      <span className="inline-flex items-center gap-1">
                        <BookOpen className="h-3 w-3" aria-hidden />
                        {c.technique_count}{' '}
                        {c.technique_count === 1 ? 'technique' : 'techniques'}
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <Users className="h-3 w-3" aria-hidden />
                        {c.student_count}{' '}
                        {c.student_count === 1 ? 'student' : 'students'}
                      </span>
                    </div>
                  </div>
                  <ChevronRight
                    className="h-4 w-4 text-muted-foreground"
                    aria-hidden
                  />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
