import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { isAdmin, isCoachOrAdmin } from "@/lib/api";
import { useCurrentUser } from "@/lib/queries";

interface GuardProps {
  children: ReactNode;
}

export function RequireAuth({ children }: GuardProps) {
  const { data: user, isLoading } = useCurrentUser();
  if (isLoading) return null;
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

export function RequireCoach({ children }: GuardProps) {
  const { data: user, isLoading } = useCurrentUser();
  if (isLoading) return null;
  if (!user) return <Navigate to="/login" replace />;
  if (!isCoachOrAdmin(user)) return <Navigate to="/dashboard" replace />;
  return <>{children}</>;
}

export function RequireAdmin({ children }: GuardProps) {
  const { data: user, isLoading } = useCurrentUser();
  if (isLoading) return null;
  if (!user) return <Navigate to="/login" replace />;
  if (!isAdmin(user)) return <Navigate to="/dashboard" replace />;
  return <>{children}</>;
}
