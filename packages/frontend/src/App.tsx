import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './hooks/useAuth';
import { Loading } from './components/ui/Loading';
import AppLayout from './components/layout/AppLayout';
import ProtectedRoute from './components/layout/ProtectedRoute';

const LoginPage = lazy(() => import('./pages/LoginPage'));
const RegisterPage = lazy(() => import('./pages/RegisterPage'));
const ForgotPasswordPage = lazy(() => import('./pages/ForgotPasswordPage'));
const ResetPasswordPage = lazy(() => import('./pages/ResetPasswordPage'));
const SsoCallbackPage = lazy(() => import('./pages/SsoCallbackPage'));
const DashboardPage = lazy(() => import('./pages/DashboardPage'));
const SitesPage = lazy(() => import('./pages/SitesPage'));
const DevicesPage = lazy(() => import('./pages/DevicesPage'));
const DiagramEditorPage = lazy(() => import('./pages/DiagramEditorPage'));
const DiagramsListPage = lazy(() => import('./pages/DiagramsListPage'));
const RackViewPage = lazy(() => import('./pages/RackViewPage'));
const IpamPage = lazy(() => import('./pages/IpamPage'));
const DcimPage = lazy(() => import('./pages/DcimPage'));
const DiscoveryPage = lazy(() => import('./pages/DiscoveryPage'));
const AlertsPage = lazy(() => import('./pages/AlertsPage'));
const CollectorsPage = lazy(() => import('./pages/CollectorsPage'));
const ReportsPage = lazy(() => import('./pages/ReportsPage'));
const SecurityPage = lazy(() => import('./pages/SecurityPage'));
const AdminUsersPage = lazy(() => import('./pages/AdminUsersPage'));
const DeviceDetailPage = lazy(() => import('./pages/DeviceDetailPage'));
const SettingsPage = lazy(() => import('./pages/SettingsPage'));
const SourceOfTruthPage = lazy(() => import('./pages/SourceOfTruthPage'));

export default function App() {
  const { loading } = useAuth();

  if (loading) {
    return (
      <div className="flex h-screen w-screen items-center justify-center">
        <Loading size="lg" />
      </div>
    );
  }

  return (
    <Suspense
      fallback={
        <div className="flex h-screen items-center justify-center">
          <Loading size="lg" />
        </div>
      }
    >
      <Routes>
        {/* Public routes */}
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route path="/sso/callback" element={<SsoCallbackPage />} />

        {/* Protected routes */}
        <Route
          element={
            <ProtectedRoute>
              <AppLayout />
            </ProtectedRoute>
          }
        >
          <Route index element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/sites" element={<SitesPage />} />
          <Route path="/diagrams" element={<DiagramsListPage />} />
          <Route path="/diagrams/:id" element={<DiagramEditorPage />} />
          <Route path="/devices" element={<DevicesPage />} />
          <Route path="/devices/:id" element={<DeviceDetailPage />} />
          <Route path="/source-of-truth" element={<SourceOfTruthPage />} />
          <Route path="/discovery" element={<DiscoveryPage />} />
          <Route path="/collectors" element={<CollectorsPage />} />
          <Route path="/alerts" element={<AlertsPage />} />
          <Route path="/security" element={<SecurityPage />} />
          <Route path="/reports" element={<ReportsPage />} />
          <Route path="/ipam" element={<IpamPage />} />
          <Route path="/dcim" element={<DcimPage />} />
          <Route path="/racks" element={<RackViewPage />} />
          <Route path="/racks/:id" element={<RackViewPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route
            path="/admin/users"
            element={
              <ProtectedRoute roles={['ADMIN']}>
                <AdminUsersPage />
              </ProtectedRoute>
            }
          />
        </Route>

        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </Suspense>
  );
}
