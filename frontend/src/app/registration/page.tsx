import { useState } from 'react';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { Link as LinkIcon, QrCode } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { inviteUser, type InviteResponse, type User } from '@/lib/api';
import { Button } from '@/components/ui/button';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
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
import { PageHeader } from '@/components/page-header';
import { TracedForm } from '@/components/traced-form';
import { useFormWithValidation } from '@/components/hooks/useFormErrors';

const inviteSchema = z.object({
  display_name: z
    .string()
    .min(1, 'Display name is required')
    .max(100, 'Display name is too long'),
  role: z.enum(['student', 'coach', 'admin']),
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
  const isAdmin = user?.role === 'admin' || user?.role === 'Admin';

  const form = useFormWithValidation<InviteFormValues>({
    resolver: zodResolver(inviteSchema),
    defaultValues: {
      display_name: '',
      role: 'student',
    },
  });

  async function handleSubmit(data: InviteFormValues) {
    const response = await inviteUser({
      display_name: data.display_name,
      role: data.role,
    });
    if (!response.ok) throw response;
    const invite: InviteResponse = await response.json();
    const url = `${window.location.origin}${invite.claim_path}`;
    setIssued({ displayName: data.display_name, url });
    form.reset();
  }

  return (
    <div className="container mx-auto px-4 py-6 sm:px-6 md:py-8">
      <PageHeader
        title="Add user"
        subtitle="Create a stub account. Share the link with the user so they can pick a username and password."
      />

      <div className="mx-auto max-w-md">
        <Form {...form}>
          <TracedForm
            id="invite_user"
            onSubmit={form.handleSubmit(handleSubmit)}
            setFieldErrors={form.setFieldErrors}
            className="space-y-5"
          >
            <FormField
              control={form.control}
              name="display_name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Display name</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder="e.g. Alex Rivera" />
                  </FormControl>
                  <FormDescription>
                    How the user's name appears in the app. You can edit this later.
                  </FormDescription>
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
                      {isAdmin && <SelectItem value="admin">Admin</SelectItem>}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <Button
              type="submit"
              className="w-full"
              disabled={form.formState.isSubmitting}
            >
              {form.formState.isSubmitting ? 'Creating...' : 'Create user'}
            </Button>
          </TracedForm>
        </Form>
      </div>

      <div className="mx-auto mt-10 max-w-md">
        <Accordion type="single" collapsible>
          <AccordionItem value="qr" className="rounded-lg border border-border bg-card px-4">
            <AccordionTrigger className="text-sm font-medium">
              <span className="flex items-center gap-2">
                <QrCode className="h-4 w-4" aria-hidden />
                Or let students sign up themselves
              </span>
            </AccordionTrigger>
            <AccordionContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Display this QR code at the gym. A student scanning it lands
                on the sign-up page. Their account waits for your approval on
                your dashboard before they can do anything.
              </p>
              <div className="flex items-center justify-center rounded-md border border-border bg-background p-6">
                <QRCodeSVG
                  value={`${window.location.origin}/register`}
                  size={192}
                  bgColor="transparent"
                  fgColor="currentColor"
                  className="text-foreground"
                />
              </div>
              <p className="break-all text-center font-mono text-xs text-muted-foreground">
                {window.location.origin}/register
              </p>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </div>

      <ClaimLinkDialog
        issued={issued}
        onClose={() => setIssued(null)}
      />
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
