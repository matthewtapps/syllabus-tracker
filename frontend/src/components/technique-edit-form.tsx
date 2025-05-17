import { useState } from 'react';
import type { Technique, TechniqueUpdate } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel } from '@/components/ui/form';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useForm } from 'react-hook-form';
import { Card, CardContent } from './ui/card';
import { TracedForm } from './traced-form';

interface TechniqueEditFormProps {
  technique: Technique;
  canEditAll: boolean;
  currentUserId: number;
  studentId: number;
  onSubmit: (updates: TechniqueUpdate) => void;
}

export default function TechniqueEditForm({
  technique,
  canEditAll,
  onSubmit,
  currentUserId,
  studentId,
}: TechniqueEditFormProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [nameChanged, setNameChanged] = useState(false);
  const [descriptionChanged, setDescriptionChanged] = useState(false);
  const isOwnTechnique = currentUserId === studentId;
  const canEditStudentNotes = isOwnTechnique; // Only students edit their own notes

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
      if (!canEditStudentNotes) {
        const { student_notes, ...coachUpdates } = values;
        onSubmit(coachUpdates);
      } else {
        onSubmit(values);
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const ReadOnlyField = ({ label, value }: { label: string; value: string }) => (
    <div className="space-y-2 mb-4">
      <div className="font-medium text-sm">{label}</div>
      <Card>
        <CardContent className="p-3 bg-muted/40">
          <p className="text-sm whitespace-pre-wrap text-muted-foreground">{value || "No content"}</p>
        </CardContent>
      </Card>
    </div>
  );

  return (
    <Form {...form}>
      <TracedForm id="technique_edit" onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4 sm:space-y-6 mt-4 sm:mt-6">
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
                      className="min-h-[60px]"
                      onChange={(e) => {
                        field.onChange(e);
                        setNameChanged(e.target.value !== technique.technique_name);
                      }}
                    />
                  </FormControl>
                  {nameChanged && (
                    <FormDescription className="text-amber-500">
                      Warning: This will update the technique name globally for all students.
                    </FormDescription>
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
                      className="min-h-[120px] max-h-[300px]"
                      onChange={(e) => {
                        field.onChange(e);
                        setDescriptionChanged(e.target.value !== technique.technique_description);
                      }}
                    />
                  </FormControl>
                  {descriptionChanged && (
                    <FormDescription className="text-amber-500">
                      Warning: This will update the technique description globally for all students.
                    </FormDescription>
                  )}
                </FormItem>
              )}
            />
          </>
        )}

        {/* Student Notes - either editable or read-only */}
        {canEditStudentNotes ? (
          <FormField
            control={form.control}
            name="student_notes"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Student Notes</FormLabel>
                <FormControl>
                  <Textarea
                    {...field}
                    className="min-h-[120px] max-h-[300px]"
                  />
                </FormControl>
              </FormItem>
            )}
          />
        ) : (
          // Read-only view of student notes for coaches
          <ReadOnlyField
            label="Student Notes (Read Only)"
            value={technique.student_notes}
          />
        )}

        {/* Coach Notes - either editable or read-only */}
        {canEditAll ? (
          <FormField
            control={form.control}
            name="coach_notes"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Coach Notes</FormLabel>
                <FormControl>
                  <Textarea
                    {...field}
                    className="min-h-[120px] max-h-[300px]"
                  />
                </FormControl>
              </FormItem>
            )}
          />
        ) : (
          // Read-only view of coach notes for students
          <ReadOnlyField
            label="Coach Notes (Read Only)"
            value={technique.coach_notes}
          />
        )}

        <div className="flex justify-end gap-2 mt-6">
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? "Saving..." : "Save Changes"}
          </Button>
        </div>
      </TracedForm>
    </Form>
  );
}
