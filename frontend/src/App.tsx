import { lazy, Suspense } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from "sonner";
import {
  QueryClient,
  QueryClientProvider,
  useQueryClient,
} from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { Layout } from './components/layout';
import { SwUpdateToast } from './components/sw-update-toast';
import { RequireAdmin, RequireAuth, RequireCoach } from './components/route-guards';
import { TelemetryProvider } from './context/telemetry';
import { CapabilitiesProvider } from './context/capabilities';
import { useCapabilities, useCurrentUser } from './lib/queries';
import { qk } from './lib/query-keys';

const LoginPage = lazy(() => import('./app/login/page'));
const StudentTechniques = lazy(() => import('./app/student-techniques/page'));
const StudentTechniqueDetail = lazy(() => import('./app/student-techniques/[techniqueId]/page'));
const StudentsList = lazy(() => import('./app/students-list/page'));
const Dashboard = lazy(() => import('./app/dashboard/page'));
const ProfilePage = lazy(() => import('./app/profile/page'));
const RegisterUserPage = lazy(() => import('./app/registration/page'));
const AdminPage = lazy(() => import('./app/admin/page'));
const SyllabusesPage = lazy(() => import('./app/syllabuses/page'));
const LibraryPage = lazy(() => import('./app/library/page'));
const SyllabusDetailPage = lazy(() => import('./app/syllabuses/[id]/page'));
const InvitePage = lazy(() => import('./app/invite/page'));
const RegisterPage = lazy(() => import('./app/register/page'));
const PendingApprovalPage = lazy(() => import('./app/pending/page'));
const ForgotPasswordPage = lazy(() => import('./app/forgot-password/page'));

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

function RouteLoading() {
  return (
    <div className="flex min-h-[40vh] items-center justify-center text-sm text-muted-foreground">
      Loading...
    </div>
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
    return (
      <Suspense fallback={<RouteLoading />}>
        <PendingApprovalPage user={user} onLogout={handleLogout} />
      </Suspense>
    );
  }

  return (
    <Router>
      <TelemetryProvider>
        <CapabilitiesProvider value={capabilities}>
        <Layout user={user} onLogout={handleLogout}>
          <Suspense fallback={<RouteLoading />}>
          {/* The `user!` assertions on protected routes are safe: each one
              sits inside RequireAuth/RequireCoach/RequireAdmin, which
              redirect when user is null before the inner element renders. */}
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
              element={
                <RequireAuth>
                  <StudentTechniques user={user!} />
                </RequireAuth>
              }
            />
            <Route
              path="/student/:id/technique/:techniqueId"
              element={
                <RequireAuth>
                  <StudentTechniqueDetail user={user!} />
                </RequireAuth>
              }
            />
            <Route
              path="/students"
              element={
                <RequireCoach>
                  <StudentsList user={user!} />
                </RequireCoach>
              }
            />
            <Route
              path="/dashboard"
              element={
                <RequireAuth>
                  <Dashboard user={user!} />
                </RequireAuth>
              }
            />
            <Route
              path="/profile"
              element={
                <RequireAuth>
                  <ProfilePage />
                </RequireAuth>
              }
            />
            <Route
              path="/register-user"
              element={
                <RequireCoach>
                  <RegisterUserPage user={user!} />
                </RequireCoach>
              }
            />
            <Route
              path="/admin"
              element={
                <RequireAdmin>
                  <AdminPage />
                </RequireAdmin>
              }
            />
            <Route
              path="/library"
              element={
                <RequireAuth>
                  <LibraryPage user={user!} />
                </RequireAuth>
              }
            />
            <Route
              path="/syllabuses"
              element={
                <RequireAuth>
                  <SyllabusesPage user={user!} />
                </RequireAuth>
              }
            />
            <Route
              path="/syllabuses/:id"
              element={
                <RequireAuth>
                  <SyllabusDetailPage user={user!} />
                </RequireAuth>
              }
            />
            <Route path="/" element={<Navigate to={user ? "/dashboard" : "/login"} replace />} />
          </Routes>
          </Suspense>
        </Layout>
        </CapabilitiesProvider>
        <SwUpdateToast />
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
