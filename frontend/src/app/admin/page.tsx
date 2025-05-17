import { useState, useEffect } from 'react';
import { getStudents, updateUser, type User } from '@/lib/api';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { MoreHorizontalIcon, EditIcon, KeyIcon } from 'lucide-react';
import { TracedForm } from '@/components/traced-form';

interface AdminUser extends User {
  archived: boolean;
}

export default function AdminPage() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [isPasswordDialogOpen, setIsPasswordDialogOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState<AdminUser | null>(null);

  // Edit form state
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    loadUsers();
  }, []);

  async function loadUsers() {
    try {
      setLoading(true);
      const data = await getStudents(undefined, true);
      setUsers(data);
      setError(null);
    } catch (err) {
      console.error('Failed to load users', err);
      setError('Failed to load users. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  const filteredUsers = users.filter(user => {
    const matchesText = (
      (user.display_name?.toLowerCase() || user.username.toLowerCase()).includes(filter.toLowerCase()) ||
      user.role.toLowerCase().includes(filter.toLowerCase())
    );

    const matchesArchive = showArchived || !user.archived;

    return matchesText && matchesArchive;
  });

  const handleToggleArchive = async (user: AdminUser) => {
    try {
      await updateUser(user.id, { archived: !user.archived });

      setUsers(prevUsers =>
        prevUsers.map(u =>
          u.id === user.id ? { ...u, archived: !user.archived } : u
        )
      );

      toast.success(`User ${user.archived ? 'unarchived' : 'archived'} successfully`);
    } catch (err) {
      console.error('Failed to toggle archive status', err);
      toast.error('Failed to update user');
    }
  };

  const openEditDialog = (user: AdminUser) => {
    setSelectedUser(user);
    setUsername(user.username);
    setDisplayName(user.display_name);
    setIsEditDialogOpen(true);
  };

  const openPasswordDialog = (user: AdminUser) => {
    setSelectedUser(user);
    setNewPassword('');
    setConfirmPassword('');
    setIsPasswordDialogOpen(true);
  };

  const handleEditUser = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!selectedUser) return;

    try {
      setIsSubmitting(true);
      await updateUser(selectedUser.id, {
        username,
        display_name: displayName,
      });

      setUsers(prevUsers =>
        prevUsers.map(u =>
          u.id === selectedUser.id
            ? { ...u, username, display_name: displayName }
            : u
        )
      );

      toast.success('User updated successfully');
      setIsEditDialogOpen(false);
    } catch (err) {
      console.error('Failed to update user', err);
      toast.error('Failed to update user');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!selectedUser) return;

    if (newPassword !== confirmPassword) {
      toast.error('Passwords do not match');
      return;
    }

    try {
      setIsSubmitting(true);
      await updateUser(selectedUser.id, {
        password: newPassword,
      });

      toast.success('Password changed successfully');
      setIsPasswordDialogOpen(false);
    } catch (err) {
      console.error('Failed to change password', err);
      toast.error('Failed to change password');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (loading) {
    return <div className="flex items-center justify-center min-h-[50vh]">Loading...</div>;
  }

  if (error) {
    return <div className="flex items-center justify-center min-h-[50vh] text-red-500">{error}</div>;
  }

  return (
    <div className="container mx-auto py-6 px-4 sm:px-6 md:py-8">
      <h1 className="text-3xl font-bold mb-6">Admin Dashboard</h1>

      <div className="flex flex-col sm:flex-row justify-between gap-4 mb-6">
        <Input
          placeholder="Filter users..."
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="max-w-md"
        />

        <div className="flex items-center space-x-2">
          <Checkbox
            id="show-archived"
            checked={showArchived}
            onCheckedChange={(checked) => setShowArchived(checked === true)}
          />
          <Label htmlFor="show-archived">Show archived users</Label>
        </div>
      </div>

      <div className="border rounded-lg overflow-hidden">
        {filteredUsers.length > 0 ? (
          <div>
            {/* Table Header */}
            <div className="bg-muted/50 grid grid-cols-10 gap-2 px-4 py-3 font-medium text-sm">
              <div className="col-span-4">User</div>
              <div className="col-span-3">Role</div>
              <div className="col-span-2">Status</div>
              <div className="col-span-1 text-right">Actions</div>
            </div>

            {/* Table Body */}
            <div className="divide-y">
              {filteredUsers.map(user => (
                <div
                  key={user.id}
                  className={`grid grid-cols-10 gap-2 px-4 py-4 items-center ${user.archived ? 'text-muted-foreground' : ''}`}
                >
                  <div className="col-span-4">
                    <div className="font-medium">{user.username}</div>
                    {user.display_name && <div className="text-sm text-muted-foreground">{user.display_name}</div>}
                  </div>
                  <div className="col-span-3">
                    <span className="capitalize">{user.role}</span>
                  </div>
                  <div className="col-span-2">
                    {user.archived ? (
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-destructive/10 text-destructive">
                        Archived
                      </span>
                    ) : (
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-400">
                        Active
                      </span>
                    )}
                  </div>
                  <div className="col-span-1 text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon">
                          <MoreHorizontalIcon className="h-5 w-5" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => openEditDialog(user)}>
                          <EditIcon className="mr-2 h-4 w-4" />
                          Edit User
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => openPasswordDialog(user)}>
                          <KeyIcon className="mr-2 h-4 w-4" />
                          Change Password
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => handleToggleArchive(user)}>
                          {user.archived ? "Unarchive User" : "Archive User"}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="text-center text-muted-foreground p-8">No users found</div>
        )}
      </div>

      {/* Dialogs remain the same */}
      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit User</DialogTitle>
            <DialogDescription>
              Update user information
            </DialogDescription>
          </DialogHeader>

          <TracedForm id="edit_user" onSubmit={handleEditUser} className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="edit-username">Username</Label>
              <Input
                id="edit-username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="edit-display-name">Display Name</Label>
              <Input
                id="edit-display-name"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Enter display name"
              />
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setIsEditDialogOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? 'Saving...' : 'Save Changes'}
              </Button>
            </DialogFooter>
          </TracedForm>
        </DialogContent>
      </Dialog>

      <Dialog open={isPasswordDialogOpen} onOpenChange={setIsPasswordDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Change Password</DialogTitle>
            <DialogDescription>
              Set a new password for {selectedUser?.username}
            </DialogDescription>
          </DialogHeader>

          <TracedForm id="change_password" onSubmit={handleChangePassword} className="space-y-4 py-4">
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
              <Label htmlFor="confirm-password">Confirm Password</Label>
              <Input
                id="confirm-password"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
              />
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setIsPasswordDialogOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? 'Changing...' : 'Change Password'}
              </Button>
            </DialogFooter>
          </TracedForm>
        </DialogContent>
      </Dialog>
    </div>
  );
}
