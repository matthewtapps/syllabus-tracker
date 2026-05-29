import { Clock } from 'lucide-react';
import type { User } from '@/lib/api';
import { Button } from '@/components/ui/button';

interface PendingApprovalPageProps {
  user: User;
  onLogout: () => void;
}

export default function PendingApprovalPage({
  user,
  onLogout,
}: PendingApprovalPageProps) {
  const displayName =
    user.first_name || user.display_name || user.username || 'there';

  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-8 bg-background px-6 py-10">
      <div className="flex w-full max-w-md flex-col items-center gap-3 text-center">
        <div className="flex items-center gap-2">
          <img src="/img/logo.png" alt="" className="h-8 w-8" aria-hidden />
          <span className="text-xl font-semibold tracking-tight">Silly Bus</span>
        </div>
        <p className="text-sm uppercase tracking-[0.2em] text-muted-foreground">
          Dominance MMA Jiu Jitsu Syllabus Tracker
        </p>
      </div>

      <div className="w-full max-w-md rounded-lg border border-border bg-card p-6">
        <div className="mb-4 flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-status-amber-bg text-status-amber">
            <Clock className="h-5 w-5" aria-hidden />
          </div>
          <div className="space-y-1">
            <p className="font-medium">Waiting for approval</p>
            <p className="text-sm text-muted-foreground">
              Hi {displayName}, your account is set up. A coach needs to approve
              you before you can see your techniques. Let your coach know you've
              signed up.
            </p>
          </div>
        </div>

        <Button variant="outline" className="w-full" onClick={onLogout}>
          Sign out
        </Button>
      </div>
    </div>
  );
}
