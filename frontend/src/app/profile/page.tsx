import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { getCurrentUser, updatePassword, updateUserProfile, type User } from '@/lib/api';
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
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { PageHeader } from '@/components/page-header';
import { TracedForm } from '@/components/traced-form';
import { useFormWithValidation } from '@/components/hooks/useFormErrors';

const profileSchema = z.object({
  display_name: z.string(),
});

const passwordSchema = z
  .object({
    current_password: z.string().min(1, 'Current password is required'),
    new_password: z.string().min(1, 'New password is required'),
    confirm_password: z.string().min(1, 'Please confirm the new password'),
  })
  .refine((data) => data.new_password === data.confirm_password, {
    path: ['confirm_password'],
    message: 'Passwords do not match',
  });

type ProfileValues = z.infer<typeof profileSchema>;
type PasswordValues = z.infer<typeof passwordSchema>;

export default function ProfilePage() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const profileForm = useFormWithValidation<ProfileValues>({
    resolver: zodResolver(profileSchema),
    defaultValues: { display_name: '' },
  });

  const passwordForm = useFormWithValidation<PasswordValues>({
    resolver: zodResolver(passwordSchema),
    defaultValues: {
      current_password: '',
      new_password: '',
      confirm_password: '',
    },
  });

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        setLoading(true);
        const data = await getCurrentUser();
        if (cancelled) return;
        setUser(data);
        profileForm.reset({ display_name: data?.display_name ?? '' });
      } catch (err) {
        console.error(err);
        toast.error('Failed to load profile');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleProfileSubmit(data: ProfileValues) {
    const response = await updateUserProfile(data);
    if (!response.ok) throw response;
    setUser((prev) => (prev ? { ...prev, display_name: data.display_name } : prev));
    toast.success('Profile updated');
  }

  async function handlePasswordSubmit(data: PasswordValues) {
    const response = await updatePassword({
      current_password: data.current_password,
      new_password: data.new_password,
    });
    if (!response.ok) throw response;
    toast.success('Password changed');
    passwordForm.reset();
  }

  return (
    <div className="container mx-auto max-w-2xl px-4 py-6 sm:px-6 md:py-8">
      <PageHeader title="My profile" />

      <section className="space-y-5">
        <div>
          <h2 className="text-base font-semibold">Account</h2>
          <p className="text-sm text-muted-foreground">
            Update how your name appears in the app.
          </p>
        </div>

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
              setFieldErrors={profileForm.setFieldErrors}
              className="space-y-4"
            >
              <div className="space-y-2">
                <Label htmlFor="username">Username</Label>
                <Input id="username" value={user?.username ?? ''} disabled />
                <p className="text-xs text-muted-foreground">
                  Your username can't be changed.
                </p>
              </div>

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
        <div>
          <h2 className="text-base font-semibold">Password</h2>
          <p className="text-sm text-muted-foreground">
            Update the password used to sign in.
          </p>
        </div>

        <Form {...passwordForm}>
          <TracedForm
            id="change_password"
            onSubmit={passwordForm.handleSubmit(handlePasswordSubmit)}
            setFieldErrors={passwordForm.setFieldErrors}
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
              render={({ field }) => (
                <FormItem>
                  <FormLabel>New password</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      type="password"
                      autoComplete="new-password"
                    />
                  </FormControl>
                  <FormDescription>
                    At least 1 character. Aim for something memorable but hard to guess.
                  </FormDescription>
                  <FormMessage />
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
