import { useEffect, useMemo, useState } from 'react';
import { Check, Plus, Sparkles, X } from 'lucide-react';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import {
  addTagToTechnique,
  createLibraryTechnique,
  createTag,
  getAllTags,
  type CreatedLibraryTechnique,
  type Tag,
} from '@/lib/api';
import { qk } from '@/lib/query-keys';
import { useAllTags } from '@/lib/queries';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { handleApiFormError, useFormWithValidation } from './hooks/useFormErrors';
import { TracedForm } from './traced-form';

interface NewTechniqueDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Existing library technique names, used for the duplicate nudge. */
  existingNames: string[];
}

interface FormValues {
  name: string;
  description: string;
}

// A tag the coach has lined up for the new technique. `id` is null until the
// tag is actually created on the server (deferred to submit time).
interface PendingTag {
  id: number | null;
  name: string;
}

export default function NewTechniqueDialog({
  open,
  onOpenChange,
  existingNames,
}: NewTechniqueDialogProps) {
  const queryClient = useQueryClient();
  const { data: allTags = [] } = useAllTags();

  const form = useFormWithValidation<FormValues>({
    defaultValues: { name: '', description: '' },
  });
  const name = form.watch('name');
  const trimmedName = name.trim();
  const lowerName = trimmedName.toLowerCase();

  const [pendingTags, setPendingTags] = useState<PendingTag[]>([]);
  const [tagOpen, setTagOpen] = useState(false);
  const [tagSearch, setTagSearch] = useState('');

  useEffect(() => {
    if (!open) {
      form.reset();
      setPendingTags([]);
      setTagSearch('');
      setTagOpen(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Duplicate nudges. Exact match is a hard-ish warning; substring matches are
  // "did you mean" hints so the coach doesn't recreate something that exists.
  const exactDuplicate = useMemo(
    () => existingNames.some((n) => n.trim().toLowerCase() === lowerName),
    [existingNames, lowerName],
  );
  const similar = useMemo(() => {
    if (lowerName.length < 2) return [];
    return existingNames
      .filter((n) => {
        const ln = n.toLowerCase();
        return ln !== lowerName && ln.includes(lowerName);
      })
      .slice(0, 5);
  }, [existingNames, lowerName]);

  const pendingNames = useMemo(
    () => new Set(pendingTags.map((t) => t.name.toLowerCase())),
    [pendingTags],
  );

  // Tags whose name literally appears in the title (case-insensitive). These
  // surface as one-tap chips so the obvious tags are zero-effort.
  const suggestedFromTitle = useMemo(() => {
    if (!lowerName) return [];
    return allTags.filter(
      (t) =>
        t.name.length > 1 &&
        lowerName.includes(t.name.toLowerCase()) &&
        !pendingNames.has(t.name.toLowerCase()),
    );
  }, [allTags, lowerName, pendingNames]);

  const tagSearchTrimmed = tagSearch.trim();
  const tagSearchLower = tagSearchTrimmed.toLowerCase();
  const tagExists = allTags.some((t) => t.name.toLowerCase() === tagSearchLower);
  const canCreateTag =
    !!tagSearchTrimmed && !tagExists && !pendingNames.has(tagSearchLower);

  const availableTags = useMemo(
    () =>
      allTags
        .filter((t) => !pendingNames.has(t.name.toLowerCase()))
        .filter(
          (t) =>
            !tagSearchLower || t.name.toLowerCase().includes(tagSearchLower),
        )
        .slice(0, 20),
    [allTags, pendingNames, tagSearchLower],
  );

  function addPendingTag(tag: PendingTag) {
    if (pendingNames.has(tag.name.toLowerCase())) return;
    setPendingTags((prev) => [...prev, tag]);
    setTagSearch('');
  }

  function removePendingTag(tagName: string) {
    setPendingTags((prev) => prev.filter((t) => t.name !== tagName));
  }

  // Resolve every pending tag to a real id, creating any new ones, then attach
  // them to the freshly created technique. Tag failures are non-fatal: the
  // technique already exists, so we warn rather than blowing up the whole flow.
  async function attachTags(techniqueId: number) {
    if (pendingTags.length === 0) return;
    let tagPool: Tag[] = allTags;
    for (const pending of pendingTags) {
      try {
        let tagId = pending.id;
        if (tagId == null) {
          const createResponse = await createTag(pending.name);
          if (!createResponse.ok) throw new Error('create tag failed');
          tagPool = await getAllTags();
          tagId =
            tagPool.find(
              (t) => t.name.toLowerCase() === pending.name.toLowerCase(),
            )?.id ?? null;
        }
        if (tagId == null) throw new Error('tag id unresolved');
        await addTagToTechnique(techniqueId, tagId);
      } catch {
        toast.warning(`Could not add tag "${pending.name}"`);
      }
    }
  }

  async function handleSubmit(values: FormValues) {
    try {
      const response = await createLibraryTechnique({
        name: values.name,
        description: values.description,
      });
      if (!response.ok) throw response;
      const created: CreatedLibraryTechnique = await response.json();

      await attachTags(created.id);

      await queryClient.invalidateQueries({ queryKey: qk.libraryTechniques() });
      await queryClient.invalidateQueries({ queryKey: qk.libraryStats() });
      queryClient.invalidateQueries({ queryKey: qk.tags() });

      toast.success(`Created "${created.name}"`);
      onOpenChange(false);
    } catch (err) {
      const handled = await handleApiFormError(
        err,
        form.setError,
        Object.keys(form.getValues()),
      );
      if (!handled) {
        toast.error(
          err instanceof Error ? err.message : 'Failed to create technique',
        );
      }
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] w-[calc(100vw-1rem)] max-w-lg overflow-y-auto p-4 sm:p-6">
        <DialogHeader>
          <DialogTitle>New technique</DialogTitle>
          <DialogDescription>
            Adds a technique to the global library. Start typing the name to see
            if it already exists.
          </DialogDescription>
        </DialogHeader>

        <TracedForm
          id="create_library_technique"
          onSubmit={form.handleSubmit(handleSubmit)}
          className="space-y-4"
        >
          <div className="space-y-2">
            <Label htmlFor="new-technique-name">Name</Label>
            <Input
              id="new-technique-name"
              autoComplete="off"
              {...form.register('name')}
              placeholder="e.g. Armbar from closed guard"
              aria-invalid={!!form.formState.errors.name || exactDuplicate}
            />
            {form.formState.errors.name && (
              <p className="text-sm text-destructive">
                {String(
                  form.formState.errors.name.message ||
                    'Technique name is required',
                )}
              </p>
            )}
            {exactDuplicate && (
              <p className="text-sm text-status-amber">
                A technique with this name already exists. Check the library
                before adding a duplicate.
              </p>
            )}
            {!exactDuplicate && similar.length > 0 && (
              <div className="rounded-md border border-border bg-muted/40 p-2 text-xs">
                <p className="mb-1 text-muted-foreground">
                  Similar techniques already in the library:
                </p>
                <ul className="space-y-0.5">
                  {similar.map((n) => (
                    <li key={n} className="font-medium">
                      {n}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          <div className="space-y-2">
            <Label>Tags</Label>
            {pendingTags.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {pendingTags.map((tag) => (
                  <Badge key={tag.name} variant="secondary" className="gap-1 pr-1">
                    {tag.name}
                    <button
                      type="button"
                      onClick={() => removePendingTag(tag.name)}
                      className="rounded-sm hover:text-destructive"
                      aria-label={`Remove ${tag.name}`}
                    >
                      <X className="h-3 w-3" aria-hidden />
                    </button>
                  </Badge>
                ))}
              </div>
            )}

            {suggestedFromTitle.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                  <Sparkles className="h-3 w-3" aria-hidden />
                  From the name:
                </span>
                {suggestedFromTitle.map((tag) => (
                  <Badge
                    key={tag.id}
                    variant="outline"
                    className="cursor-pointer border-dashed"
                    onClick={() => addPendingTag({ id: tag.id, name: tag.name })}
                  >
                    <Plus className="mr-0.5 h-3 w-3" aria-hidden />
                    {tag.name}
                  </Badge>
                ))}
              </div>
            )}

            <Popover open={tagOpen} onOpenChange={setTagOpen}>
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 gap-1 border-dashed px-2 text-xs text-muted-foreground hover:text-foreground"
                >
                  <Plus className="h-3 w-3" aria-hidden />
                  Add tag
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-64 p-0" align="start">
                <Command shouldFilter={false}>
                  <CommandInput
                    placeholder="Find or create a tag..."
                    value={tagSearch}
                    onValueChange={setTagSearch}
                  />
                  <CommandList>
                    {availableTags.length === 0 && !canCreateTag && (
                      <CommandEmpty>No matching tags.</CommandEmpty>
                    )}
                    {availableTags.length > 0 && (
                      <CommandGroup heading="Existing tags">
                        {availableTags.map((tag) => (
                          <CommandItem
                            key={tag.id}
                            value={tag.name}
                            onSelect={() =>
                              addPendingTag({ id: tag.id, name: tag.name })
                            }
                          >
                            <Check
                              className="mr-2 h-3.5 w-3.5 opacity-0"
                              aria-hidden
                            />
                            {tag.name}
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    )}
                    {canCreateTag && (
                      <CommandGroup heading="Create">
                        <CommandItem
                          value={`__create_${tagSearchTrimmed}`}
                          onSelect={() =>
                            addPendingTag({ id: null, name: tagSearchTrimmed })
                          }
                        >
                          <Plus className="mr-2 h-3.5 w-3.5" aria-hidden />
                          Create "{tagSearchTrimmed}"
                        </CommandItem>
                      </CommandGroup>
                    )}
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
          </div>

          <div className="space-y-2">
            <Label htmlFor="new-technique-description">
              Description{' '}
              <span className="font-normal text-muted-foreground">
                (optional)
              </span>
            </Label>
            <Textarea
              id="new-technique-description"
              {...form.register('description')}
              placeholder="How to execute it, common mistakes, finishing details..."
              className="min-h-24 max-h-72"
            />
          </div>

          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={form.formState.isSubmitting}>
              {form.formState.isSubmitting ? 'Creating...' : 'Create technique'}
            </Button>
          </div>
        </TracedForm>
      </DialogContent>
    </Dialog>
  );
}
