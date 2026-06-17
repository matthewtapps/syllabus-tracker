import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { Copy, KeyRound } from 'lucide-react';
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
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { TracedForm } from '@/components/traced-form';
import { handleApiFormError, useFormWithValidation } from '@/components/hooks/useFormErrors';
import { ClaimLinkPanel } from '@/components/claim-link-panel';
import { type InviteResponse, type User } from '@/lib/api';
import {
  useUpdateUserProfile,
  useUpdatePassword,
  useUpdateUser,
  useResetUserClaim,
} from '@/lib/mutations';

// ── Zod schemas ────────────────────────────────────────────────────────────────

const detailsSchema = z.object({
  display_name: z.string(),
  username: z
    .string()
    .min(1, 'Username is required')
    .max(50, 'Username is too long')
    .regex(/^\S+$/, 'No spaces in usernames'),
});

const selfPasswordSchema = z
  .object({
    current_password: z.string().min(1, 'Current password is required'),
    new_password: z.string().min(5, 'Password must be at least 5 characters long'),
    confirm_password: z.string().min(1, 'Please confirm the new password'),
  })
  .refine((d) => d.new_password === d.confirm_password, {
    path: ['confirm_password'],
    message: 'Passwords do not match',
  });

const adminPasswordSchema = z
  .object({
    new_password: z.string().min(5, 'Password must be at least 5 characters long'),
    confirm_password: z.string().min(1, 'Please confirm the password'),
  })
  .refine((d) => d.new_password === d.confirm_password, {
    path: ['confirm_password'],
    message: 'Passwords do not match',
  });

type DetailsValues = z.infer<typeof detailsSchema>;
type SelfPasswordValues = z.infer<typeof selfPasswordSchema>;
type AdminPasswordValues = z.infer<typeof adminPasswordSchema>;

// ── Props ──────────────────────────────────────────────────────────────────────

export interface AccountDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  user: User;
  mode: 'self' | 'admin';
}

// ── Component ──────────────────────────────────────────────────────────────────

