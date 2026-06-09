import { useEffect, useState } from 'react';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { Link as LinkIcon, QrCode } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { toast } from 'sonner';
import {
  assignCollectionToStudent,
  getCollections,
  inviteUser,
  isAdmin,
  type Collection,
  type InviteResponse,
  type User,
} from '@/lib/api';
import { Button } from '@/components/ui/button';
import { ClaimLinkPanel } from '@/components/claim-link-panel';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { TracedForm } from '@/components/traced-form';
import { handleApiFormError, useFormWithValidation } from '@/components/hooks/useFormErrors';

const NO_COLLECTION = 'none';

const inviteSchema = z.object({
  display_name: z
    .string()
    .min(1, 'Display name is required')
    .max(100, 'Display name is too long'),
  role: z.enum(['student', 'coach', 'admin']),
  collection_id: z.string().optional(),
});

type InviteFormValues = z.infer<typeof inviteSchema>;

interface AddUserPageProps {
  user: User;
}

export default function AddUserPage({ user }: AddUserPageProps) {
  const [issued, setIssued] = useState<{
    displayName: string;
    url: string;
  } | null>(null);
  const [collections, setCollections] = useState<Collection[]>([]);
  const admin = isAdmin(user ?? null);

  const form = useFormWithValidation<InviteFormValues>({
    resolver: zodResolver(inviteSchema),
    defaultValues: {
      display_name: '',
      role: 'student',
      collection_id: NO_COLLECTION,
    },
  });

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const cols = await getCollections();
        if (!cancelled) setCollections(cols);
      } catch {
        // Non-fatal: the form still works without the picker.
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const watchedRole = form.watch('role');
  const showCollectionPicker = watchedRole === 'student' && collections.length > 0;

  async function handleSubmit(data: InviteFormValues) {
    try {
      const response = await inviteUser({
        display_name: data.display_name,
        role: data.role,
      });
      if (!response.ok) throw response;
      const invite: InviteResponse = await response.json();

      // Optional: bulk-assign a collection so the new student lands fully set up.
      if (
        data.role === 'student' &&
        data.collection_id &&
        data.collection_id !== NO_COLLECTION
      ) {
        const parsed = parseInt(data.collection_id, 10);
        if (Number.isFinite(parsed)) {
          try {
            await assignCollectionToStudent(invite.user_id, parsed);
          } catch {
            toast.error("Created the user, but couldn't assign the collection");
          }
        }
      }

      const url = `${window.location.origin}${invite.claim_path}`;
      setIssued({ displayName: data.display_name, url });
      form.reset({
        display_name: '',
        role: data.role,
        collection_id: data.collection_id ?? NO_COLLECTION,
      });
    } catch (err) {
      const handled = await handleApiFormError(
        err,
        form.setError,
        Object.keys(form.getValues()),
      );
      if (!handled) toast.error(err instanceof Error ? err.message : 'Failed to create user');
    }
  }

  return (
    <div className="container mx-auto max-w-md px-4 py-6 sm:px-6 md:py-8">
      <section className="rounded-lg border border-border bg-card p-4 sm:p-6">
        <Form {...form}>
          <TracedForm
            id="invite_user"
            onSubmit={form.handleSubmit(handleSubmit)}
            className="space-y-4"
          >
            <FormField
              control={form.control}
              name="display_name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Display name</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      autoFocus
                      placeholder="e.g. Alex Rivera"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="role"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Role</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select a role" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="student">Student</SelectItem>
                      <SelectItem value="coach">Coach</SelectItem>
                      {admin && <SelectItem value="admin">Admin</SelectItem>}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            {showCollectionPicker && (
              <FormField
                control={form.control}
                name="collection_id"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Start them on</FormLabel>
                    <Select
                      value={field.value ?? NO_COLLECTION}
                      onValueChange={field.onChange}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Optional" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value={NO_COLLECTION}>
                          None (just create the account)
                        </SelectItem>
                        {collections.map((c) => (
                          <SelectItem key={c.id} value={String(c.id)}>
                            {c.name} ({c.technique_count})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormDescription>
                      Bulk-assigns the collection's techniques to this new
                      student.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

            <Button
              type="submit"
              className="w-full"
              disabled={form.formState.isSubmitting}
            >
              {form.formState.isSubmitting ? 'Creating...' : 'Create user'}
            </Button>
          </TracedForm>
        </Form>
      </section>

      <section className="mt-4 rounded-lg border border-border bg-card p-4 sm:p-6">
        <div className="flex items-start gap-3">
          <QrCode
            className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground"
            aria-hidden
          />
          <div className="min-w-0 flex-1 space-y-1">
            <p className="text-sm font-semibold">
              Or let students sign up themselves
            </p>
            <p className="text-xs text-muted-foreground">
              Display this QR at the gym. Students who scan land on the signup
              page and wait for your approval.
            </p>
          </div>
        </div>
        <div className="mt-4 flex items-center justify-center rounded-md border border-border bg-background p-4">
          <QRCodeSVG
            value={`${window.location.origin}/register`}
            size={160}
            bgColor="transparent"
            fgColor="currentColor"
            className="text-foreground"
          />
        </div>
        <p className="mt-3 break-all text-center font-mono text-xs text-muted-foreground">
          {window.location.origin}/register
        </p>
      </section>

      <ClaimLinkDialog issued={issued} onClose={() => setIssued(null)} />
    </div>
  );
}

interface ClaimLinkDialogProps {
  issued: { displayName: string; url: string } | null;
  onClose: () => void;
}

function ClaimLinkDialog({ issued, onClose }: ClaimLinkDialogProps) {
  const open = !!issued;
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent className="w-[calc(100vw-1rem)] max-w-md p-4 sm:p-6">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <LinkIcon className="h-4 w-4 text-status-green" aria-hidden />
            Claim link ready
          </DialogTitle>
          <DialogDescription>
            Show this QR code to{' '}
            <span className="font-medium text-foreground">
              {issued?.displayName}
            </span>{' '}
            or send them the link. The link is valid for 7 days.
          </DialogDescription>
        </DialogHeader>

        {issued && <ClaimLinkPanel url={issued.url} />}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
