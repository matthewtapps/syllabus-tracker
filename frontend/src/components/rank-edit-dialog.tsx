import { useEffect } from 'react';
import { toast } from 'sonner';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import type { Belt, User } from '@/lib/api';
import { useSetStudentRank } from '@/lib/mutations';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { TracedForm } from '@/components/traced-form';
import { handleApiFormError, useFormWithValidation } from '@/components/hooks/useFormErrors';

const BELTS: Belt[] = ['white', 'blue', 'purple', 'brown', 'black', 'coral'];
const BELT_LABELS: Record<Belt, string> = {
  white: 'White',
  blue: 'Blue',
  purple: 'Purple',
  brown: 'Brown',
  black: 'Black',
  coral: 'Coral',
};

// Internal sentinel; <Select> can't carry an empty-string value, so the
// "Clear" choice rides this token and gets translated back to null on
// submit.
const NO_BELT = '__none__';

const rankSchema = z.object({
  belt: z.string(),
  stripes: z.coerce
    .number({ invalid_type_error: 'Stripes must be a number' })
    .int()
    .min(0, 'At least 0')
    .max(4, 'At most 4'),
  last_graded_at: z.string(),
});

type RankValues = z.infer<typeof rankSchema>;

interface RankEditDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  student: User;
}

export function RankEditDialog({ open, onOpenChange, student }: RankEditDialogProps) {
  const setRank = useSetStudentRank();

  const form = useFormWithValidation<RankValues>({
    resolver: zodResolver(rankSchema),
    defaultValues: {
      belt: student.belt ?? NO_BELT,
      stripes: student.stripes ?? 0,
      last_graded_at: student.last_graded_at ? student.last_graded_at.slice(0, 10) : '',
    },
  });

  // Reset whenever the dialog (re-)opens so a coach editing two students
  // back-to-back doesn't see the previous one's values bleed across.
  useEffect(() => {
    if (open) {
      form.reset({
        belt: student.belt ?? NO_BELT,
        stripes: student.stripes ?? 0,
        last_graded_at: student.last_graded_at ? student.last_graded_at.slice(0, 10) : '',
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, student.id]);

  async function onSubmit(values: RankValues) {
    const belt = values.belt === NO_BELT ? null : (values.belt as Belt);
    const stripes = belt === null ? null : values.stripes;
    // The backend stores naive datetimes; sending midnight UTC for the
    // day the user picked keeps the "graded on day X" semantics without
    // dragging a timezone in.
    const last_graded_at = values.last_graded_at
      ? `${values.last_graded_at}T00:00:00`
      : null;
    try {
      await setRank.mutateAsync({
        id: student.id,
        rank: { belt, stripes, last_graded_at },
      });
      toast.success('Rank updated');
      onOpenChange(false);
    } catch (err) {
      const handled = await handleApiFormError(
        err,
        form.setError,
        Object.keys(form.getValues()),
      );
      if (!handled) toast.error(err instanceof Error ? err.message : 'Failed to update rank');
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100vw-1rem)] max-w-sm p-4 sm:p-6">
        <DialogHeader>
          <DialogTitle>Edit rank</DialogTitle>
          <DialogDescription>
            Updates {student.display_name || student.username}'s belt, stripes,
            and last grading date.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <TracedForm id="rank-edit-form" onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="belt"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Belt</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Pick a belt" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value={NO_BELT}>No belt set</SelectItem>
                      {BELTS.map((b) => (
                        <SelectItem key={b} value={b}>
                          {BELT_LABELS[b]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="stripes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Stripes</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      min={0}
                      max={4}
                      step={1}
                      inputMode="numeric"
                      disabled={form.watch('belt') === NO_BELT}
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="last_graded_at"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Last graded</FormLabel>
                  <FormControl>
                    <Input type="date" disabled={form.watch('belt') === NO_BELT} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <DialogFooter className="gap-2 sm:gap-2">
              <Button
                type="button"
                variant="ghost"
                onClick={() => onOpenChange(false)}
                disabled={setRank.isPending}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={setRank.isPending}>
                {setRank.isPending ? 'Saving...' : 'Save'}
              </Button>
            </DialogFooter>
          </TracedForm>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