export function AccountDialog({ open, onOpenChange, user, mode }: AccountDialogProps) {
  const title =
    mode === 'self' ? 'Account' : `Manage ${user.display_name || user.username}`;

  const [resetConfirmOpen, setResetConfirmOpen] = useState(false);
  const [issuedClaimUrl, setIssuedClaimUrl] = useState<string | null>(null);

  const updateProfileMutation = useUpdateUserProfile();
  const updatePasswordMutation = useUpdatePassword();
  const updateUserMutation = useUpdateUser();
  const resetClaimMutation = useResetUserClaim();

  // ── Details form (shared shape, different mutation) ──────────────────────────

  const detailsForm = useFormWithValidation<DetailsValues>({
    resolver: zodResolver(detailsSchema),
    defaultValues: { display_name: '', username: '' },
  });

  // Re-seed when the managed user changes, and whenever the dialog (re)opens so
  // a dismissed-without-saving edit never lingers on the next open.
  useEffect(() => {
    if (!open) return;
    detailsForm.reset({
      display_name: user.display_name ?? '',
      username: user.username ?? '',
    });
    selfPasswordForm.reset();
    adminPasswordForm.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, user.id]);

  async function handleDetailsSubmit(data: DetailsValues) {
    if (mode === 'self') {
      try {
        await updateProfileMutation.mutateAsync({
          display_name: data.display_name,
          username: data.username.trim(),
        });
        toast.success('Profile updated');
      } catch (err) {
        const handled = await handleApiFormError(
          err,
          detailsForm.setError,
          Object.keys(detailsForm.getValues()),
        );
        if (!handled) toast.error(err instanceof Error ? err.message : 'Failed to update profile');
      }
    } else {
      try {
        await updateUserMutation.mutateAsync({
          userId: user.id,
          data: { username: data.username.trim(), display_name: data.display_name },
        });
        toast.success('User updated');
      } catch (err) {
        const handled = await handleApiFormError(
          err,
          detailsForm.setError,
          Object.keys(detailsForm.getValues()),
        );
        if (!handled) toast.error(err instanceof Error ? err.message : 'Failed to update user');
      }
    }
  }

  // ── Self password form ───────────────────────────────────────────────────────

  const selfPasswordForm = useFormWithValidation<SelfPasswordValues>({
    resolver: zodResolver(selfPasswordSchema),
    defaultValues: { current_password: '', new_password: '', confirm_password: '' },
  });

  async function handleSelfPasswordSubmit(data: SelfPasswordValues) {
    try {
      await updatePasswordMutation.mutateAsync({
        current_password: data.current_password,
        new_password: data.new_password,
      });
      toast.success('Password changed');
      selfPasswordForm.reset();
    } catch (err) {
      const handled = await handleApiFormError(
        err,
        selfPasswordForm.setError,
        Object.keys(selfPasswordForm.getValues()),
      );
      if (!handled) toast.error(err instanceof Error ? err.message : 'Failed to change password');
    }
  }

  // ── Admin password form ──────────────────────────────────────────────────────

  const adminPasswordForm = useFormWithValidation<AdminPasswordValues>({
    resolver: zodResolver(adminPasswordSchema),
    defaultValues: { new_password: '', confirm_password: '' },
  });

  async function handleAdminPasswordSubmit(data: AdminPasswordValues) {
    try {
      await updateUserMutation.mutateAsync({
        userId: user.id,
        data: { password: data.new_password },
      });
      toast.success('Password changed');
      adminPasswordForm.reset();
    } catch (err) {
      const handled = await handleApiFormError(
        err,
        adminPasswordForm.setError,
        Object.keys(adminPasswordForm.getValues()),
      );
      if (!handled) toast.error(err instanceof Error ? err.message : 'Failed to change password');
    }
  }

  // ── Claim / invite helpers ───────────────────────────────────────────────────

  async function handleIssueClaim() {
    try {
      const response = await resetClaimMutation.mutateAsync(user.id);
      const invite: InviteResponse = await response.json();
      const url = `${window.location.origin}${invite.claim_path}`;
      setIssuedClaimUrl(url);
    } catch (err) {
      console.error(err);
      toast.error('Failed to create link');
    }
  }

  function handleIssuedClaimClose() {
    setIssuedClaimUrl(null);
    onOpenChange(false);
  }

  // ── Render ───────────────────────────────────────────────────────────────────

  const isClaimed = !!user.claimed_at;

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          aria-describedby={undefined}
          onOpenAutoFocus={(e) => e.preventDefault()}
          className="w-[calc(100vw-1rem)] max-w-md p-4 sm:p-6"
        >
          <DialogHeader className="sr-only">
            <DialogTitle>{title}</DialogTitle>
          </DialogHeader>

          {/* Details form */}
          <Form {...detailsForm}>
            <TracedForm
              id={mode === 'self' ? 'update_profile' : 'edit_user'}
              onSubmit={detailsForm.handleSubmit(handleDetailsSubmit)}
              className="space-y-4"
            >
              <FormField
                control={detailsForm.control}
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
                control={detailsForm.control}
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
                <Button type="submit" disabled={detailsForm.formState.isSubmitting}>
                  {detailsForm.formState.isSubmitting ? 'Saving...' : 'Save changes'}
                </Button>
              </div>
            </TracedForm>
          </Form>

          <Separator />

          {/* Password section */}
          {mode === 'self' ? (
            <Form {...selfPasswordForm}>
              <TracedForm
                id="change_password"
                onSubmit={selfPasswordForm.handleSubmit(handleSelfPasswordSubmit)}
                className="space-y-4"
              >
                <FormField
                  control={selfPasswordForm.control}
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
                  control={selfPasswordForm.control}
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
                  control={selfPasswordForm.control}
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
                    disabled={selfPasswordForm.formState.isSubmitting}
                  >
                    {selfPasswordForm.formState.isSubmitting ? 'Changing...' : 'Change password'}
                  </Button>
                </div>
              </TracedForm>
            </Form>
          ) : isClaimed ? (
            <>
              <Form {...adminPasswordForm}>
                <TracedForm
                  id="change_password_admin"
                  onSubmit={adminPasswordForm.handleSubmit(handleAdminPasswordSubmit)}
                  className="space-y-4"
                >
                  <FormField
                    control={adminPasswordForm.control}
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
                    control={adminPasswordForm.control}
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

                  <div className="flex justify-end">
                    <Button
                      type="submit"
                      disabled={adminPasswordForm.formState.isSubmitting}
                    >
                      {adminPasswordForm.formState.isSubmitting ? 'Changing...' : 'Change password'}
                    </Button>
                  </div>
                </TracedForm>
              </Form>

              <Button
                type="button"
                variant="outline"
                className="w-full gap-2"
                onClick={() => setResetConfirmOpen(true)}
              >
                <KeyRound className="h-4 w-4" aria-hidden />
                Reset password (send claim link)
              </Button>
            </>
          ) : (
            <Button
              type="button"
              variant="outline"
              className="w-full gap-2"
              onClick={handleIssueClaim}
              disabled={resetClaimMutation.isPending}
            >
              <Copy className="h-4 w-4" aria-hidden />
              Copy invite link
            </Button>
          )}
        </DialogContent>
      </Dialog>

      {/* Reset password confirm (admin + claimed) */}
      <AlertDialog
        open={resetConfirmOpen}
        onOpenChange={(open) => !open && setResetConfirmOpen(false)}
      >
        <AlertDialogContent className="w-[calc(100vw-1rem)] max-w-sm p-4 sm:p-6">
          <AlertDialogHeader>
            <AlertDialogTitle>
              Reset {user.display_name || user.username}'s password?
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
                setResetConfirmOpen(false);
                void handleIssueClaim();
              }}
            >
              Reset password
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Issued claim link */}
      <Dialog
        open={!!issuedClaimUrl}
        onOpenChange={(next) => {
          if (!next) handleIssuedClaimClose();
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
            <Button type="button" variant="outline" onClick={handleIssuedClaimClose}>
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
