import { useState, useEffect } from 'react';
import { getAllUsers, updateUser, type User } from '@/lib/api';
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
import { Select, SelectContent, SelectItem, SelectValue } from '@/components/ui/select';
import { SelectTrigger } from '@radix-ui/react-select';
import { useFormWithValidation } from '@/components/hooks/useFormErrors';

interface AdminUser extends User {
  archived: boolean;
}

interface EditUserFormValues {
  username: string;
  display_name: string;
  role: string;
}

interface PasswordFormValues {
  new_password: string;
  confirm_password: string;
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
  const [roleFilter, setRoleFilter] = useState<string>("all");

  const editForm = useFormWithValidation<EditUserFormValues>({
    defaultValues: {
      username: '',
      display_name: '',
      role: ''
    }
  });

  const passwordForm = useFormWithValidation<PasswordFormValues>({
    defaultValues: {
      new_password: '',
      confirm_password: ''
    }
  });

  useEffect(() => {
    loadUsers();
  }, []);

  async function loadUsers() {
    try {
      setLoading(true);
      const data = await getAllUsers();
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

    // Add role filtering
    const matchesRole = roleFilter === "all" ||
      user.role.toLowerCase() === roleFilter.toLowerCase();

    return matchesText && matchesArchive && matchesRole;
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
    editForm.reset({
      username: user.username,
      display_name: user.display_name,
      role: user.role.toLowerCase()
    });
    setIsEditDialogOpen(true);
  };

  const openPasswordDialog = (user: AdminUser) => {
    setSelectedUser(user);
    passwordForm.reset({
      new_password: '',
      confirm_password: ''
    });
    setIsPasswordDialogOpen(true);
  };

  const handleEditUser = async (data: EditUserFormValues) => {
    if (!selectedUser) return;

    const response = await updateUser(selectedUser.id, {
      username: data.username,
      display_name: data.display_name,
      role: data.role,
    });

    if (!response.ok) {
      throw response;
    }

    setUsers(prevUsers =>
      prevUsers.map(u =>
        u.id === selectedUser.id
          ? {
            ...u,
            username: data.username,
            display_name: data.display_name,
            role: data.role
          }
          : u
      )
    );

    toast.success('User updated successfully');
    setIsEditDialogOpen(false);
  };

  const handleChangePassword = async (data: PasswordFormValues) => {
    if (!selectedUser) return;

    if (data.new_password !== data.confirm_password) {
      passwordForm.setError('confirm_password', {
        type: 'manual',
        message: 'Passwords do not match'
      });
      return;
    }

    const response = await updateUser(selectedUser.id, {
      password: data.new_password,
    });

    if (!response.ok) {
      throw response;
    }

    toast.success('Password changed successfully');
    setIsPasswordDialogOpen(false);
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

        <div className="flex gap-4 items-center">
          <Select value={roleFilter} onValueChange={setRoleFilter}>
            <SelectTrigger className="w-[150px]">
              <SelectValue placeholder="Filter by role" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All roles</SelectItem>
              <SelectItem value="student">Students</SelectItem>
              <SelectItem value="coach">Coaches</SelectItem>
              <SelectItem value="admin">Admins</SelectItem>
            </SelectContent>
          </Select>

          <div className="flex items-center space-x-2">
            <Checkbox
              id="show-archived"
              checked={showArchived}
              onCheckedChange={(checked) => setShowArchived(checked === true)}
            />
            <Label htmlFor="show-archived">Show archived users</Label>
          </div>
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

      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit User</DialogTitle>
            <DialogDescription>
              Update user information
            </DialogDescription>
          </DialogHeader>

          <TracedForm
            id="edit_user"
            onSubmit={editForm.handleSubmit(handleEditUser)}
            setFieldErrors={editForm.setFieldErrors}
            className="space-y-4 py-4"
          >
            <div className="space-y-2">
              <Label htmlFor="edit-role">Role</Label>
              <Select
                value={editForm.watch("role")}
                onValueChange={(value) => editForm.setValue("role", value)}
              >
                <SelectTrigger id="edit-role">
                  <SelectValue placeholder="Select a role" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="student">Student</SelectItem>
                  <SelectItem value="coach">Coach</SelectItem>
                  <SelectItem value="admin">Admin</SelectItem>
                </SelectContent>
              </Select>
              {editForm.formState.errors.role && (
                <p className="text-sm text-destructive mt-1">
                  {String(editForm.formState.errors.role.message || "Invalid role")}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="edit-username">Username</Label>
              <Input
                id="edit-username"
                {...editForm.register("username")}
                required
                aria-invalid={!!editForm.formState.errors.username}
              />
              {editForm.formState.errors.username && (
                <p className="text-sm text-destructive mt-1">
                  {String(editForm.formState.errors.username.message || "Invalid username")}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="edit-display-name">Display Name</Label>
              <Input
                id="edit-display-name"
                {...editForm.register("display_name")}
                placeholder="Enter display name"
                aria-invalid={!!editForm.formState.errors.display_name}
              />
              {editForm.formState.errors.display_name && (
                <p className="text-sm text-destructive mt-1">
                  {String(editForm.formState.errors.display_name.message || "Invalid display name")}
                </p>
              )}
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setIsEditDialogOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={editForm.formState.isSubmitting}>
                {editForm.formState.isSubmitting ? 'Saving...' : 'Save Changes'}
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

          <TracedForm
            id="change_password"
            onSubmit={passwordForm.handleSubmit(handleChangePassword)}
            setFieldErrors={passwordForm.setFieldErrors}
            className="space-y-4 py-4"
          >
            <div className="space-y-2">
              <Label htmlFor="new-password">New Password</Label>
              <Input
                id="new-password"
                type="password"
                {...passwordForm.register("new_password")}
                required
                aria-invalid={!!passwordForm.formState.errors.new_password}
              />
              {passwordForm.formState.errors.new_password && (
                <p className="text-sm text-destructive mt-1">
                  {String(passwordForm.formState.errors.new_password.message || "New password is required")}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="confirm-password">Confirm Password</Label>
              <Input
                id="confirm-password"
                type="password"
                {...passwordForm.register("confirm_password")}
                required
                aria-invalid={!!passwordForm.formState.errors.confirm_password}
              />
              {passwordForm.formState.errors.confirm_password && (
                <p className="text-sm text-destructive mt-1">
                  {String(passwordForm.formState.errors.confirm_password.message || "Passwords must match")}
                </p>
              )}
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setIsPasswordDialogOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={passwordForm.formState.isSubmitting}>
                {passwordForm.formState.isSubmitting ? 'Changing...' : 'Change Password'}
              </Button>
            </DialogFooter>
          </TracedForm>
        </DialogContent>
      </Dialog>
    </div>
  );
}
