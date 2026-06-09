import { useEffect } from 'react';
import { toast } from 'sonner';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { useCurrentUser } from '@/lib/queries';
import { useUpdatePassword, useUpdateUserProfile } from '@/lib/mutations';
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
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { TracedForm } from '@/components/traced-form';
import { handleApiFormError, useFormWithValidation } from '@/components/hooks/useFormErrors';

const profileSchema = z.object({
  display_name: z.string(),
  username: z
    .string()
    .min(1, 'Username is required')
    .max(50, 'Username is too long')
    .regex(/^\S+$/, 'No spaces in usernames'),
});

// Visible-on-page list of password rules. Each rule renders below the
// new-password field. Keep `test` in sync with the backend's validation
// in `api_change_password` so client and server agree on what's valid.
const PASSWORD_RULES: { label: string; test: (v: string) => boolean }[] = [
  {
    label: 'At least 5 characters long',
    test: (v) => v.length >= 5,
  },
];

const passwordSchema = z
  .object({
    current_password: z.string().min(1, 'Current password is required'),
    new_password: z
      .string()
      .refine((v) => PASSWORD_RULES.every((r) => r.test(v)), {
        // Empty message; the per-rule list below the input is the actual
        // failure surface, so FormMessage just acts as the trigger that
        // flips the input's error state on.
        message: '',
      }),
    confirm_password: z.string().min(1, 'Please confirm the new password'),
  })
  .refine((data) => data.new_password === data.confirm_password, {
    path: ['confirm_password'],
    message: 'Passwords do not match',
  });

type ProfileValues = z.infer<typeof profileSchema>;
type PasswordValues = z.infer<typeof passwordSchema>;

export default function ProfilePage() {
  const userQuery = useCurrentUser();
  const user = userQuery.data ?? null;
  const loading = userQuery.isLoading;
  const profileMutation = useUpdateUserProfile();
  const passwordMutation = useUpdatePassword();

  const profileForm = useFormWithValidation<ProfileValues>({
    resolver: zodResolver(profileSchema),
    defaultValues: { display_name: '', username: '' },
  });

  const passwordForm = useFormWithValidation<PasswordValues>({
    resolver: zodResolver(passwordSchema),
    defaultValues: {
      current_password: '',
      new_password: '',
      confirm_password: '',
    },
  });

  // Once we have the current user, seed the form exactly once.
  useEffect(() => {
    if (user) {
      profileForm.reset({
        display_name: user.display_name ?? '',
        username: user.username ?? '',
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  async function handleProfileSubmit(data: ProfileValues) {
    try {
      await profileMutation.mutateAsync({
        display_name: data.display_name,
        username: data.username.trim(),
      });
      toast.success('Profile updated');
    } catch (err) {
      const handled = await handleApiFormError(
        err,
        profileForm.setError,
        Object.keys(profileForm.getValues()),
      );
      if (!handled) toast.error(err instanceof Error ? err.message : 'Failed to update profile');
    }
  }

  async function handlePasswordSubmit(data: PasswordValues) {
    try {
      await passwordMutation.mutateAsync({
        current_password: data.current_password,
        new_password: data.new_password,
      });
      toast.success('Password changed');
      passwordForm.reset();
    } catch (err) {
      const handled = await handleApiFormError(
        err,
        passwordForm.setError,
        Object.keys(passwordForm.getValues()),
      );
      if (!handled) toast.error(err instanceof Error ? err.message : 'Failed to change password');
    }
  }

  return (
    <div className="container mx-auto max-w-2xl px-4 py-6 sm:px-6 md:py-8">
      <section className="space-y-5">
        <h2 className="text-base font-semibold">Account</h2>

        {loading ? (
          <div className="space-y-3">
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
          </div>
        ) : (
          <Form {...profileForm}>
            <TracedForm
              id="update_profile"
              onSubmit={profileForm.handleSubmit(handleProfileSubmit)}
              className="space-y-4"
            >
              <FormField
                control={profileForm.control}
                name="username"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Username</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        autoComplete="username"
                        spellCheck={false}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={profileForm.control}
                name="display_name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Display name</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="How others see you" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="flex justify-end">
                <Button
                  type="submit"
                  disabled={profileForm.formState.isSubmitting}
                >
                  {profileForm.formState.isSubmitting ? 'Saving...' : 'Save changes'}
                </Button>
              </div>
            </TracedForm>
          </Form>
        )}
      </section>

      <Separator className="my-8" />

      <section className="space-y-5">
        <h2 className="text-base font-semibold">Password</h2>

        <Form {...passwordForm}>
          <TracedForm
            id="change_password"
            onSubmit={passwordForm.handleSubmit(handlePasswordSubmit)}
            className="space-y-4"
          >
            <FormField
              control={passwordForm.control}
              name="current_password"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Current password</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      type="password"
                      autoComplete="current-password"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={passwordForm.control}
              name="new_password"
              render={({ field, fieldState }) => (
                <FormItem>
                  <FormLabel>New password</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      type="password"
                      autoComplete="new-password"
                    />
                  </FormControl>
                  <PasswordRules
                    value={field.value}
                    showErrors={!!fieldState.error}
                  />
                </FormItem>
              )}
            />

            <FormField
              control={passwordForm.control}
              name="confirm_password"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Confirm new password</FormLabel>
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

            <div className="flex justify-end">
              <Button
                type="submit"
                disabled={passwordForm.formState.isSubmitting}
              >
                {passwordForm.formState.isSubmitting ? 'Changing...' : 'Change password'}
              </Button>
            </div>
          </TracedForm>
        </Form>
      </section>

    </div>
  );
}

function PasswordRules({
  value,
  showErrors,
}: {
  value: string;
  showErrors: boolean;
}) {
  return (
    <ul className="space-y-0.5 text-xs">
      {PASSWORD_RULES.map((rule) => {
        const passes = rule.test(value);
        const isError = showErrors && !passes;
        return (
          <li
            key={rule.label}
            className={isError ? 'text-destructive' : 'text-muted-foreground'}
          >
            {rule.label}
          </li>
        );
      })}
    </ul>
  );
}
