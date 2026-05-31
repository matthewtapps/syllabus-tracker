import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { PageHeader } from '@/components/page-header';
import { EmptyState } from '@/components/empty-state';
import { SkeletonTableRow } from '@/components/skeleton-row';
import { GraduateConfirmDialog } from '@/components/graduate-confirm-dialog';
import { ClaimLinkPanel } from '@/components/claim-link-panel';
import { TracedForm } from '@/components/traced-form';
import { useFormWithValidation } from '@/components/hooks/useFormErrors';
import { type InviteResponse, type User } from '@/lib/api';
import { useAllUsers } from '@/lib/queries';
import {
  useResetUserClaim,
  useSetStudentGraduated,
  useToggleUserArchived,
  useUpdateUser,
} from '@/lib/mutations';
import {
  Archive,
  Copy,
  EditIcon,
  GraduationCap,
  KeyIcon,
  KeyRound,
  MoreHorizontalIcon,
  Users,
  X,
} from 'lucide-react';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { cn } from '@/lib/utils';

const editSchema = z.object({
  username: z.string().min(1, 'Username is required'),
  display_name: z.string(),
  role: z.enum(['student', 'coach', 'admin']),
});

const passwordSchema = z
  .object({
    new_password: z.string().min(1, 'New password is required'),
    confirm_password: z.string().min(1, 'Please confirm the password'),
  })
  .refine((data) => data.new_password === data.confirm_password, {
    path: ['confirm_password'],
    message: 'Passwords do not match',
  });

type EditValues = z.infer<typeof editSchema>;
type PasswordValues = z.infer<typeof passwordSchema>;

type StatusTab = 'active' | 'graduated' | 'archived' | 'all';

const STATUS_TABS: { value: StatusTab; label: string }[] = [
  { value: 'active', label: 'Active' },
  { value: 'graduated', label: 'Graduated' },
  { value: 'archived', label: 'Archived' },
  { value: 'all', label: 'All' },
];

const STATUS_TAB_VALUES = new Set<StatusTab>([
  'active',
  'graduated',
  'archived',
  'all',
]);

function isStatusTab(value: string | null): value is StatusTab {
  return value !== null && STATUS_TAB_VALUES.has(value as StatusTab);
}

const ROLE_FILTER_VALUES = new Set(['all', 'student', 'coach', 'admin']);

