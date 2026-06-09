import React, { type FormEvent, type ReactNode, useState } from 'react';
import { recordFormSubmission } from '@/lib/telemetry';

interface TracedFormProps extends React.FormHTMLAttributes<HTMLFormElement> {
  children: ReactNode;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void | Promise<void>;
}

/**
 * Thin <form> wrapper that opens an OpenTelemetry span around the caller's
 * onSubmit and records success / error events. All validation and error
 * display lives in the caller, typically via RHF + `handleApiFormError`.
 */
export function TracedForm({ children, onSubmit, ...props }: TracedFormProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isSubmitting) return;
    setIsSubmitting(true);

    const form = event.currentTarget;
    const span = recordFormSubmission(
      form.id || 'unnamed-form',
      form.action || window.location.href,
      form.method || 'get',
    );

    try {
      await onSubmit(event);
      span?.addEvent('form_submit_success');
    } catch (err) {
      span?.addEvent('form_submit_error', {
        'error.message': err instanceof Error ? err.message : String(err),
      });
      throw err;
    } finally {
      span?.end();
      setIsSubmitting(false);
    }
  };

  return (
    <form {...props} onSubmit={handleSubmit}>
      {children}
    </form>
  );
}
