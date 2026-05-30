import type { User } from '@/lib/api';
import { NavBar } from './navbar';
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

  return (
    <>
      {!isChromeless && <NavBar user={user} onLogout={onLogout} />}
      <main className={`flex-1 ${isChromeless ? '' : 'pb-8'}`}>{children}</main>
      <InstallPrompt />
    </>
  );
}
