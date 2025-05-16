import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { ThemeProvider } from './components/theme/theme-provider';
import { Toaster } from "sonner";
import { useState, useEffect } from 'react';
import { Layout } from './components/layout';
import LoginPage from './app/login/page';
import StudentTechniques from './app/student-techniques/page';
import StudentsList from './app/students-list/page';
import Dashboard from './app/dashboard/page';
import { getCurrentUser } from './lib/api';
import type { User } from './lib/api';
import ProfilePage from './app/profile/page';
import RegisterUserPage from './app/registration/page';
import AdminPage from './app/admin/page';

function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadUser();
  }, []);

  async function loadUser() {
    try {
      setLoading(true);
      const userData = await getCurrentUser();
      setUser(userData);
    } catch (error) {
      console.error('Failed to load user:', error);
    } finally {
      setLoading(false);
    }
  }

  const handleLogout = () => {
    fetch('/api/logout', {
      method: 'POST',
      credentials: 'include'
    }).then(() => {
      setUser(null);
      window.location.href = '/';
    });
  };

  if (loading) {
    return <div className="flex items-center justify-center min-h-screen">Loading...</div>;
  }

  return (
    <ThemeProvider defaultTheme="dark" storageKey="vite-ui-theme">
      <Router>
        <Layout user={user} onLogout={handleLogout}>
          <Routes>
            <Route
              path="/login"
              element={user ? <Navigate to="/dashboard" replace /> : <LoginPage onLoginSuccess={loadUser} />}
            />
            <Route
              path="/student/:id"
              element={user ? <StudentTechniques user={user} /> : <Navigate to="/login" replace />}
            />
            <Route
              path="/students"
              element={
                user && (user.role === 'coach' || user.role === 'Coach' || user.role === 'admin' || user.role === 'Admin')
                  ? <StudentsList />
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
                  ? <RegisterUserPage />
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
            <Route path="/" element={<Navigate to={user ? "/dashboard" : "/login"} replace />} />

          </Routes>
        </Layout>
        <Toaster />
      </Router>
    </ThemeProvider>
  );
}

export default App;
