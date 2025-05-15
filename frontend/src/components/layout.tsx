import type { User } from '@/lib/api';
import { NavBar } from './navbar';
import type { PropsWithChildren } from 'react';
import { useLocation } from 'react-router-dom';

interface LayoutProps extends PropsWithChildren {
  user: User | null;
  onLogout: () => void;
}

export function Layout({ user, onLogout, children }: LayoutProps) {
  const location = useLocation();
  const isLoginPage = location.pathname === '/login';

  return (
    <>
      {!isLoginPage && <NavBar user={user} onLogout={onLogout} />}
      <main className={`flex-1 ${isLoginPage ? '' : 'pb-8'}`}>{children}</main>
    </>
  );
}
