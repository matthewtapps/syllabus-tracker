export interface ValidationErrorResponse {
  status: string;
  errors: Record<string, string[]>;
}

// Type guard to check if an object is a ValidationErrorResponse
export function isValidationErrorResponse(
  obj: unknown,
): obj is ValidationErrorResponse {
  return (
    typeof obj === "object" &&
    obj !== null &&
    "status" in obj &&
    "errors" in obj &&
    typeof (obj as any).status === "string" &&
    typeof (obj as any).errors === "object"
  );
}
