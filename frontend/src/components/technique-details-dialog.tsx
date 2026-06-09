import { useEffect, useState } from 'react';
import { Pencil } from 'lucide-react';
import { toast } from 'sonner';
import {
  updateLibraryTechnique,
  type LibraryTechnique,
  type Tag,
} from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
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
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { handleApiFormError, useFormWithValidation } from './hooks/useFormErrors';
import { TracedForm } from './traced-form';

interface TechniqueDetailsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  technique: LibraryTechnique;
  tags: Tag[];
  canEdit: boolean;
  initialMode?: 'view' | 'edit';
  onSaved: (updated: LibraryTechnique) => void;
}

interface FormValues {
  name: string;
  description: string;
}

export default function TechniqueDetailsDialog({
  open,
  onOpenChange,
  technique,
  tags,
  canEdit,
  initialMode = 'view',
  onSaved,
}: TechniqueDetailsDialogProps) {
  const [mode, setMode] = useState<'view' | 'edit'>(
    canEdit ? initialMode : 'view',
  );

  const form = useFormWithValidation<FormValues>({
    defaultValues: {
      name: technique.name,
      description: technique.description,
    },
  });

  useEffect(() => {
    if (open) {
      setMode(canEdit ? initialMode : 'view');
      form.reset({
        name: technique.name,
        description: technique.description,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, technique.id, initialMode]);

  const watchedName = form.watch('name');
  const watchedDescription = form.watch('description');
  const hasChanges =
    watchedName !== technique.name ||
    watchedDescription !== technique.description;

  async function handleSubmit(values: FormValues) {
    try {
      const response = await updateLibraryTechnique(technique.id, {
        name: values.name,
        description: values.description,
      });
      if (!response.ok) throw response;
      const updated: LibraryTechnique = {
        ...technique,
        name: values.name,
        description: values.description,
      };
      onSaved(updated);
      toast.success('Technique updated');
      setMode('view');
    } catch (err) {
      const handled = await handleApiFormError(
        err,
        form.setError,
        Object.keys(form.getValues()),
      );
      if (!handled) toast.error(err instanceof Error ? err.message : 'Failed to update technique');
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] w-[calc(100vw-1rem)] max-w-xl overflow-y-auto p-4 sm:p-6">
        {mode === 'view' ? (
          <>
            <DialogHeader>
              <DialogTitle>{technique.name}</DialogTitle>
              {technique.coach_name && (
                <DialogDescription>
                  Created by {technique.coach_name}
                </DialogDescription>
              )}
            </DialogHeader>

            <div className="space-y-4">
              {technique.description ? (
                <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">
                  {technique.description}
                </p>
              ) : (
                <p className="text-sm italic text-muted-foreground">
                  No description.
                </p>
              )}

              {tags.length > 0 && (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs uppercase tracking-wide text-muted-foreground">
                    Tags
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    {tags.map((tag) => (
                      <Badge key={tag.id} variant="outline">
                        {tag.name}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <DialogFooter className="gap-2 sm:gap-2">
              {canEdit && (
                <Button
                  variant="outline"
                  onClick={() => setMode('edit')}
                  className="gap-2"
                >
                  <Pencil className="h-4 w-4" aria-hidden />
                  Edit
                </Button>
              )}
              <Button onClick={() => onOpenChange(false)}>Close</Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Edit technique</DialogTitle>
              <DialogDescription>
                Updates this technique's name and description for everyone.
              </DialogDescription>
            </DialogHeader>

            <Form {...form}>
              <TracedForm
                id="update_library_technique"
                onSubmit={form.handleSubmit(handleSubmit)}
                className="space-y-4"
              >
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Name</FormLabel>
                      <FormControl>
                        <Input {...field} />
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
                        <Textarea {...field} className="min-h-32 max-h-72" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {hasChanges && (
                  <FormDescription className="text-status-amber">
                    Saving will update this technique globally for every student
                    it's assigned to.
                  </FormDescription>
                )}

                <DialogFooter className="gap-2 sm:gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      form.reset({
                        name: technique.name,
                        description: technique.description,
                      });
                      setMode('view');
                    }}
                    disabled={form.formState.isSubmitting}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    disabled={form.formState.isSubmitting || !hasChanges}
                  >
                    {form.formState.isSubmitting ? 'Saving...' : 'Save changes'}
                  </Button>
                </DialogFooter>
              </TracedForm>
            </Form>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
