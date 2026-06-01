import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BookOpen, FolderOpen, Pencil, Search, Users, X as XIcon } from 'lucide-react';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import type { LibraryTechniqueRow, Tag } from '@/lib/api';
import { useAllTags, useLibraryTechniques } from '@/lib/queries';
import {
  useRemoveTagFromTechnique,
  useUpdateLibraryTechnique,
} from '@/lib/mutations';
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
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { TracedForm } from '@/components/traced-form';
import { EmptyState } from '@/components/empty-state';
import { useFormWithValidation } from '@/components/hooks/useFormErrors';
import { TagsEditor } from '@/app/student-techniques/components/tags-editor';
import { formatRelative } from '@/lib/dates';

const editSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100, 'Name is too long'),
  description: z.string().min(1, 'Description is required'),
});
type EditValues = z.infer<typeof editSchema>;

export default function LibraryPage() {
  const navigate = useNavigate();
  const techniquesQuery = useLibraryTechniques();
  const techniques = useMemo(
    () => techniquesQuery.data ?? [],
    [techniquesQuery.data],
  );
  const loading = techniquesQuery.isLoading;
  const error = techniquesQuery.error ? 'Failed to load techniques.' : null;
  const [editing, setEditing] = useState<LibraryTechniqueRow | null>(null);
  const [search, setSearch] = useState('');
  const [activeTags, setActiveTags] = useState<string[]>([]);

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

  function toggleTag(tag: string) {
    setActiveTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag],
    );
  }

  return (
    <div className="container mx-auto px-4 py-6 sm:px-6 md:py-8">
      <Tabs
        value="library"
        onValueChange={(v) => {
          if (v === 'collections') navigate('/collections');
        }}
        className="mb-4"
      >
        <TabsList>
          <TabsTrigger value="library">All techniques</TabsTrigger>
          <TabsTrigger value="collections">Collections</TabsTrigger>
        </TabsList>
      </Tabs>

      <div className="mb-4 relative">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <Input
          placeholder="Search techniques"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      {availableTags.length > 0 && (
        <div className="mb-4 flex flex-wrap gap-1.5">
          {availableTags.map((tag) => {
            const active = activeTags.includes(tag);
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

      <p className="mb-2 text-xs text-muted-foreground">
        {filtered.length === techniques.length
          ? `${techniques.length} ${techniques.length === 1 ? 'technique' : 'techniques'}`
          : `${filtered.length} of ${techniques.length} techniques`}
      </p>

      <div className="overflow-hidden rounded-lg border border-border bg-card">
        {loading ? (
          <div className="divide-y divide-border">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="px-4 py-4">
                <div className="h-4 w-1/3 animate-pulse rounded bg-muted" />
                <div className="mt-2 h-3 w-2/3 animate-pulse rounded bg-muted" />
              </div>
            ))}
          </div>
        ) : error ? (
          <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
            <p className="text-sm text-destructive">{error}</p>
            <Button variant="outline" onClick={() => window.location.reload()}>
              Try again
            </Button>
          </div>
        ) : techniques.length === 0 ? (
          <EmptyState
            icon={BookOpen}
            title="No techniques yet"
            description="Assign a technique to a student or build a collection to start the library."
          />
        ) : filtered.length === 0 ? (
          <p className="px-6 py-10 text-center text-sm text-muted-foreground">
            No techniques match the current filters.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {filtered.map((t) => (
              <li key={t.id}>
                <button
                  type="button"
                  onClick={() => setEditing(t)}
                  className="group flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/40"
                >
                  <div className="min-w-0 flex-1 space-y-1">
                    <p className="truncate text-sm font-medium">{t.name}</p>
                    <p className="text-xs text-muted-foreground">
                      <MetadataLine row={t} />
                    </p>
                    {t.tags.length > 0 && (
                      <div className="flex flex-wrap gap-1 pt-0.5">
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
                  <Pencil
                    className="h-4 w-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
                    aria-hidden
                  />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <EditDialog technique={editing} onClose={() => setEditing(null)} />
    </div>
  );
}

function MetadataLine({ row }: { row: LibraryTechniqueRow }) {
  const parts: string[] = [];
  parts.push(
    row.student_count === 0
      ? 'No students'
      : `${row.student_count} ${row.student_count === 1 ? 'student' : 'students'}`,
  );
  parts.push(
    row.collection_count === 0
      ? 'No collections'
      : `${row.collection_count} ${row.collection_count === 1 ? 'collection' : 'collections'}`,
  );
  if (row.last_activity_at) {
    parts.push(`Active ${formatRelative(row.last_activity_at)}`);
  }
  return (
    <span className="inline-flex items-center gap-1.5">
      <Users className="h-3 w-3" aria-hidden />
      {parts[0]}
      <span aria-hidden>·</span>
      <FolderOpen className="h-3 w-3" aria-hidden />
      {parts.slice(1).join(' · ')}
    </span>
  );
}

interface EditDialogProps {
  technique: LibraryTechniqueRow | null;
  onClose: () => void;
}

function EditDialog({ technique, onClose }: EditDialogProps) {
  const updateMutation = useUpdateLibraryTechnique();
  const removeTagMutation = useRemoveTagFromTechnique();
  const allTagsQuery = useAllTags();
  const allTags = allTagsQuery.data ?? [];

  // Optimistic local tag list so add/remove feels instant. Seeded from
  // `technique?.tags` whenever the dialog opens on a different technique;
  // the `values` form prop on the parent form handles name/description reset.
  const [localTags, setLocalTags] = useState<Tag[]>([]);
  const [seededFor, setSeededFor] = useState<number | null>(null);
  if (technique && seededFor !== technique.id) {
    setLocalTags(technique.tags);
    setSeededFor(technique.id);
  }
  if (!technique && seededFor !== null) {
    setSeededFor(null);
    setLocalTags([]);
  }

  const form = useFormWithValidation<EditValues>({
    resolver: zodResolver(editSchema),
    defaultValues: { name: '', description: '' },
    values: technique
      ? { name: technique.name, description: technique.description }
      : undefined,
  });

  async function handleSubmit(values: EditValues) {
    if (!technique) return;
    try {
      await updateMutation.mutateAsync({
        techniqueId: technique.id,
        data: values,
      });
      toast.success('Technique updated');
      onClose();
    } catch (err) {
      console.error(err);
      toast.error('Failed to update technique');
    }
  }

  async function handleRemoveTag(tag: Tag) {
    if (!technique) return;
    setLocalTags((prev) => prev.filter((t) => t.id !== tag.id));
    try {
      await removeTagMutation.mutateAsync({
        techniqueId: technique.id,
        tagId: tag.id,
      });
    } catch (err) {
      console.error(err);
      toast.error('Failed to remove tag');
      setLocalTags((prev) =>
        [...prev, tag].sort((a, b) => a.name.localeCompare(b.name)),
      );
    }
  }

  function handleTagAdded(tag: Tag) {
    setLocalTags((prev) =>
      [...prev.filter((t) => t.id !== tag.id), tag].sort((a, b) =>
        a.name.localeCompare(b.name),
      ),
    );
  }

  return (
    <Dialog
      open={!!technique}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent className="w-[calc(100vw-1rem)] max-w-md p-4 sm:p-6">
        <DialogHeader>
          <DialogTitle>Edit technique</DialogTitle>
          <DialogDescription>
            Name and description apply to every student who has this technique
            assigned.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <TracedForm
            id="edit_library_technique"
            onSubmit={form.handleSubmit(handleSubmit)}
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
                    <Input {...field} autoFocus />
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
                    <Textarea {...field} className="min-h-24" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="space-y-2">
              <p className="text-sm font-medium">Tags</p>
              <div className="flex flex-wrap items-center gap-1.5">
                {localTags.map((tag) => (
                  <Badge
                    key={tag.id}
                    variant="secondary"
                    className="gap-1 pr-1 text-xs"
                  >
                    {tag.name}
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-4 w-4 rounded-full text-muted-foreground hover:bg-background hover:text-foreground"
                      onClick={() => handleRemoveTag(tag)}
                    >
                      <XIcon className="h-3 w-3" aria-hidden />
                      <span className="sr-only">Remove {tag.name}</span>
                    </Button>
                  </Badge>
                ))}
                {technique && (
                  <TagsEditor
                    techniqueId={technique.id}
                    assignedTags={localTags}
                    allTags={allTags}
                    onTagAdded={handleTagAdded}
                  />
                )}
              </div>
            </div>

            <DialogFooter className="gap-2">
              <Button type="button" variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" disabled={form.formState.isSubmitting}>
                {form.formState.isSubmitting ? 'Saving...' : 'Save'}
              </Button>
            </DialogFooter>
          </TracedForm>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
