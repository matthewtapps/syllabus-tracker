import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { AlertCircle, GraduationCap } from 'lucide-react';
import { toast } from 'sonner';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { claimInvite, getInvite, type InviteInfo } from '@/lib/api';
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
import { Skeleton } from '@/components/ui/skeleton';
import { TracedForm } from '@/components/traced-form';
import { handleApiFormError, useFormWithValidation } from '@/components/hooks/useFormErrors';

const claimSchema = z
  .object({
    username: z
      .string()
      .min(3, 'Username must be at least 3 characters')
      .max(50, 'Username is too long')
      .regex(/^\S+$/, 'Username cannot contain spaces'),
    password: z.string().min(5, 'Password must be at least 5 characters'),
    confirm_password: z.string().min(1, 'Please confirm your password'),
  })
  .refine((d) => d.password === d.confirm_password, {
    path: ['confirm_password'],
    message: 'Passwords do not match',
  });

type ClaimValues = z.infer<typeof claimSchema>;

interface InvitePageProps {
  onClaimSuccess: () => void;
}

export default function InvitePage({ onClaimSuccess }: InvitePageProps) {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const [info, setInfo] = useState<InviteInfo | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'invalid'>(
    'loading',
  );

  const form = useFormWithValidation<ClaimValues>({
    resolver: zodResolver(claimSchema),
    defaultValues: { username: '', password: '', confirm_password: '' },
  });

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!token) {
        setStatus('invalid');
        return;
      }
      try {
        const response = await getInvite(token);
        if (cancelled) return;
        if (!response.ok) {
          setStatus('invalid');
          return;
        }
        setInfo(await response.json());
        setStatus('ready');
      } catch {
        if (!cancelled) setStatus('invalid');
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [token]);

  async function handleSubmit(data: ClaimValues) {
    if (!token) return;
    try {
      const response = await claimInvite(token, {
        username: data.username,
        password: data.password,
      });
      if (!response.ok) throw response;
      onClaimSuccess();
      navigate('/dashboard');
    } catch (err) {
      const handled = await handleApiFormError(
        err,
        form.setError,
        Object.keys(form.getValues()),
      );
      if (!handled) toast.error(err instanceof Error ? err.message : 'Failed to claim invite');
    }
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

      <div className="w-full max-w-md">
        {status === 'loading' && (
          <div className="space-y-4 rounded-lg border border-border bg-card p-6">
            <Skeleton className="h-6 w-1/2" />
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
          </div>
        )}

        {status === 'invalid' && (
          <div className="flex flex-col items-center gap-4 rounded-lg border border-border bg-card p-8 text-center">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
              <AlertCircle className="h-5 w-5" aria-hidden />
            </div>
            <div className="space-y-1">
              <p className="font-medium">This link is no longer valid</p>
              <p className="text-sm text-muted-foreground">
                Ask your coach for a fresh claim link.
              </p>
            </div>
            <Button asChild variant="outline">
              <Link to="/login">Back to sign in</Link>
            </Button>
          </div>
        )}

        {status === 'ready' && info && (
          <div className="rounded-lg border border-border bg-card p-6">
            <div className="mb-5 flex items-start gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                <GraduationCap className="h-5 w-5" aria-hidden />
              </div>
              <div className="space-y-0.5">
                <p className="font-medium">Welcome, {info.display_name}</p>
                <p className="text-sm text-muted-foreground">
                  Pick a username and a password to claim your account.
                </p>
              </div>
            </div>

            <Form {...form}>
              <TracedForm
                id="claim_invite"
                onSubmit={form.handleSubmit(handleSubmit)}
                className="space-y-4"
              >
                <FormField
                  control={form.control}
                  name="username"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Username</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          autoFocus
                          autoComplete="username"
                          placeholder="Pick something easy to remember"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="password"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Password</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          type="password"
                          autoComplete="new-password"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="confirm_password"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Confirm password</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          type="password"
                          autoComplete="new-password"
                        />
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
                  {form.formState.isSubmitting ? 'Claiming...' : 'Claim my account'}
                </Button>
              </TracedForm>
            </Form>
          </div>
        )}
      </div>
    </div>
  );
}
