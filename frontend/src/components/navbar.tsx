import type { User } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { useNavigate } from 'react-router-dom';
import { ModeToggle } from './theme/mode-toggle';
import { BusFrontIcon } from 'lucide-react';

interface NavBarProps {
  user: User | null;
  onLogout: () => void;
}

export function NavBar({ user, onLogout }: NavBarProps) {
  const navigate = useNavigate();

  const isCoach = user?.role === 'coach' || user?.role === 'Coach';
  const isAdmin = user?.role === 'admin' || user?.role === 'Admin';
  const isStudent = user?.role === 'student' || user?.role === 'Student';

  return (
    <header className="border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container flex h-14 items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="font-bold text-xl">Silly Bus<BusFrontIcon className="size-4" /></div>

          <nav className="flex items-center gap-2 ml-6">
            {user && (
              <>
                <Button
                  variant="ghost"
                  onClick={() => navigate('/dashboard')}
                >
                  Dashboard
                </Button>

                {isStudent && (
                  <Button
                    variant="ghost"
                    onClick={() => navigate(`/student/${user.id}`)}
                  >
                    My Techniques
                  </Button>
                )}

                {(isCoach || isAdmin) && (
                  <Button
                    variant="ghost"
                    onClick={() => navigate('/students')}
                  >
                    Students
                  </Button>
                )}

                {isAdmin && (
                  <Button
                    variant="ghost"
                    onClick={() => navigate('/admin')}
                  >
                    Admin
                  </Button>
                )}
              </>
            )}
          </nav>
        </div>

        <div className="flex items-center gap-4">
          <ModeToggle />

          {user ? (
            <div className="flex items-center gap-4">
              <div className="text-sm text-muted-foreground">
                {user.display_name || user.username}
              </div>
              <Button variant="outline" size="sm" onClick={onLogout}>
                Logout
              </Button>
            </div>
          ) : (
            <Button variant="default" size="sm" onClick={() => navigate('/login')}>
              Login
            </Button>
          )}
        </div>
      </div>
    </header>
  );
}
