import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { BookOpen, ChevronRight, Plus, Search, Users } from 'lucide-react';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { isCoachOrAdmin, type Collection, type User } from '@/lib/api';
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
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { EmptyState } from '@/components/empty-state';
import { SkeletonListRow } from '@/components/skeleton-row';
import { TracedForm } from '@/components/traced-form';
import { handleApiFormError, useFormWithValidation } from '@/components/hooks/useFormErrors';

const newCollectionSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100, 'Name is too long'),
  description: z.string().optional(),
});
type NewCollectionValues = z.infer<typeof newCollectionSchema>;

interface CollectionsPageProps {
  user: User;
}

export default function CollectionsPage({ user }: CollectionsPageProps) {
  const canEdit = isCoachOrAdmin(user);
  const navigate = useNavigate();
  const collectionsQuery = useCollections();
  const createMutation = useCreateCollection();
  const collections = collectionsQuery.data ?? null;
  const error = collectionsQuery.error ? 'Failed to load collections.' : null;
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [search, setSearch] = useState('');

  const filteredCollections = useMemo(() => {
    if (!collections) return null;
    const needle = search.trim().toLowerCase();
    if (!needle) return collections;
    return collections.filter(
      (c) =>
        c.name.toLowerCase().includes(needle) ||
        (c.description?.toLowerCase().includes(needle) ?? false),
    );
  }, [collections, search]);

  const form = useFormWithValidation<NewCollectionValues>({
    resolver: zodResolver(newCollectionSchema),
    defaultValues: { name: '', description: '' },
  });

  async function handleCreate(values: NewCollectionValues) {
    try {
      const response = await createMutation.mutateAsync({
        name: values.name,
        description: values.description,
      });
      const created: Collection = await response.json();
      setCreateDialogOpen(false);
      form.reset();
      toast.success('Collection created');
      navigate(`/collections/${created.id}`);
    } catch (err) {
      const handled = await handleApiFormError(
        err,
        form.setError,
        Object.keys(form.getValues()),
      );
      if (!handled) toast.error(err instanceof Error ? err.message : 'Failed to create collection');
    }
  }

  return (
    <div className="container mx-auto px-4 py-6 sm:px-6 md:py-8">
      <Tabs
        value="collections"
        onValueChange={(v) => {
          if (v === 'library') navigate('/library');
        }}
        className="mb-4"
      >
        <TabsList>
          <TabsTrigger value="library">All techniques</TabsTrigger>
          <TabsTrigger value="collections">Collections</TabsTrigger>
        </TabsList>
      </Tabs>

      <div className="mb-4 flex items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            placeholder="Search collections"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
          {canEdit && (
            <DialogTrigger asChild>
              <Button className="shrink-0">
                <Plus className="mr-2 h-4 w-4" aria-hidden />
                <span className="hidden sm:inline">New collection</span>
                <span className="sm:hidden">New</span>
              </Button>
            </DialogTrigger>
          )}
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
            description={
              canEdit
                ? 'Create your first collection to bundle techniques together.'
                : 'Your coach hasn’t built any collections yet.'
            }
            action={
              canEdit ? (
                <Button onClick={() => setCreateDialogOpen(true)}>
                  <Plus className="mr-2 h-4 w-4" aria-hidden />
                  New collection
                </Button>
              ) : undefined
            }
          />
        ) : filteredCollections && filteredCollections.length === 0 ? (
          <p className="px-6 py-10 text-center text-sm text-muted-foreground">
            No collections match the current search.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {filteredCollections!.map((c) => (
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