function initials(user: Pick<User, 'display_name' | 'username'>): string {
  const source = user.display_name?.trim() || user.username || '';
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function UserStatusBadges({ user }: { user: User }) {
  return (
    <>
      {user.graduated_at && (
        <Badge
          variant="outline"
          className="shrink-0 gap-1 border-status-green/40 text-status-green"
        >
          <GraduationCap className="h-3 w-3" aria-hidden />
          Graduated
        </Badge>
      )}
      {user.archived && (
        <Badge variant="outline" className="shrink-0 gap-1 text-muted-foreground">
          <Archive className="h-3 w-3" aria-hidden />
          Archived
        </Badge>
      )}
    </>
  );
}

export default function AdminPage() {
  const usersQuery = useAllUsers();
  const users = usersQuery.data ?? [];
  const loading = usersQuery.isLoading;
  const error = usersQuery.error ? 'Failed to load users. Please try again.' : null;
  const updateUserMutation = useUpdateUser();
  const toggleArchive = useToggleUserArchived();
  const resetClaimMutation = useResetUserClaim();
  const graduateMutation = useSetStudentGraduated();
  const [searchParams, setSearchParams] = useSearchParams();
  const filter = searchParams.get('q') ?? '';
  function setFilter(next: string) {
    setSearchParams((prev) => {
      const params = new URLSearchParams(prev);
      if (!next) params.delete('q');
      else params.set('q', next);
      return params;
    }, { replace: true });
  }
  const tabParam = searchParams.get('tab');
  const statusTab: StatusTab = isStatusTab(tabParam) ? tabParam : 'active';
  function setStatusTab(next: StatusTab) {
    setSearchParams((prev) => {
      const params = new URLSearchParams(prev);
      if (next === 'active') params.delete('tab');
      else params.set('tab', next);
      return params;
    }, { replace: true });
  }
  const roleParam = searchParams.get('role');
  const roleFilter =
    roleParam && ROLE_FILTER_VALUES.has(roleParam) ? roleParam : 'all';
  function setRoleFilter(next: string) {
    setSearchParams((prev) => {
      const params = new URLSearchParams(prev);
      if (next === 'all') params.delete('role');
      else params.set('role', next);
      return params;
    }, { replace: true });
  }
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [isPasswordDialogOpen, setIsPasswordDialogOpen] = useState(false);
  const [graduateTarget, setGraduateTarget] = useState<User | null>(null);
  const [resetTarget, setResetTarget] = useState<User | null>(null);
  const [issuedClaimUrl, setIssuedClaimUrl] = useState<string | null>(null);

  const editForm = useFormWithValidation<EditValues>({
    resolver: zodResolver(editSchema),
    defaultValues: { username: '', display_name: '', role: 'student' },
  });

  const passwordForm = useFormWithValidation<PasswordValues>({
    resolver: zodResolver(passwordSchema),
    defaultValues: { new_password: '', confirm_password: '' },
  });

  const filtered = users.filter((u) => {
    const needle = filter.trim().toLowerCase();
    const matchesText =
      !needle ||
      (u.display_name?.toLowerCase() || '').includes(needle) ||
      u.username.toLowerCase().includes(needle) ||
      u.role.toLowerCase().includes(needle);
    let matchesStatus = true;
    if (statusTab === 'active') {
      matchesStatus = !u.archived && !u.graduated_at;
    } else if (statusTab === 'graduated') {
      matchesStatus = !!u.graduated_at;
    } else if (statusTab === 'archived') {
      matchesStatus = !!u.archived;
    }
    const matchesRole =
      roleFilter === 'all' || u.role.toLowerCase() === roleFilter.toLowerCase();
    return matchesText && matchesStatus && matchesRole;
  });

  function openEditDialog(u: User) {
    setSelectedUser(u);
    editForm.reset({
      username: u.username,
      display_name: u.display_name ?? '',
      role: (u.role.toLowerCase() as EditValues['role']) ?? 'student',
    });
    setIsEditDialogOpen(true);
  }

  function openPasswordDialog(u: User) {
    setSelectedUser(u);
    passwordForm.reset({ new_password: '', confirm_password: '' });
    setIsPasswordDialogOpen(true);
  }

  function handleToggleArchive(u: User) {
    toggleArchive.mutate(
      { userId: u.id, archived: !u.archived },
      {
        onSuccess: () =>
          toast.success(u.archived ? 'User unarchived' : 'User archived'),
        onError: () => toast.error('Failed to update user'),
      },
    );
  }

  async function handleIssueClaim(u: User) {
    try {
      const response = await resetClaimMutation.mutateAsync(u.id);
      const invite: InviteResponse = await response.json();
      const url = `${window.location.origin}${invite.claim_path}`;
      setIssuedClaimUrl(url);
    } catch (err) {
      console.error(err);
      toast.error('Failed to create link');
    }
  }

  function handleToggleGraduated(u: User) {
    const wasGraduated = !!u.graduated_at;
    graduateMutation.mutate(
      { id: u.id, graduated: !wasGraduated },
      {
        onSuccess: () =>
          toast.success(wasGraduated ? 'Un-graduated' : 'Graduated 🎓'),
        onError: () => toast.error('Failed to update user'),
      },
    );
  }

  async function handleEditUser(data: EditValues) {
    if (!selectedUser) return;
    await updateUserMutation.mutateAsync({
      userId: selectedUser.id,
      data: {
        username: data.username,
        display_name: data.display_name,
        role: data.role,
      },
    });
    toast.success('User updated');
    setIsEditDialogOpen(false);
  }

  async function handleChangePassword(data: PasswordValues) {
    if (!selectedUser) return;
    await updateUserMutation.mutateAsync({
      userId: selectedUser.id,
      data: { password: data.new_password },
    });
    toast.success('Password changed');
    setIsPasswordDialogOpen(false);
  }

  return (
    <div className="container mx-auto px-4 py-6 sm:px-6 md:py-8">
      <PageHeader title="Admin" subtitle="Manage user accounts and roles." />

      <div className="mb-6 space-y-3">
        <Tabs value={statusTab} onValueChange={(v) => setStatusTab(v as StatusTab)}>
          <TabsList className="w-full sm:w-auto">
            {STATUS_TABS.map(({ value, label }) => (
              <TabsTrigger
                key={value}
                value={value}
                className="flex-1 px-2 sm:flex-initial sm:px-3"
              >
                {label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative w-full sm:max-w-md">
            <Input
              placeholder="Filter users..."
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              aria-label="Filter users"
            />
            {filter && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="absolute right-1 top-1/2 h-7 w-7 -translate-y-1/2"
                onClick={() => setFilter('')}
              >
                <X className="h-4 w-4" aria-hidden />
                <span className="sr-only">Clear filter</span>
              </Button>
            )}
          </div>

          <Select value={roleFilter} onValueChange={setRoleFilter}>
            <SelectTrigger className="w-full sm:w-[150px]">
              <SelectValue placeholder="Filter by role" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All roles</SelectItem>
              <SelectItem value="student">Students</SelectItem>
              <SelectItem value="coach">Coaches</SelectItem>
              <SelectItem value="admin">Admins</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border border-border bg-card">
        {loading ? (
          <div className="divide-y divide-border">
            {Array.from({ length: 6 }).map((_, i) => (
              <SkeletonTableRow key={i} columns={3} />
            ))}
          </div>
        ) : error ? (
          <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
            <p className="text-sm text-destructive">{error}</p>
            <Button variant="outline" onClick={() => usersQuery.refetch()}>
              Try again
            </Button>
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={Users}
            title="No matching users"
            description={
              filter || roleFilter !== 'all' || statusTab !== 'all'
                ? 'Try a different filter combination.'
                : 'No users exist yet.'
            }
          />
        ) : (
          <>
            {/* Mobile: card-list */}
            <div className="divide-y divide-border sm:hidden">
              {filtered.map((u) => (
                <div
                  key={u.id}
                  className={cn(
                    'flex items-start gap-3 px-4 py-3',
                    u.archived && 'text-muted-foreground',
                  )}
                >
                  <Avatar size="default">
                    <AvatarFallback>{initials(u)}</AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-medium">
                        {u.username || u.display_name || 'Pending user'}
                      </span>
                      <UserStatusBadges user={u} />
                    </div>
                    {u.display_name && (
                      <p className="truncate text-xs text-muted-foreground">
                        {u.display_name}
                      </p>
                    )}
                    <p className="text-xs capitalize text-muted-foreground">
                      {u.role}
                    </p>
                  </div>
                  <UserActionsMenu
                    user={u}
                    onEdit={() => openEditDialog(u)}
                    onPassword={() => openPasswordDialog(u)}
                    onToggleArchive={() => handleToggleArchive(u)}
                    onToggleGraduated={() => setGraduateTarget(u)}
                    onIssueClaim={() => handleIssueClaim(u)}
                    onResetPassword={() => setResetTarget(u)}
                  />
                </div>
              ))}
            </div>

            {/* Desktop: table */}
            <div className="hidden sm:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>User</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((u) => (
                    <TableRow
                      key={u.id}
                      className={cn(u.archived && 'text-muted-foreground')}
                    >
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <Avatar size="sm">
                            <AvatarFallback>{initials(u)}</AvatarFallback>
                          </Avatar>
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="font-medium">
                                {u.username || u.display_name || 'Pending user'}
                              </span>
                              <UserStatusBadges user={u} />
                            </div>
                            {u.display_name && u.username && (
                              <div className="text-xs text-muted-foreground">
                                {u.display_name}
                              </div>
                            )}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="capitalize">{u.role}</TableCell>
                      <TableCell className="text-right">
                        <UserActionsMenu
                          user={u}
                          onEdit={() => openEditDialog(u)}
                          onPassword={() => openPasswordDialog(u)}
                          onToggleArchive={() => handleToggleArchive(u)}
                          onToggleGraduated={() => setGraduateTarget(u)}
                          onIssueClaim={() => handleIssueClaim(u)}
                          onResetPassword={() => setResetTarget(u)}
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </>
        )}
      </div>

      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent className="w-[calc(100vw-1rem)] max-w-md p-4 sm:p-6">
          <DialogHeader>
            <DialogTitle>Edit user</DialogTitle>
            <DialogDescription>Update account information.</DialogDescription>
          </DialogHeader>

          <Form {...editForm}>
            <TracedForm
              id="edit_user"
              onSubmit={editForm.handleSubmit(handleEditUser)}
              setFieldErrors={editForm.setFieldErrors}
              className="space-y-4"
            >
              <FormField
                control={editForm.control}
                name="role"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Role</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="student">Student</SelectItem>
                        <SelectItem value="coach">Coach</SelectItem>
                        <SelectItem value="admin">Admin</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={editForm.control}
                name="username"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Username</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={editForm.control}
                name="display_name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Display name</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="Enter display name" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <DialogFooter className="gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setIsEditDialogOpen(false)}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={editForm.formState.isSubmitting}>
                  {editForm.formState.isSubmitting ? 'Saving...' : 'Save changes'}
                </Button>
              </DialogFooter>
            </TracedForm>
          </Form>
        </DialogContent>
      </Dialog>

      <Dialog open={isPasswordDialogOpen} onOpenChange={setIsPasswordDialogOpen}>
        <DialogContent className="w-[calc(100vw-1rem)] max-w-md p-4 sm:p-6">
          <DialogHeader>
            <DialogTitle>Change password</DialogTitle>
            <DialogDescription>
              Set a new password for {selectedUser?.username}.
            </DialogDescription>
          </DialogHeader>

          <Form {...passwordForm}>
            <TracedForm
              id="change_password_admin"
              onSubmit={passwordForm.handleSubmit(handleChangePassword)}
              setFieldErrors={passwordForm.setFieldErrors}
              className="space-y-4"
            >
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
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={passwordForm.control}
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

              <DialogFooter className="gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setIsPasswordDialogOpen(false)}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={passwordForm.formState.isSubmitting}
                >
                  {passwordForm.formState.isSubmitting ? 'Changing...' : 'Change password'}
                </Button>
              </DialogFooter>
            </TracedForm>
          </Form>
        </DialogContent>
      </Dialog>

      <GraduateConfirmDialog
        open={!!graduateTarget}
        onOpenChange={(open) => !open && setGraduateTarget(null)}
        mode={graduateTarget?.graduated_at ? 'ungraduate' : 'graduate'}
        studentName={
          graduateTarget?.display_name || graduateTarget?.username || ''
        }
        onConfirm={() => {
          if (graduateTarget) {
            const u = graduateTarget;
            setGraduateTarget(null);
            handleToggleGraduated(u);
          }
        }}
      />

      <AlertDialog
        open={!!resetTarget}
        onOpenChange={(open) => !open && setResetTarget(null)}
      >
        <AlertDialogContent className="w-[calc(100vw-1rem)] max-w-sm p-4 sm:p-6">
          <AlertDialogHeader>
            <AlertDialogTitle>
              Reset {resetTarget?.display_name || resetTarget?.username}'s password?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This signs them out and clears their current password. You'll get a
              link to share so they can pick a new password.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (resetTarget) {
                  const u = resetTarget;
                  setResetTarget(null);
                  handleIssueClaim(u);
                }
              }}
            >
              Reset password
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog
        open={!!issuedClaimUrl}
        onOpenChange={(next) => {
          if (!next) setIssuedClaimUrl(null);
        }}
      >
        <DialogContent className="w-[calc(100vw-1rem)] max-w-md p-4 sm:p-6">
          <DialogHeader>
            <DialogTitle>Sign-in link ready</DialogTitle>
            <DialogDescription>
              Show this QR code to the user or send them the link. They'll pick
              a username and password. Valid for 7 days.
            </DialogDescription>
          </DialogHeader>
          {issuedClaimUrl && <ClaimLinkPanel url={issuedClaimUrl} />}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setIssuedClaimUrl(null)}
            >
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

interface UserActionsMenuProps {
  user: User;
  onEdit: () => void;
  onPassword: () => void;
  onToggleArchive: () => void;
  onToggleGraduated: () => void;
  onIssueClaim: () => void;
  onResetPassword: () => void;
}

function UserActionsMenu({
  user,
  onEdit,
  onPassword,
  onToggleArchive,
  onToggleGraduated,
  onIssueClaim,
  onResetPassword,
}: UserActionsMenuProps) {
  const isStudent = user.role.toLowerCase() === 'student';
  const isGraduated = !!user.graduated_at;
  const isClaimed = !!user.claimed_at;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon">
          <MoreHorizontalIcon className="h-5 w-5" aria-hidden />
          <span className="sr-only">Actions for {user.username || user.display_name}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={() => setTimeout(onEdit, 0)}>
          <EditIcon className="mr-2 h-4 w-4" aria-hidden />
          Edit user
        </DropdownMenuItem>
        {isClaimed && (
          <DropdownMenuItem onSelect={() => setTimeout(onPassword, 0)}>
            <KeyIcon className="mr-2 h-4 w-4" aria-hidden />
            Change password
          </DropdownMenuItem>
        )}
        {isClaimed ? (
          <DropdownMenuItem onSelect={() => setTimeout(onResetPassword, 0)}>
            <KeyRound className="mr-2 h-4 w-4" aria-hidden />
            Reset password
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem onSelect={() => setTimeout(onIssueClaim, 0)}>
            <Copy className="mr-2 h-4 w-4" aria-hidden />
            Copy invite link
          </DropdownMenuItem>
        )}
        {isStudent && (
          <DropdownMenuItem onSelect={() => setTimeout(onToggleGraduated, 0)}>
            <GraduationCap className="mr-2 h-4 w-4" aria-hidden />
            {isGraduated ? 'Un-graduate' : 'Graduate'}
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => setTimeout(onToggleArchive, 0)}>
          {user.archived ? 'Unarchive user' : 'Archive user'}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
