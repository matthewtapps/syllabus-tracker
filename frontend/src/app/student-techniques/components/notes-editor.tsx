import { useState } from "react";
import { PencilIcon } from "lucide-react";
import { updateTechnique } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { handleApiFormError, useFormWithValidation } from "@/components/hooks/useFormErrors";
import { TracedForm } from "@/components/traced-form";

type NotesField = "student_notes" | "coach_notes";

interface NotesEditorProps {
  techniqueId: number;
  field: NotesField;
  label: string;
  value: string;
  canEdit: boolean;
  onSave: (newValue: string) => void;
}

export function NotesEditor({
  techniqueId,
  field,
  label,
  value,
  canEdit,
  onSave,
}: NotesEditorProps) {
  const [editing, setEditing] = useState(false);

  if (editing) {
    return (
      <NotesEditorForm
        techniqueId={techniqueId}
        field={field}
        label={label}
        initialValue={value}
        onSave={(v) => {
          onSave(v);
          setEditing(false);
        }}
        onCancel={() => setEditing(false)}
      />
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </h3>
        {canEdit && (
          <Button
            variant="ghost"
            size="sm"
            className="h-8 gap-1.5 text-muted-foreground hover:text-foreground"
            onClick={(e) => {
              e.stopPropagation();
              setEditing(true);
            }}
          >
            <PencilIcon className="h-3.5 w-3.5" aria-hidden />
            <span className="sr-only sm:not-sr-only sm:text-xs">Edit</span>
          </Button>
        )}
      </div>
      {value ? (
        <p className="whitespace-pre-wrap text-sm leading-relaxed">{value}</p>
      ) : (
        <p className="text-sm italic text-muted-foreground">No notes yet</p>
      )}
    </div>
  );
}

interface NotesEditorFormProps {
  techniqueId: number;
  field: NotesField;
  label: string;
  initialValue: string;
  onSave: (newValue: string) => void;
  onCancel: () => void;
}

function NotesEditorForm({
  techniqueId,
  field,
  label,
  initialValue,
  onSave,
  onCancel,
}: NotesEditorFormProps) {
  const form = useFormWithValidation<Record<NotesField, string>>({
    defaultValues: { [field]: initialValue } as Record<NotesField, string>,
  });

  const handleSubmit = async (data: Record<NotesField, string>) => {
    try {
      const response = await updateTechnique(techniqueId, { [field]: data[field] });
      if (!response.ok) throw response;
      onSave(data[field]);
    } catch (err) {
      const handled = await handleApiFormError(
        err,
        form.setError,
        Object.keys(form.getValues()),
      );
      if (!handled) toast.error(err instanceof Error ? err.message : "Failed to save notes");
    }
  };

  return (
    <div className="space-y-2">
      <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </h3>
      <TracedForm
        id={`${field}_${techniqueId}`}
        onSubmit={form.handleSubmit(handleSubmit)}
        className="space-y-2"
      >
        <Textarea
          {...form.register(field)}
          className="min-h-[100px]"
          onClick={(e) => e.stopPropagation()}
          autoFocus
          aria-invalid={!!form.formState.errors[field]}
        />
        {form.formState.errors[field] && (
          <p className="text-sm text-destructive">
            {String(form.formState.errors[field]?.message || "Invalid notes")}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              onCancel();
            }}
          >
            Cancel
          </Button>
          <Button type="submit" size="sm" disabled={form.formState.isSubmitting}>
            {form.formState.isSubmitting ? "Saving..." : "Save"}
          </Button>
        </div>
      </TracedForm>
    </div>
  );
}
