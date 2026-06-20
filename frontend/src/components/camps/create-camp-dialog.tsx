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
import { useCreateCamp } from "@/lib/mutations";

const createCampSchema = z.object({
  name: z
    .string()
    .min(1, "Name is required")
    .max(100, "Name must be under 100 characters"),
  description: z.string().max(1000, "Description is too long").optional(),
});
type CreateCampValues = z.infer<typeof createCampSchema>;

export function CreateCampDialog({
  studentId,
  studentName,
  onCreated,
}: {
  studentId: number;
  studentName: string;
  onCreated: (id: number) => void;
}) {
  const createMutation = useCreateCamp(studentId);

  const form = useFormWithValidation<CreateCampValues>({
    resolver: zodResolver(createCampSchema),
    defaultValues: { name: "", description: "" },
  });

  async function handleSubmit(values: CreateCampValues) {
    try {
      const { id } = await createMutation.mutateAsync({
        name: values.name,
        description: values.description?.trim() ? values.description : null,
      });
      toast.success(`Created ${values.name}`);
      onCreated(id);
    } catch (err) {
      const handled = await handleApiFormError(
        err,
        form.setError,
        Object.keys(form.getValues()),
      );
      if (!handled) toast.error("Failed to create camp");
    }
  }

  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>New camp for {studentName}</DialogTitle>
        <DialogDescription>
          Add a name and optional description. You can add techniques after.
        </DialogDescription>
      </DialogHeader>
      <Form {...form}>
        <TracedForm
          id="create_camp"
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
              {form.formState.isSubmitting ? "Creating..." : "Create"}
            </Button>
          </DialogFooter>
        </TracedForm>
      </Form>
    </DialogContent>
  );
}
