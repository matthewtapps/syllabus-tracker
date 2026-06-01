import { ChevronRight, Copy, KeyRound, Sparkles, UserPlus } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import type { User } from '@/lib/api';

interface QueueSheetProps {
  resetRequests: User[];
  pendingApprovals: User[];
  needsSyllabus: User[];
  onSendResetLink: (id: number) => void;
  onApprove: (id: number) => void;
}

export function QueueSheet({
  resetRequests,
  pendingApprovals,
  needsSyllabus,
  onSendResetLink,
  onApprove,
}: QueueSheetProps) {
  const total = resetRequests.length + pendingApprovals.length + needsSyllabus.length;
  if (total === 0) return null;

  return (
    <Sheet>
      <SheetTrigger asChild>
        <button
          type="button"
          className="flex w-full items-center justify-between gap-3 rounded-lg border border-status-amber/40 bg-status-amber-bg px-4 py-3 text-left transition-colors hover:bg-status-amber-bg/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <div className="min-w-0">
            <p className="text-sm font-semibold text-status-amber">
              {total} {total === 1 ? 'thing' : 'things'} for you
            </p>
            <p className="truncate text-xs text-muted-foreground">
              {[
                resetRequests.length && `${resetRequests.length} reset`,
                pendingApprovals.length && `${pendingApprovals.length} approval`,
                needsSyllabus.length && `${needsSyllabus.length} new`,
              ]
                .filter(Boolean)
                .join(' · ')}
            </p>
          </div>
          <ChevronRight
            className="h-4 w-4 shrink-0 text-muted-foreground"
            aria-hidden
          />
        </button>
      </SheetTrigger>
      <SheetContent
        side="bottom"
        className="max-h-[85vh] overflow-y-auto rounded-t-xl"
      >
        <SheetHeader>
          <SheetTitle>Things for you</SheetTitle>
          <SheetDescription>
            Quick actions across new students, approvals, and reset requests.
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-5 px-4 pb-6">
          {resetRequests.length > 0 && (
            <QueueGroup
              icon={<KeyRound className="h-4 w-4 text-status-amber" aria-hidden />}
              title="Password reset requests"
              caption="Students asking for a fresh sign-in link."
            >
              {resetRequests.map((s) => (
                <li key={s.id} className="flex items-center gap-3 px-1 py-2">
                  <StudentLabel student={s} />
                  <Button
                    size="sm"
                    onClick={() => onSendResetLink(s.id)}
                    className="gap-2"
                  >
                    <Copy className="h-4 w-4" aria-hidden />
                    Send link
                  </Button>
                </li>
              ))}
            </QueueGroup>
          )}

          {pendingApprovals.length > 0 && (
            <QueueGroup
              icon={<UserPlus className="h-4 w-4 text-status-amber" aria-hidden />}
              title="Pending approvals"
              caption="Students who signed up themselves."
            >
              {pendingApprovals.map((s) => (
                <li key={s.id} className="flex items-center gap-3 px-1 py-2">
                  <StudentLabel student={s} />
                  <Button size="sm" onClick={() => onApprove(s.id)}>
                    Approve
                  </Button>
                </li>
              ))}
            </QueueGroup>
          )}

          {needsSyllabus.length > 0 && (
            <QueueGroup
              icon={<Sparkles className="h-4 w-4 text-status-amber" aria-hidden />}
              title="Ready for a syllabus"
              caption="Approved students with no techniques yet."
            >
              {needsSyllabus.map((s) => (
                <li key={s.id} className="flex items-center gap-3 px-1 py-2">
                  <StudentLabel student={s} />
                  <Button asChild size="sm" variant="outline">
                    <Link to={`/student/${s.id}?from=queue`}>Open</Link>
                  </Button>
                </li>
              ))}
            </QueueGroup>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

interface QueueGroupProps {
  icon: React.ReactNode;
  title: string;
  caption: string;
  children: React.ReactNode;
}

function QueueGroup({ icon, title, caption, children }: QueueGroupProps) {
  return (
    <section>
      <header className="flex items-center gap-2 pb-1.5">
        {icon}
        <div>
          <h3 className="text-sm font-semibold">{title}</h3>
          <p className="text-xs text-muted-foreground">{caption}</p>
        </div>
      </header>
      <ul className="divide-y divide-border rounded-md border border-border">
        {children}
      </ul>
    </section>
  );
}

function StudentLabel({ student }: { student: User }) {
  return (
    <div className="min-w-0 flex-1 px-2">
      <p className="truncate text-sm font-medium">
        {student.display_name || student.username}
      </p>
      {student.username && student.display_name && (
        <p className="truncate text-xs text-muted-foreground">
          {student.username}
        </p>
      )}
    </div>
  );
}
