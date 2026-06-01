import type { ReactNode } from 'react';
import { Copy, KeyRound, Sparkles, UserPlus } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import type { User } from '@/lib/api';

interface QueuePanelProps {
  resetRequests: User[];
  pendingApprovals: User[];
  needsSyllabus: User[];
  onSendResetLink: (id: number) => void;
  onApprove: (id: number) => void;
}

export function QueuePanel({
  resetRequests,
  pendingApprovals,
  needsSyllabus,
  onSendResetLink,
  onApprove,
}: QueuePanelProps) {
  const empty =
    resetRequests.length === 0 &&
    pendingApprovals.length === 0 &&
    needsSyllabus.length === 0;
  if (empty) return null;

  return (
    <div className="space-y-3">
        {resetRequests.length > 0 && (
          <QueueGroup
            icon={<KeyRound className="h-4 w-4 text-status-amber" aria-hidden />}
            title="Password reset requests"
          >
            {resetRequests.map((s) => (
              <li key={s.id} className="flex items-center gap-3 px-3 py-2">
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
          >
            {pendingApprovals.map((s) => (
              <li key={s.id} className="flex items-center gap-3 px-3 py-2">
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
          >
            {needsSyllabus.map((s) => (
              <li key={s.id} className="flex items-center gap-3 px-3 py-2">
                <StudentLabel student={s} />
                <Button asChild size="sm" variant="outline">
                  <Link to={`/student/${s.id}?from=dashboard`}>Open</Link>
                </Button>
              </li>
            ))}
          </QueueGroup>
        )}
    </div>
  );
}

interface QueueGroupProps {
  icon: ReactNode;
  title: string;
  caption?: string;
  children: ReactNode;
}

function QueueGroup({ icon, title, caption, children }: QueueGroupProps) {
  return (
    <div className="overflow-hidden rounded-lg border border-status-amber/30 bg-card">
      <header className="flex items-center gap-2.5 border-b border-status-amber/30 bg-status-amber-bg px-3 py-2">
        {icon}
        <div>
          <h3 className="text-sm font-semibold">{title}</h3>
          {caption && (
            <p className="text-xs text-muted-foreground">{caption}</p>
          )}
        </div>
      </header>
      <ul className="divide-y divide-border">{children}</ul>
    </div>
  );
}

function StudentLabel({ student }: { student: User }) {
  return (
    <div className="min-w-0 flex-1">
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
