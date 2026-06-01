import { useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import {
  Download,
  EllipsisVertical,
  LayoutDashboard,
  Library,
  LogOut,
  Shield,
  UserPlus,
  UserRound,
  Users,
  type LucideIcon,
} from 'lucide-react';
import type { User } from '@/lib/api';
import { useInstallPrompt } from '@/lib/use-install-prompt';
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
}

function buildTabs(user: User): Tab[] {
  const isCoachOrAdmin =
    user.role === 'coach' ||
    user.role === 'Coach' ||
    user.role === 'admin' ||
    user.role === 'Admin';
  const tabs: Tab[] = [
    { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  ];
  if (isCoachOrAdmin) {
    tabs.push({ to: '/students', label: 'Students', icon: Users });
    tabs.push({ to: '/collections', label: 'Techniques', icon: Library });
  } else {
    tabs.push({ to: `/student/${user.id}`, label: 'My techniques', icon: Library });
  }
  return tabs;
}

export function BottomNav({ user, onLogout }: BottomNavProps) {
  const tabs = buildTabs(user);

  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-sm sm:hidden"
    >
      <ul className="grid h-14 grid-cols-4">
        {tabs.map((tab) => (
          <li key={tab.to} className="contents">
            <NavLink
              to={tab.to}
              className={({ isActive }) =>
                cn(
                  'flex flex-col items-center justify-center gap-0.5 text-[10px] font-medium',
                  isActive
                    ? 'text-primary'
                    : 'text-muted-foreground hover:text-foreground',
                )
              }
            >
              <tab.icon className="h-5 w-5" aria-hidden />
              {tab.label}
            </NavLink>
          </li>
        ))}
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
  const { canInstall, promptInstall } = useInstallPrompt();
  const isCoachOrAdmin =
    user.role === 'coach' ||
    user.role === 'Coach' ||
    user.role === 'admin' ||
    user.role === 'Admin';
  const isAdmin = user.role === 'admin' || user.role === 'Admin';

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
          {isCoachOrAdmin && (
            <MoreItem
              icon={UserPlus}
              label="New user"
              onClick={() => {
                close();
                navigate('/register-user');
              }}
            />
          )}
          {isAdmin && (
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
          {canInstall && (
            <MoreItem
              icon={Download}
              label="Install app"
              onClick={() => {
                close();
                void promptInstall();
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
