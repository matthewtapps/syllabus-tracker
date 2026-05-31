export interface ValidationErrorResponse {
  status: string;
  errors: Record<string, string[]>;
}

// Type guard to check if an object is a ValidationErrorResponse
export function isValidationErrorResponse(
  obj: unknown,
): obj is ValidationErrorResponse {
  if (typeof obj !== "object" || obj === null) return false;
  const record = obj as Record<string, unknown>;
  return (
    typeof record.status === "string" &&
    typeof record.errors === "object" &&
    record.errors !== null
  );
}
