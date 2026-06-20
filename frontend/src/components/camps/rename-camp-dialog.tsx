import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { TracedForm } from "@/components/traced-form";
import {
  handleApiFormError,
  useFormWithValidation,
} from "@/components/hooks/useFormErrors";
import { useUpdateCamp } from "@/lib/mutations";

const renameCampSchema = z.object({
  name: z
    .string()
    .min(1, "Name is required")
    .max(100, "Name must be under 100 characters"),
  description: z.string().max(1000, "Description is too long").optional(),
});
type RenameCampValues = z.infer<typeof renameCampSchema>;

export function RenameCampDialog({
  campId,
  studentId,
  currentName,
  currentDescription,
  onRenamed,
}: {
  campId: number;
  studentId: number;
  currentName: string;
  currentDescription: string | null;
  onRenamed: () => void;
}) {
  const updateMutation = useUpdateCamp(campId, studentId);

  const form = useFormWithValidation<RenameCampValues>({
    resolver: zodResolver(renameCampSchema),
    defaultValues: { name: currentName, description: currentDescription ?? "" },
  });

  async function handleSubmit(values: RenameCampValues) {
    try {
      await updateMutation.mutateAsync({
        name: values.name,
        description: values.description?.trim() ? values.description : null,
      });
      toast.success("Camp updated");
      onRenamed();
    } catch (err) {
      const handled = await handleApiFormError(
        err,
        form.setError,
        Object.keys(form.getValues()),
      );
      if (!handled) toast.error("Failed to update camp");
    }
  }

  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Rename camp</DialogTitle>
        <DialogDescription>
          Update the camp name and optional description.
        </DialogDescription>
      </DialogHeader>
      <Form {...form}>
        <TracedForm
          id="rename_camp"
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
                  <Input autoFocus placeholder="e.g. Worlds prep" {...field} />
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
                  <Textarea {...field} className="min-h-20" />
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
              {form.formState.isSubmitting ? "Saving..." : "Save changes"}
            </Button>
          </DialogFooter>
        </TracedForm>
      </Form>
    </DialogContent>
  );
}
