import {
  useForm,
  type FieldPath,
  type FieldValues,
  type UseFormReturn,
} from "react-hook-form";
import { toast } from "sonner";
import { isValidationErrorResponse } from "@/lib/types";

// Drop-in wrapper around useForm. Kept as its own export so existing call
// sites don't change; new code is welcome to use useForm directly.
export function useFormWithValidation<T extends FieldValues>(formOptions = {}) {
  return useForm<T>(formOptions);
}

// Maps a server validation Response into RHF field errors. Returns true if
// the error was a recognised validation envelope, false otherwise (so the
// caller can fall back to a generic toast).
//
// Designed to be called inside the form's onSubmit catch block, keeping
// network error handling next to the form state it patches. Errors for
// fields the form doesn't know about become warning toasts.
export async function handleApiFormError<T extends FieldValues>(
  err: unknown,
  setError: UseFormReturn<T>["setError"],
  knownFields: string[],
): Promise<boolean> {
  if (!(err instanceof Response)) return false;
  let body: unknown = null;
  try {
    body = await err.json();
  } catch {
    return false;
  }
  if (!isValidationErrorResponse(body)) return false;

  Object.entries(body.errors).forEach(([field, messages]) => {
    if (!Array.isArray(messages) || messages.length === 0) return;
    if (knownFields.includes(field)) {
      setError(field as FieldPath<T>, {
        type: "server",
        message: messages[0],
      });
    } else {
      toast.warning(`${field}: ${messages[0]}`);
    }
  });
  return true;
}
