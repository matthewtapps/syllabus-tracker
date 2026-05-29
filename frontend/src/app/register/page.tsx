import { Link, useNavigate } from 'react-router-dom';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { selfRegister } from '@/lib/api';
import { Button } from '@/components/ui/button';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { TracedForm } from '@/components/traced-form';
import { useFormWithValidation } from '@/components/hooks/useFormErrors';

const registerSchema = z
  .object({
    first_name: z.string().min(1, 'First name is required').max(50),
    last_name: z.string().max(50).optional().or(z.literal('')),
    username: z
      .string()
      .min(3, 'Username must be at least 3 characters')
      .max(50)
      .regex(/^\S+$/, 'Username cannot contain spaces'),
    password: z.string().min(5, 'Password must be at least 5 characters'),
    confirm_password: z.string().min(1, 'Please confirm your password'),
  })
  .refine((d) => d.password === d.confirm_password, {
    path: ['confirm_password'],
    message: 'Passwords do not match',
  });

type RegisterValues = z.infer<typeof registerSchema>;

interface RegisterPageProps {
  onRegisterSuccess: () => void;
}

export default function RegisterPage({ onRegisterSuccess }: RegisterPageProps) {
  const navigate = useNavigate();

  const form = useFormWithValidation<RegisterValues>({
    resolver: zodResolver(registerSchema),
    defaultValues: {
      first_name: '',
      last_name: '',
      username: '',
      password: '',
      confirm_password: '',
    },
  });

  async function handleSubmit(data: RegisterValues) {
    const response = await selfRegister({
      username: data.username,
      password: data.password,
      first_name: data.first_name,
      last_name: data.last_name && data.last_name.length > 0 ? data.last_name : undefined,
    });
    if (!response.ok) throw response;
    onRegisterSuccess();
    navigate('/dashboard');
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
        <div className="rounded-lg border border-border bg-card p-6">
          <div className="mb-5 space-y-1">
            <h2 className="text-xl font-semibold">Sign up</h2>
            <p className="text-sm text-muted-foreground">
              Create your account. Your coach will approve it once you let them
              know.
            </p>
          </div>

          <Form {...form}>
            <TracedForm
              id="self_register"
              onSubmit={form.handleSubmit(handleSubmit)}
              setFieldErrors={form.setFieldErrors}
              className="space-y-4"
            >
              <div className="grid gap-3 sm:grid-cols-2">
                <FormField
                  control={form.control}
                  name="first_name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>First name</FormLabel>
                      <FormControl>
                        <Input {...field} autoFocus autoComplete="given-name" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="last_name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Last name (optional)</FormLabel>
                      <FormControl>
                        <Input {...field} autoComplete="family-name" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={form.control}
                name="username"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Username</FormLabel>
                    <FormControl>
                      <Input {...field} autoComplete="username" />
                    </FormControl>
                    <FormDescription>
                      Pick something you'll remember. No spaces.
                    </FormDescription>
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
                {form.formState.isSubmitting ? 'Creating account...' : 'Create account'}
              </Button>
            </TracedForm>
          </Form>
        </div>

        <p className="mt-4 text-center text-sm text-muted-foreground">
          Already have an account?{' '}
          <Link to="/login" className="font-medium text-primary hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
