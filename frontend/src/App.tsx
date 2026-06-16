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
import { AppBreadcrumbs } from './components/breadcrumbs/app-breadcrumbs';
import { SwUpdateToast } from './components/sw-update-toast';
import { ScrollManager } from './components/scroll-manager';
import { AuthErrorBoundary } from './components/auth-error-boundary';
import { RequireAdmin, RequireAuth, RequireCoach } from './components/route-guards';
import { TelemetryProvider } from './context/telemetry';
import { CapabilitiesProvider } from './context/capabilities';
import { CurrentUserProvider } from './lib/current-user';
import { ConfirmProvider } from './components/confirm-dialog';
import { useCapabilities, useCurrentUser } from './lib/queries';
import { qk } from './lib/query-keys';
import type { User } from './lib/api';

const LoginPage = lazy(() => import('./app/login/page'));
const StudentProfilePage = lazy(() => import('./app/student-profile/page'));
// Legacy surfaces kept reachable by direct URL (no nav links) so coaches
// can side-by-side compare the old student-techniques + collections
// flows against the new syllabus stack while migrating prod students.
// The backend tables and routes are dormant but still mounted; a later
// cleanup PR drops them.
const LegacyStudentTechniques = lazy(() => import('./app/student-techniques/page'));
const LegacyStudentTechniqueDetail = lazy(
  () => import('./app/student-techniques/[techniqueId]/page'),
);
const LegacyCollectionsPage = lazy(() => import('./app/collections/page'));
const LegacyCollectionDetailPage = lazy(
  () => import('./app/collections/[id]/page'),
);
const StudentsList = lazy(() => import('./app/students-list/page'));
const Dashboard = lazy(() => import('./app/dashboard/page'));
const ProfilePage = lazy(() => import('./app/profile/page'));
const RegisterUserPage = lazy(() => import('./app/registration/page'));
const AdminPage = lazy(() => import('./app/admin/page'));
const LibraryPage = lazy(() => import('./app/library/page'));
const StudentPinnedPage = lazy(() => import('./app/student-pinned/page'));
const SyllabiPage = lazy(() => import('./app/syllabi/page'));
const SyllabusDetailPage = lazy(() => import('./app/syllabi/[id]/page'));
const StudentSyllabiPage = lazy(() => import('./app/student-syllabi/page'));
const StudentSyllabusDetailPage = lazy(
  () => import('./app/student-syllabi/[syllabusId]/page'),
);
const StudentActivityPage = lazy(() => import('./app/student-activity/page'));
const InvitePage = lazy(() => import('./app/invite/page'));
const RegisterPage = lazy(() => import('./app/register/page'));
const PendingApprovalPage = lazy(() => import('./app/pending/page'));
const ForgotPasswordPage = lazy(() => import('./app/forgot-password/page'));

// Module-level singleton. StrictMode double-renders won't reset it.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Default freshness window. Cached data renders instantly; button/link
      // navigation refetches active queries (see ScrollManager) and
      // window-focus refetch picks up cross-tab updates, so a short default is
      // enough. Hooks that need different behavior (live polling, rarely-
      // changing reference data) override staleTime locally.
      staleTime: 30 * 1000,
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
      <ScrollManager />
      <TelemetryProvider>
        <CapabilitiesProvider value={capabilities}>
          {user ? (
            <AuthedAppShell user={user} onLogout={handleLogout} />
          ) : (
            <UnauthedShell onAuthSuccess={handleAuthSuccess} />
          )}
          <SwUpdateToast />
          <AppToaster />
        </CapabilitiesProvider>
      </TelemetryProvider>
    </Router>
  );
}

// Authenticated subtree. CurrentUserProvider is mounted here so useUser()
// can be called from any descendant page or component. AuthErrorBoundary
// wraps the provider so an unexpected useUser() throw (provider missing,
// user vanished mid-session) renders a recovery panel instead of unmounting
// the whole app.
function AuthedAppShell({
  user,
  onLogout,
}: {
  user: User;
  onLogout: () => void;
}) {
  return (
    <AuthErrorBoundary>
      <CurrentUserProvider user={user}>
        <ConfirmProvider>
          <Layout user={user} onLogout={onLogout}>
            <AppBreadcrumbs />
            <Suspense fallback={<RouteLoading />}>
              <AuthedRoutes />
            </Suspense>
          </Layout>
        </ConfirmProvider>
      </CurrentUserProvider>
    </AuthErrorBoundary>
  );
}

