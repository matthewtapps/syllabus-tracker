import { useState } from 'react';
import type { Technique, TechniqueUpdate } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Form, FormControl, FormField, FormItem, FormLabel } from '@/components/ui/form';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useForm } from 'react-hook-form';

interface TechniqueEditFormProps {
  technique: Technique;
  canEditAll: boolean;
  onSubmit: (updates: TechniqueUpdate) => void;
  onCancel: () => void;
}

export default function TechniqueEditForm({
  technique,
  canEditAll,
  onSubmit,
  onCancel
}: TechniqueEditFormProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [nameChanged, setNameChanged] = useState(false);
  const [descriptionChanged, setDescriptionChanged] = useState(false);

  const form = useForm<TechniqueUpdate>({
    defaultValues: {
      status: technique.status,
      student_notes: technique.student_notes,
      coach_notes: technique.coach_notes,
      technique_name: technique.technique_name,
      technique_description: technique.technique_description,
    },
  });

  const handleSubmit = async (values: TechniqueUpdate) => {
    setIsSubmitting(true);
    try {
      onSubmit(values);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-6 mt-6">
        {canEditAll && (
          <>
            <FormField
              control={form.control}
              name="status"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Status</FormLabel>
                  <Select
                    onValueChange={field.onChange}
                    defaultValue={field.value}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select a status" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="red">Not Yet Started</SelectItem>
                      <SelectItem value="amber">In Progress</SelectItem>
                      <SelectItem value="green">Completed</SelectItem>
                    </SelectContent>
                  </Select>
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="technique_name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Technique Name</FormLabel>
                  <FormControl>
                    <Textarea
                      {...field}
                      className="min-h-[120px] max-h-[300px] overflow-y-auto"
                      style={{ height: 'auto' }}
                      onChange={(e) => {
                        field.onChange(e);
                        setNameChanged(e.target.value !== technique.technique_name);
                      }}
                    />
                  </FormControl>
                  {nameChanged && (
                    <div className="text-amber-500 text-sm mt-1">
                      Warning: This will update the technique name globally for all students.
                    </div>
                  )}
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="technique_description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Technique Description</FormLabel>
                  <FormControl>
                    <Textarea
                      {...field}
                      className="min-h-[120px] max-h-[300px] overflow-y-auto"
                      style={{ height: 'auto' }}
                      onChange={(e) => {
                        field.onChange(e);
                        setDescriptionChanged(e.target.value !== technique.technique_description);
                      }}
                    />
                  </FormControl>
                  {descriptionChanged && (
                    <div className="text-amber-500 text-sm mt-1">
                      Warning: This will update the technique description globally for all students.
                    </div>
                  )}
                </FormItem>
              )}
            />
          </>
        )}

        <FormField
          control={form.control}
          name="student_notes"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Student Notes</FormLabel>
              <FormControl>
                <Textarea
                  {...field}
                  className="min-h-[120px] max-h-[300px] overflow-y-auto"
                  style={{ height: 'auto' }}
                />
              </FormControl>
            </FormItem>
          )}
        />

        {canEditAll && (
          <FormField
            control={form.control}
            name="coach_notes"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Coach Notes</FormLabel>
                <FormControl>
                  <Textarea
                    {...field}
                    className="min-h-[120px] max-h-[300px] overflow-y-auto"
                    style={{ height: 'auto' }}
                  />
                </FormControl>
              </FormItem>
            )}
          />
        )}

        <div className="flex justify-end gap-2 mt-6">
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? "Saving..." : "Save Changes"}
          </Button>
        </div>
      </form>
    </Form>
  );
}
