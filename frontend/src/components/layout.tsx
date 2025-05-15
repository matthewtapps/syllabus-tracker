import type { User } from '@/lib/api';
import { NavBar } from './navbar';
import type { PropsWithChildren } from 'react';

interface LayoutProps extends PropsWithChildren {
  user: User | null;
  onLogout: () => void;
}

export function Layout({ user, onLogout, children }: LayoutProps) {
  return (
    <>
      <NavBar user={user} onLogout={onLogout} />
      <main className="@container">{children}</main>
    </>
  );
}