// Unauthenticated subtree. Login / register / invite / forgot-password
// render outside the provider so useUser() callsites never see a null
// value and the error boundary's recovery panel is reserved for the case
// where auth actually broke.
function UnauthedShell({ onAuthSuccess }: { onAuthSuccess: () => void }) {
  return (
    <Layout user={null} onLogout={() => undefined}>
      <Suspense fallback={<RouteLoading />}>
        <UnauthedRoutes onAuthSuccess={onAuthSuccess} />
      </Suspense>
    </Layout>
  );
}

// All authenticated pages read the current user via useUser() now; the
// `user` prop pattern was retired in PR 2.
function AuthedRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<Navigate to="/dashboard" replace />} />
      <Route path="/register" element={<Navigate to="/dashboard" replace />} />
      <Route path="/forgot-password" element={<Navigate to="/dashboard" replace />} />
      <Route
        path="/student/:id"
        element={
          <RequireAuth>
            <StudentProfilePage />
          </RequireAuth>
        }
      />
      <Route
        path="/student/:id/legacy"
        element={
          <RequireAuth>
            <LegacyStudentTechniques />
          </RequireAuth>
        }
      />
      <Route
        path="/student/:id/legacy/technique/:techniqueId"
        element={
          <RequireAuth>
            <LegacyStudentTechniqueDetail />
          </RequireAuth>
        }
      />
      <Route
        path="/legacy/collections"
        element={
          <RequireCoach>
            <LegacyCollectionsPage />
          </RequireCoach>
        }
      />
      <Route
        path="/legacy/collections/:id"
        element={
          <RequireCoach>
            <LegacyCollectionDetailPage />
          </RequireCoach>
        }
      />
      <Route
        path="/students"
        element={
          <RequireCoach>
            <StudentsList />
          </RequireCoach>
        }
      />
      <Route
        path="/dashboard"
        element={
          <RequireAuth>
            <Dashboard />
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
            <RegisterUserPage />
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
            <LibraryPage />
          </RequireAuth>
        }
      />
      <Route
        path="/student/:id/pinned"
        element={
          <RequireAuth>
            <StudentPinnedPage />
          </RequireAuth>
        }
      />
      <Route
        path="/syllabi"
        element={
          <RequireCoach>
            <SyllabiPage />
          </RequireCoach>
        }
      />
      <Route
        path="/syllabi/:id"
        element={
          <RequireCoach>
            <SyllabusDetailPage />
          </RequireCoach>
        }
      />
      <Route
        path="/student/:id/syllabi"
        element={
          <RequireAuth>
            <StudentSyllabiPage />
          </RequireAuth>
        }
      />
      <Route
        path="/student/:id/syllabi/:syllabusId"
        element={
          <RequireAuth>
            <StudentSyllabusDetailPage />
          </RequireAuth>
        }
      />
      <Route
        path="/student/:id/activity"
        element={
          <RequireAuth>
            <StudentActivityPage />
          </RequireAuth>
        }
      />
      <Route path="/" element={<Navigate to="/dashboard" replace />} />
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}

function UnauthedRoutes({ onAuthSuccess }: { onAuthSuccess: () => void }) {
  return (
    <Routes>
      <Route
        path="/login"
        element={<LoginPage onLoginSuccess={onAuthSuccess} />}
      />
      <Route
        path="/invite/:token"
        element={<InvitePage onClaimSuccess={onAuthSuccess} />}
      />
      <Route
        path="/register"
        element={<RegisterPage onRegisterSuccess={onAuthSuccess} />}
      />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
  );
}

function AppToaster() {
  // Bottom-center matches the mobile convention (Material Snackbars, iOS
  // bottom banners, sonner's own examples): the toast sits close to the
  // thumb and stays clear of the page header / breadcrumbs at the top.
  // mobileOffset lifts the toast above the fixed bottom-nav strip on
  // small screens; the nav is `sm:hidden`, so above the `sm` breakpoint
  // the default offset is enough.
  return (
    <Toaster
      position="bottom-center"
      offset="24px"
      mobileOffset={{ bottom: "calc(env(safe-area-inset-bottom) + 72px)" }}
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
  );
}

export default App;
