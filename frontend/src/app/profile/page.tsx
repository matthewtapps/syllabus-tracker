import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { getCurrentUser, updateUserProfile, updatePassword } from '@/lib/api';
import type { User } from '@/lib/api';
import { TracedForm } from '@/components/traced-form';

export default function ProfilePage() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [displayName, setDisplayName] = useState('');
  const [updating, setUpdating] = useState(false);

  // Password change state
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [changingPassword, setChangingPassword] = useState(false);

  useEffect(() => {
    async function loadUser() {
      try {
        setLoading(true);
        const userData = await getCurrentUser();
        setUser(userData);
        setDisplayName(userData?.display_name || '');
      } catch (err) {
        console.error('Failed to load user profile', err);
        toast.error('Failed to load profile');
      } finally {
        setLoading(false);
      }
    }

    loadUser();
  }, []);

  const handleUpdateProfile = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!user) return;

    try {
      setUpdating(true);
      await updateUserProfile({ display_name: displayName });
      toast.success('Profile updated successfully');

      // Update the user state with the new display name
      setUser({
        ...user,
        display_name: displayName
      });
    } catch (err) {
      console.error('Failed to update profile', err);
      toast.error('Failed to update profile');
    } finally {
      setUpdating(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();

    if (newPassword !== confirmPassword) {
      toast.error('Passwords do not match');
      return;
    }

    try {
      setChangingPassword(true);
      await updatePassword({
        current_password: currentPassword,
        new_password: newPassword
      });

      toast.success('Password changed successfully');

      // Clear password fields
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err) {
      console.error('Failed to change password', err);
      toast.error('Failed to change password');
    } finally {
      setChangingPassword(false);
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
          <TracedForm id="update_profile" onSubmit={handleUpdateProfile}>
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
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="Enter your display name"
                />
                <p className="text-sm text-muted-foreground">This is how your name will appear to others</p>
              </div>
            </CardContent>
            <CardFooter>
              <Button type="submit" disabled={updating} className='my-4'>
                {updating ? 'Updating...' : 'Update Profile'}
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
          <TracedForm id="change_password" onSubmit={handleChangePassword}>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="current-password">Current Password</Label>
                <Input
                  id="current-password"
                  type="password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="new-password">New Password</Label>
                <Input
                  id="new-password"
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="confirm-password">Confirm New Password</Label>
                <Input
                  id="confirm-password"
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                />
              </div>
            </CardContent>
            <CardFooter>
              <Button
                type="submit"
                disabled={changingPassword}
                className='my-4'
              >
                {changingPassword ? 'Changing Password...' : 'Change Password'}
              </Button>
            </CardFooter>
          </TracedForm>
        </Card>
      </div>
    </div>
  );
}
