import type { User } from '@/lib/api';
import { NavBar } from './navbar';
import { BottomNav } from './bottom-nav';
import { InstallPrompt } from './install-prompt';
import type { PropsWithChildren } from 'react';
import { useLocation } from 'react-router-dom';

interface LayoutProps extends PropsWithChildren {
  user: User | null;
  onLogout: () => void;
}

export function Layout({ user, onLogout, children }: LayoutProps) {
  const location = useLocation();
  const isChromeless =
    location.pathname === '/login' ||
    location.pathname === '/register' ||
    location.pathname === '/forgot-password' ||
    location.pathname.startsWith('/invite/');

  const showBottomNav = !isChromeless && !!user;

  return (
    <>
      {!isChromeless && <NavBar user={user} onLogout={onLogout} />}
      <main
        className={
          isChromeless
            ? 'flex-1'
            : showBottomNav
              ? 'flex-1 pb-[calc(env(safe-area-inset-bottom)+5rem)] sm:pb-8'
              : 'flex-1 pb-8'
        }
      >
        {children}
      </main>
      {showBottomNav && user && <BottomNav user={user} onLogout={onLogout} />}
      <InstallPrompt />
    </>
  );
}
