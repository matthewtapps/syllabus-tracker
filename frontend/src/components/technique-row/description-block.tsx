import { useState } from "react";
import { Pencil } from "lucide-react";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
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
import { useUpdateLibraryTechnique } from "@/lib/mutations";
import { useTechniqueRow } from "./technique-row-context";

interface DescriptionBlockProps {
  editable: boolean;
}

export function DescriptionBlock({ editable }: DescriptionBlockProps) {
  const { technique } = useTechniqueRow();
  const [editing, setEditing] = useState(false);

  if (editing) {
    return <DescriptionEditor onDone={() => setEditing(false)} />;
  }

  return (
    <div className="flex items-start gap-2">
      <div className="min-w-0 flex-1">
        {technique.description ? (
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">
            {technique.description}
          </p>
        ) : (
          <p className="text-sm italic text-muted-foreground">
            No description yet.
          </p>
        )}
      </div>
      {editable && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-7 w-7 shrink-0 text-muted-foreground hover:text-foreground"
          onClick={() => setEditing(true)}
          aria-label="Edit name and description"
        >
          <Pencil className="h-3.5 w-3.5" aria-hidden />
        </Button>
      )}
    </div>
  );
}

const editSchema = z.object({
  name: z.string().min(1, "Name is required").max(100, "Name is too long"),
  description: z.string().min(1, "Description is required"),
});
type EditValues = z.infer<typeof editSchema>;

function DescriptionEditor({ onDone }: { onDone: () => void }) {
  const { technique } = useTechniqueRow();
  const updateMutation = useUpdateLibraryTechnique();
  const form = useFormWithValidation<EditValues>({
    resolver: zodResolver(editSchema),
    defaultValues: {
      name: technique.name,
      description: technique.description,
    },
  });

  async function handleSubmit(values: EditValues) {
    try {
      await updateMutation.mutateAsync({
        techniqueId: technique.id,
        data: values,
      });
      toast.success("Technique updated");
      onDone();
    } catch (err) {
      const handled = await handleApiFormError(
        err,
        form.setError,
        Object.keys(form.getValues()),
      );
      if (!handled) {
        toast.error(
          err instanceof Error ? err.message : "Failed to update technique",
        );
      }
    }
  }

  return (
    <Form {...form}>
      <TracedForm
        id="edit_library_technique"
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
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" size="sm" onClick={onDone}>
            Cancel
          </Button>
          <Button
            type="submit"
            size="sm"
            disabled={form.formState.isSubmitting}
          >
            {form.formState.isSubmitting ? "Saving..." : "Save"}
          </Button>
        </div>
      </TracedForm>
    </Form>
  );
}
