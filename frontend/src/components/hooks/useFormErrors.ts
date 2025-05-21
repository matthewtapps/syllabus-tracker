import { useState } from "react";
import { useForm, type FieldPath, type FieldValues } from "react-hook-form";
import { toast } from "sonner";

export function useFormWithValidation<T extends FieldValues>(formOptions = {}) {
  const methods = useForm<T>(formOptions);
  const [serverErrors, setServerErrors] = useState<Record<string, string[]>>(
    {},
  );

  const setFieldErrors = (errors: Record<string, string[]>) => {
    setServerErrors(errors);

    Object.entries(errors).forEach(([field, messages]) => {
      if (Array.isArray(messages) && messages.length > 0) {
        if (Object.keys(methods.getValues()).includes(field)) {
          methods.setError(field as FieldPath<T>, {
            type: "server",
            message: messages[0],
          });
        } else {
          toast.warning(`${field}: ${messages[0]}`);
        }
      }
    });
  };

  return {
    ...methods,
    setFieldErrors,
    serverErrors,
  };
}
