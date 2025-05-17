import React, { type FormEvent, type ReactNode, useRef, useState } from 'react';
import { recordFormSubmission } from '@/lib/telemetry';
import { useTelemetry } from '@/context/telemetry';
import { type Span } from '@opentelemetry/api';

interface TracedFormProps extends React.FormHTMLAttributes<HTMLFormElement> {
  children: ReactNode;
  onSubmit?: (event: FormEvent<HTMLFormElement>) => void | Promise<void>;
  onSubmitSuccess?: () => void;
  onSubmitError?: (error: unknown) => void;
}

/**
 * A form component that automatically traces form submissions
 */
export function TracedForm({
  children,
  onSubmit,
  onSubmitSuccess,
  onSubmitError,
  ...props
}: TracedFormProps) {
  const { fetch } = useTelemetry();
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

    // Create form submission span
    formSpanRef.current = recordFormSubmission(formId, formAction, formMethod);

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
      onSubmitError?.(error);
      console.error('Form submission error:', error);
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
