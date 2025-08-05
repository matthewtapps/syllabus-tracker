import React, { type FormEvent, type ReactNode, useRef, useState } from 'react';
import { recordFormSubmission } from '@/lib/telemetry';
import { type Span } from '@opentelemetry/api';
import { toast } from 'sonner';
import { isValidationErrorResponse } from '@/lib/types';

interface TracedFormProps extends React.FormHTMLAttributes<HTMLFormElement> {
  children: ReactNode;
  onSubmit?: (event: FormEvent<HTMLFormElement>) => void | Promise<void>;
  onSubmitSuccess?: () => void;
  onSubmitError?: (error: unknown) => void;
  setFieldErrors?: (errors: Record<string, string[]>) => void;
}

/**
 * A form component that automatically traces form submissions
 */
export function TracedForm({
  children,
  onSubmit,
  onSubmitSuccess,
  onSubmitError,
  setFieldErrors,
  ...props
}: TracedFormProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const formSpanRef = useRef<Span | null>(null);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (isSubmitting) {
      return;
    }

    setIsSubmitting(true);
    const form = event.currentTarget;
    const formId = form.id || 'unnamed-form';
    const formAction = form.action || window.location.href;
    const formMethod = form.method || 'get';

    formSpanRef.current = recordFormSubmission(formId, formAction, formMethod);

    const formData = new FormData(form);
    const formFields: Record<string, string> = {};

    formData.forEach((value, key) => {
      // Skip password fields
      if (!key.toLowerCase().includes('password')) {
        formFields[key] = typeof value === 'string' ? value : 'binary data';
      } else {
        formFields[key] = '[REDACTED]';
      }
    });

    formSpanRef.current?.setAttribute('form.fields', JSON.stringify(formFields));

    try {
      // Call the provided onSubmit handler if it exists
      if (onSubmit) {
        await onSubmit(event);
      } else {
        // Default form submission handling
        const formData = new FormData(form);

        const response = await fetch(formAction, {
          method: formMethod,
          body: formData,
          credentials: 'include',
        });

        if (!response.ok) {
          throw new Error(`Form submission failed: ${response.status} ${response.statusText}`);
        }

        // Handle redirects in SPA context
        if (response.redirected) {
          window.location.href = response.url;
          return;
        }
      }

      formSpanRef.current?.addEvent('form_submit_success');
      onSubmitSuccess?.();
    } catch (error) {
      formSpanRef.current?.addEvent('form_submit_error', {
        'error.message': error instanceof Error ? error.message : String(error),
      });

      let errorData: unknown = null;

      // Extract data from error responses
      if (error instanceof Response) {
        try {
          errorData = await error.json();
        } catch (e) {
          // Not JSON
        }
      } else if (error && typeof error === 'object' && 'response' in error) {
        const errorResponse = (error as { response?: Response }).response;
        if (errorResponse instanceof Response) {
          try {
            errorData = await errorResponse.json();
          } catch (e) {
            // Not JSON
          }
        }
      }

      // Process validation errors
      if (isValidationErrorResponse(errorData)) {
        // Set field errors if callback provided
        if (setFieldErrors) {
          setFieldErrors(errorData.errors);
        }

        // Show validation errors as toasts
        Object.entries(errorData.errors).forEach(([field, messages]) => {
          messages.forEach(message => {
            toast.error(`${field}: ${message}`);
          });
        });

        // Log to telemetry
        formSpanRef.current?.setAttribute('validation_errors', JSON.stringify(errorData.errors));
      } else {
        // Generic error toast
        toast.error(error instanceof Error ? error.message : "An unexpected error occurred");
      }

      onSubmitError?.(error);
    } finally {
      setIsSubmitting(false);
      formSpanRef.current?.end();
      formSpanRef.current = null;
    }
  };

  return (
    <form {...props} ref={formRef} onSubmit={handleSubmit}>
      {children}
    </form>
  );
}
