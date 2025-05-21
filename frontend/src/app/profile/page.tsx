import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { getCurrentUser, updateUserProfile, updatePassword } from '@/lib/api';
import type { User } from '@/lib/api';
import { TracedForm } from '@/components/traced-form';
import { useFormWithValidation } from '@/components/hooks/useFormErrors';

interface ProfileFormValues {
  display_name: string;
}

interface PasswordFormValues {
  current_password: string;
  new_password: string;
  confirm_password: string;
}

export default function ProfilePage() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadUser() {
      try {
        setLoading(true);
        const userData = await getCurrentUser();
        setUser(userData);
      } catch (err) {
        console.error('Failed to load user profile', err);
        toast.error('Failed to load profile');
      } finally {
        setLoading(false);
      }
    }

    loadUser();
  }, []);

  const profileForm = useFormWithValidation<ProfileFormValues>({
    defaultValues: {
      display_name: user?.display_name || '',
    }
  });

  const passwordForm = useFormWithValidation<PasswordFormValues>({
    defaultValues: {
      current_password: '',
      new_password: '',
      confirm_password: ''
    }
  });

  const handleUpdateProfile = async (data: ProfileFormValues) => {
    try {
      await updateUserProfile(data);
      toast.success('Profile updated successfully');

      // Update the user state
      if (user) {
        setUser({
          ...user,
          display_name: data.display_name
        });
      }
    } catch (err) {
      console.error('Failed to update profile', err);
    }
  };

  const handleChangePassword = async (data: PasswordFormValues) => {
    if (data.new_password !== data.confirm_password) {
      passwordForm.setError('confirm_password', {
        type: 'manual',
        message: 'Passwords do not match'
      });
      return;
    }

    try {
      await updatePassword({
        current_password: data.current_password,
        new_password: data.new_password
      });

      toast.success('Password changed successfully');

      passwordForm.reset({
        current_password: '',
        new_password: '',
        confirm_password: ''
      });
    } catch (err) {
      console.error('Failed to change password', err);
    }
  };

  if (loading) {
    return (
      <div className="container mx-auto py-8 px-4">
        <div className="flex items-center justify-center min-h-[50vh]">
          Loading...
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto py-8 px-4">
      <h1 className="text-3xl font-bold mb-8">My Profile</h1>

      <div className="grid gap-8 md:grid-cols-2">
        {/* Profile Information Card */}
        <Card>
          <CardHeader>
            <CardTitle>Profile Information</CardTitle>
            <CardDescription>Update your display name and account details</CardDescription>
          </CardHeader>
          <TracedForm id="update_profile" onSubmit={profileForm.handleSubmit(handleUpdateProfile)} setFieldErrors={profileForm.setFieldErrors}>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="username">Username</Label>
                <Input
                  id="username"
                  value={user?.username || ''}
                  disabled
                  className="bg-muted/50"
                />
                <p className="text-sm text-muted-foreground">Your username cannot be changed</p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="display-name">Display Name</Label>
                <Input
                  id="display-name"
                  {...profileForm.register("display_name")}
                  placeholder="Enter your display name"
                  aria-invalid={!!profileForm.formState.errors.display_name}
                />
                {profileForm.formState.errors.display_name && (
                  <p className="text-sm text-destructive mt-1">
                    {String(profileForm.formState.errors.display_name.message || "Invalid display name")}
                  </p>
                )}
              </div>
            </CardContent>
            <CardFooter>
              <Button type="submit" disabled={profileForm.formState.isSubmitting} className='my-4'>
                {profileForm.formState.isSubmitting ? 'Updating...' : 'Update Profile'}
              </Button>
            </CardFooter>
          </TracedForm>
        </Card>

        {/* Change Password Card */}
        <Card>
          <CardHeader>
            <CardTitle>Change Password</CardTitle>
            <CardDescription>Update your account password</CardDescription>
          </CardHeader>
          <TracedForm id="change_password" onSubmit={passwordForm.handleSubmit(handleChangePassword)} setFieldErrors={passwordForm.setFieldErrors}>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="current-password">Current Password</Label>
                <Input
                  id="current-password"
                  type="password"
                  {...passwordForm.register("current_password")}
                  aria-invalid={!!passwordForm.formState.errors.current_password}
                />
                {passwordForm.formState.errors.current_password && (
                  <p className="text-sm text-destructive mt-1">
                    {String(passwordForm.formState.errors.current_password.message || "Current password is required")}
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="new-password">New Password</Label>
                <Input
                  id="new-password"
                  type="password"
                  {...passwordForm.register("new_password")}
                  aria-invalid={!!passwordForm.formState.errors.new_password}
                />
                {passwordForm.formState.errors.new_password && (
                  <p className="text-sm text-destructive mt-1">
                    {String(passwordForm.formState.errors.new_password.message || "New password is required")}
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="confirm-password">Confirm New Password</Label>
                <Input
                  id="confirm-password"
                  type="password"
                  {...passwordForm.register("confirm_password")}
                  aria-invalid={!!passwordForm.formState.errors.confirm_password}
                />
                {passwordForm.formState.errors.confirm_password && (
                  <p className="text-sm text-destructive mt-1">
                    {String(passwordForm.formState.errors.confirm_password.message || "Passwords must match")}
                  </p>
                )}
              </div>
            </CardContent>
            <CardFooter>
              <Button
                type="submit"
                disabled={passwordForm.formState.isSubmitting}
                className='my-4'
              >
                {passwordForm.formState.isSubmitting ? 'Changing Password...' : 'Change Password'}
              </Button>
            </CardFooter>
          </TracedForm>
        </Card>
      </div>
    </div>
  );
}
