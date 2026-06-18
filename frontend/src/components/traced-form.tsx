import React, { type FormEvent, type ReactNode, useState } from 'react';
import { runInFormSpan } from '@/lib/telemetry';

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
    try {
      await runInFormSpan(
        {
          formId: form.id || 'unnamed-form',
          action: form.action || window.location.href,
          method: form.method || 'get',
        },
        () => Promise.resolve(onSubmit(event)),
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form {...props} onSubmit={handleSubmit}>
      {children}
    </form>
  );
}
