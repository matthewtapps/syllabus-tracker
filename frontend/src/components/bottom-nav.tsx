import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  Download,
  EllipsisVertical,
  LayoutDashboard,
  Library,
  LogOut,
  NotebookPen,
  Pin,
  Shield,
  UserPlus,
  UserRound,
  Users,
  type LucideIcon,
} from 'lucide-react';
import type { User } from '@/lib/api';
import { isCoachOrAdmin, isAdmin } from '@/lib/api';
import { useInstallTrigger } from '@/lib/install';
import { cn } from '@/lib/utils';
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';

interface BottomNavProps {
  user: User;
  onLogout: () => void;
}

interface Tab {
  to: string;
  label: string;
  icon: LucideIcon;
  /** Extra paths whose presence should keep this tab marked active. */
  alsoActiveOn?: string[];
}

function buildTabs(user: User): Tab[] {
  const tabs: Tab[] = [
    { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  ];
  if (isCoachOrAdmin(user)) {
    tabs.push({ to: '/students', label: 'Students', icon: Users });
    tabs.push({
      to: '/library',
      label: 'Library',
      icon: Library,
    });
    tabs.push({ to: '/syllabuses', label: 'Syllabi', icon: NotebookPen });
  } else {
    tabs.push({
      to: `/student/${user.id}/syllabuses`,
      label: 'Syllabi',
      icon: NotebookPen,
    });
    tabs.push({ to: '/library', label: 'Library', icon: Library });
    tabs.push({ to: `/student/${user.id}/pinned`, label: 'Pinned', icon: Pin });
    tabs.push({
      to: `/student/${user.id}`,
      label: 'Profile',
      icon: UserRound,
    });
  }
  return tabs;
}

// Pick a single active tab: the one whose `to` (or alsoActiveOn entry) is the
// longest prefix of `pathname`. Without this, sibling tabs like
// /student/:id (My techniques) and /student/:id/pinned (Pinned) both
// light up when the user is on the pinned page, since the shorter path
// is also a startsWith match.
function activeTabIndex(pathname: string, tabs: Tab[]): number {
  let bestIdx = -1;
  let bestLen = -1;
  tabs.forEach((tab, i) => {
    const candidates = [tab.to, ...(tab.alsoActiveOn ?? [])];
    for (const candidate of candidates) {
      const matches =
        pathname === candidate || pathname.startsWith(`${candidate}/`);
      if (matches && candidate.length > bestLen) {
        bestIdx = i;
        bestLen = candidate.length;
      }
    }
  });
  return bestIdx;
}

export function BottomNav({ user, onLogout }: BottomNavProps) {
  const tabs = buildTabs(user);
  const { pathname } = useLocation();
  const activeIdx = activeTabIndex(pathname, tabs);
  // Grid columns match the actual tab count (+1 for the More slot) so a
  // student's 2-tab nav doesn't sit awkwardly left-aligned with empty
  // cells on the right.
  const cellCount = tabs.length + 1;

  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-sm sm:hidden"
    >
      <ul
        className="grid h-14"
        style={{ gridTemplateColumns: `repeat(${cellCount}, minmax(0, 1fr))` }}
      >
        {tabs.map((tab, idx) => {
          const active = idx === activeIdx;
          return (
            <li key={tab.to} className="contents">
              <Link
                to={tab.to}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex flex-col items-center justify-center gap-0.5 text-[10px] font-medium',
                  active
                    ? 'text-primary'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                <tab.icon className="h-5 w-5" aria-hidden />
                {tab.label}
              </Link>
            </li>
          );
        })}
        <li className="contents">
          <MoreTab user={user} onLogout={onLogout} />
        </li>
      </ul>
    </nav>
  );
}

function MoreTab({ user, onLogout }: { user: User; onLogout: () => void }) {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const install = useInstallTrigger();
  const coachOrAdmin = isCoachOrAdmin(user);
  const admin = isAdmin(user);

  const close = () => setOpen(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        className={cn(
          'flex flex-col items-center justify-center gap-0.5 text-[10px] font-medium',
          open ? 'text-primary' : 'text-muted-foreground hover:text-foreground',
        )}
      >
        <EllipsisVertical className="h-5 w-5" aria-hidden />
        More
      </SheetTrigger>
      <SheetContent
        side="bottom"
        className="max-h-[85vh] overflow-y-auto rounded-t-xl pb-[env(safe-area-inset-bottom)]"
      >
        <SheetTitle className="sr-only">More</SheetTitle>

        <div className="space-y-1 p-2">
          {coachOrAdmin && (
            <MoreItem
              icon={UserPlus}
              label="New user"
              onClick={() => {
                close();
                navigate('/register-user');
              }}
            />
          )}
          {admin && (
            <MoreItem
              icon={Shield}
              label="Admin"
              onClick={() => {
                close();
                navigate('/admin');
              }}
            />
          )}
          <MoreItem
            icon={UserRound}
            label="My profile"
            onClick={() => {
              close();
              navigate('/profile');
            }}
          />
          {install.available && (
            <MoreItem
              icon={Download}
              label="Install app"
              onClick={() => {
                close();
                install.trigger();
              }}
            />
          )}
          <MoreItem
            icon={LogOut}
            label="Logout"
            onClick={() => {
              close();
              onLogout();
            }}
          />
        </div>
      </SheetContent>
    </Sheet>
  );
}

function MoreItem({
  icon: Icon,
  label,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-3 rounded-md px-3 py-3 text-sm font-medium text-foreground transition-colors hover:bg-accent"
    >
      <Icon className="h-4 w-4 text-muted-foreground" aria-hidden />
      {label}
    </button>
  );
}
