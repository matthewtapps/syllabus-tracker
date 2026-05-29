import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, KeyRound } from 'lucide-react';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { requestPasswordReset } from '@/lib/api';
import { Button } from '@/components/ui/button';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { TracedForm } from '@/components/traced-form';
import { useFormWithValidation } from '@/components/hooks/useFormErrors';

const schema = z.object({
  username: z.string().min(1, 'Username is required'),
});
type Values = z.infer<typeof schema>;

export default function ForgotPasswordPage() {
  const [submitted, setSubmitted] = useState(false);

  const form = useFormWithValidation<Values>({
    resolver: zodResolver(schema),
    defaultValues: { username: '' },
  });

  async function handleSubmit(data: Values) {
    const response = await requestPasswordReset(data.username);
    if (!response.ok) throw response;
    setSubmitted(true);
  }

  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-8 bg-background px-6 py-10">
      <div className="flex w-full max-w-md flex-col items-center gap-3 text-center">
        <div className="flex items-center gap-2">
          <img src="/img/logo.png" alt="" className="h-8 w-8" aria-hidden />
          <span className="text-xl font-semibold tracking-tight">Silly Bus</span>
        </div>
        <p className="text-sm uppercase tracking-[0.2em] text-muted-foreground">
          Dominance MMA Jiu Jitsu Syllabus Tracker
        </p>
      </div>

      <div className="w-full max-w-md rounded-lg border border-border bg-card p-6">
        {submitted ? (
          <div className="space-y-4">
            <div className="flex items-start gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-status-green-bg text-status-green">
                <Check className="h-5 w-5" aria-hidden />
              </div>
              <div className="space-y-0.5">
                <p className="font-medium">Request sent</p>
                <p className="text-sm text-muted-foreground">
                  If that account exists, your coach will see a request and can
                  send you a fresh sign-in link. Let your coach know you're
                  waiting.
                </p>
              </div>
            </div>
            <Button asChild variant="outline" className="w-full">
              <Link to="/login">Back to sign in</Link>
            </Button>
          </div>
        ) : (
          <>
            <div className="mb-5 flex items-start gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                <KeyRound className="h-5 w-5" aria-hidden />
              </div>
              <div className="space-y-0.5">
                <p className="font-medium">Forgot your password?</p>
                <p className="text-sm text-muted-foreground">
                  Enter your username and your coach will get a reset request
                  on their dashboard.
                </p>
              </div>
            </div>

            <Form {...form}>
              <TracedForm
                id="request_password_reset"
                onSubmit={form.handleSubmit(handleSubmit)}
                setFieldErrors={form.setFieldErrors}
                className="space-y-4"
              >
                <FormField
                  control={form.control}
                  name="username"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Username</FormLabel>
                      <FormControl>
                        <Input {...field} autoFocus autoComplete="username" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <Button
                  type="submit"
                  className="w-full"
                  disabled={form.formState.isSubmitting}
                >
                  {form.formState.isSubmitting ? 'Sending...' : 'Request reset'}
                </Button>

                <p className="text-center text-sm text-muted-foreground">
                  Remembered it?{' '}
                  <Link to="/login" className="font-medium text-primary hover:underline">
                    Sign in
                  </Link>
                </p>
              </TracedForm>
            </Form>
          </>
        )}
      </div>
    </div>
  );
}
