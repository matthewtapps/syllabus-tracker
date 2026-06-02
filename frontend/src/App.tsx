import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from "sonner";
import {
  QueryClient,
  QueryClientProvider,
  useQueryClient,
} from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { Layout } from './components/layout';
import LoginPage from './app/login/page';
import StudentTechniques from './app/student-techniques/page';
import StudentTechniqueDetail from './app/student-techniques/[techniqueId]/page';
import StudentsList from './app/students-list/page';
import Dashboard from './app/dashboard/page';
import ProfilePage from './app/profile/page';
import RegisterUserPage from './app/registration/page';
import AdminPage from './app/admin/page';
import CollectionsPage from './app/collections/page';
import LibraryPage from './app/library/page';
import CollectionDetailPage from './app/collections/[id]/page';
import InvitePage from './app/invite/page';
import RegisterPage from './app/register/page';
import PendingApprovalPage from './app/pending/page';
import ForgotPasswordPage from './app/forgot-password/page';
import { TelemetryProvider } from './context/telemetry';
import { CapabilitiesProvider } from './context/capabilities';
import { useCapabilities, useCurrentUser } from './lib/queries';
import { qk } from './lib/query-keys';

// Module-level singleton. StrictMode double-renders won't reset it.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Every mount triggers a background refetch; the cached data still
      // renders instantly. Window-focus refetch picks up updates from other
      // tabs / sessions.
      staleTime: 0,
      gcTime: 5 * 60 * 1000,
      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
      retry: (failureCount, error) => {
        // The global 401 redirect in lib/auth-redirect.ts handles session
        // expiry; never retry auth failures.
        const status = (error as { status?: number } | null)?.status;
        if (status === 401) return false;
        return failureCount < 1;
      },
    },
    mutations: { retry: false },
  },
});

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AppShell />
      {import.meta.env.DEV && (
        <ReactQueryDevtools
          initialIsOpen={false}
          buttonPosition="top-right"
        />
      )}
    </QueryClientProvider>
  );
}

function AppShell() {
  const qc = useQueryClient();
  const userQuery = useCurrentUser();
  const capabilitiesQuery = useCapabilities();

  const user = userQuery.data ?? null;
  const capabilities = capabilitiesQuery.data ?? null;
  const loading = userQuery.isLoading || capabilitiesQuery.isLoading;

  const handleLogout = () => {
    fetch('/api/logout', {
      method: 'POST',
      credentials: 'include',
    }).then(() => {
      qc.clear();
      window.location.href = '/';
    });
  };

  const handleAuthSuccess = () => {
    qc.invalidateQueries({ queryKey: qk.currentUser() });
    qc.invalidateQueries({ queryKey: qk.capabilities() });
  };

  if (loading) {
    return <div className="flex items-center justify-center min-h-screen">Loading...</div>;
  }

  // Self-registered students who haven't been approved yet only see the
  // pending screen; the rest of the app is gated until a coach approves them.
  const isPending = !!user && !!user.claimed_at && !user.approved_at;
  if (isPending && user) {
    return <PendingApprovalPage user={user} onLogout={handleLogout} />;
  }

  return (
    <Router>
      <TelemetryProvider>
        <CapabilitiesProvider value={capabilities}>
        <Layout user={user} onLogout={handleLogout}>
          <Routes>
            <Route
              path="/login"
              element={user ? <Navigate to="/dashboard" replace /> : <LoginPage onLoginSuccess={handleAuthSuccess} />}
            />
            <Route
              path="/invite/:token"
              element={<InvitePage onClaimSuccess={handleAuthSuccess} />}
            />
            <Route
              path="/register"
              element={user ? <Navigate to="/dashboard" replace /> : <RegisterPage onRegisterSuccess={handleAuthSuccess} />}
            />
            <Route
              path="/forgot-password"
              element={user ? <Navigate to="/dashboard" replace /> : <ForgotPasswordPage />}
            />
            <Route
              path="/student/:id"
              element={user ? <StudentTechniques user={user} /> : <Navigate to="/login" replace />}
            />
            <Route
              path="/student/:id/technique/:techniqueId"
              element={user ? <StudentTechniqueDetail user={user} /> : <Navigate to="/login" replace />}
            />
            <Route
              path="/students"
              element={
                user && (user.role === 'coach' || user.role === 'Coach' || user.role === 'admin' || user.role === 'Admin')
                  ? <StudentsList user={user} />
                  : <Navigate to="/login" replace />
              }
            />
            <Route
              path="/dashboard"
              element={user ? <Dashboard user={user} /> : <Navigate to="/login" replace />}
            />
            <Route
              path="/profile"
              element={user ? <ProfilePage /> : <Navigate to="/login" replace />}
            />
            <Route
              path="/register-user"
              element={
                user && (user.role === 'coach' || user.role === 'Coach' || user.role === 'admin' || user.role === 'Admin')
                  ? <RegisterUserPage user={user} />
                  : <Navigate to="/login" replace />
              }
            />
            <Route
              path="/admin"
              element={
                user && (user.role === 'admin')
                  ? <AdminPage />
                  : <Navigate to="/login" replace />
              }
            />
            <Route
              path="/library"
              element={
                user && (user.role === 'coach' || user.role === 'Coach' || user.role === 'admin' || user.role === 'Admin')
                  ? <LibraryPage />
                  : <Navigate to="/login" replace />
              }
            />
            <Route
              path="/collections"
              element={
                user && (user.role === 'coach' || user.role === 'Coach' || user.role === 'admin' || user.role === 'Admin')
                  ? <CollectionsPage />
                  : <Navigate to="/login" replace />
              }
            />
            <Route
              path="/collections/:id"
              element={
                user && (user.role === 'coach' || user.role === 'Coach' || user.role === 'admin' || user.role === 'Admin')
                  ? <CollectionDetailPage />
                  : <Navigate to="/login" replace />
              }
            />
            <Route path="/" element={<Navigate to={user ? "/dashboard" : "/login"} replace />} />
          </Routes>
        </Layout>
        </CapabilitiesProvider>
        <Toaster
          position="top-center"
          closeButton
          toastOptions={{
            classNames: {
              toast: "group toast group-[.toast-group]:bg-background group-[.toast-group]:text-foreground group-[.toast-group]:border-border group-[.toast-group]:shadow-lg",
              title: "text-sm font-semibold",
              description: "text-sm opacity-90",
              actionButton: "bg-primary text-primary-foreground",
              cancelButton: "bg-muted text-muted-foreground",
              error: "!bg-destructive/15 !border-destructive/30 !text-destructive",
              success: "!bg-default/15 !border-default/30 !text-default-foreground",
              warning: "!bg-secondary/20 !border-secondary/30 !text-secondary-foreground",
              info: "!bg-default/15 !border-default/30 !text-default-foreground",
            },
          }}
        />
      </TelemetryProvider>
    </Router>
  );
}

export default App;
