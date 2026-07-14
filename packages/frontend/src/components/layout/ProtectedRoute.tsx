import { type ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import type { Role } from '@/types';
import { FullLoading } from '@/components/ui/Loading';

export default function ProtectedRoute({
  children,
  roles,
}: {
  children: ReactNode;
  roles?: Role[];
}) {
  const { user, loading, hasRole } = useAuth();
  const location = useLocation();

  if (loading) return <FullLoading />;
  if (!user) return <Navigate to="/login" state={{ from: location }} replace />;

  if (roles && !hasRole(...roles)) {
    return <Navigate to="/dashboard" replace />;
  }

  return <>{children}</>;
}
