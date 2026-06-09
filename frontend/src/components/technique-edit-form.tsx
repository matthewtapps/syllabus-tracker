import { useState } from 'react';
import type { Technique, TechniqueUpdate } from '@/lib/api';
import { Button } from '@/components/ui/button';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useFormWithValidation } from './hooks/useFormErrors';
import { TracedForm } from './traced-form';

interface TechniqueEditFormProps {
  technique: Technique;
  canEditAll: boolean;
  currentUserId: number;
  studentId: number;
  onSubmit: (updates: TechniqueUpdate) => void;
}

type FormValues = {
  technique_name: string;
  technique_description: string;
};

export default function TechniqueEditForm({
  technique,
  canEditAll,
  onSubmit,
}: TechniqueEditFormProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);

  const form = useFormWithValidation<FormValues>({
    defaultValues: {
      technique_name: technique.technique_name,
      technique_description: technique.technique_description,
    },
  });

  const watchedName = form.watch('technique_name');
  const watchedDescription = form.watch('technique_description');
  const nameChanged = watchedName !== technique.technique_name;
  const descriptionChanged = watchedDescription !== technique.technique_description;
  const hasChanges = nameChanged || descriptionChanged;

  async function handleSubmit(values: FormValues) {
    setIsSubmitting(true);
    try {
      const updates: TechniqueUpdate = {};
      if (nameChanged) updates.technique_name = values.technique_name;
      if (descriptionChanged) updates.technique_description = values.technique_description;
      if (Object.keys(updates).length > 0) {
        onSubmit(updates);
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  if (!canEditAll) {
    return (
      <p className="text-sm text-muted-foreground">
        You do not have permission to edit the technique definition.
      </p>
    );
  }

  return (
    <Form {...form}>
      <TracedForm
        id="technique_edit"
        onSubmit={form.handleSubmit(handleSubmit)}
        className="space-y-4"
      >
        <FormField
          control={form.control}
          name="technique_name"
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
          name="technique_description"
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
            Saving will update this technique globally for every student it's assigned to.
          </FormDescription>
        )}

        <div className="flex justify-end gap-2">
          <Button
            type="submit"
            disabled={isSubmitting || !hasChanges}
          >
            {isSubmitting ? 'Saving...' : 'Save changes'}
          </Button>
        </div>
      </TracedForm>
    </Form>
  );
}
