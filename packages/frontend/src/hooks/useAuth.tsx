import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react';
import { api, storage, ApiError } from '@/lib/api';
import type { Organization, Role, User } from '@/types';

interface AuthState {
  user: User | null;
  organizations: Organization[];
  activeOrganization: Organization | null;
  loading: boolean;
  canEdit: boolean;
  isAdmin: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (name: string, email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  hasRole: (...roles: Role[]) => boolean;
  hasPermission: (permission: string) => boolean;
  setActiveOrganizationId: (id: string) => void;
  refreshMe: () => Promise<void>;
}

const AuthContext = createContext<AuthState | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [loading, setLoading] = useState(true);

  const activeOrganization = (() => {
    const stored = storage.getOrg();
    return organizations.find((o) => o.id === stored) ?? organizations[0] ?? null;
  })();

  const refreshMe = useCallback(async () => {
    const data = await api.auth.me();
    setUser(data.user);
    setOrganizations(data.organizations ?? []);
    // Select the first organization when none is remembered or it no longer exists.
    const stored = storage.getOrg();
    if (!stored || !data.organizations?.some((o) => o.id === stored)) {
      if (data.organizations?.length) storage.setOrg(data.organizations[0].id);
    }
  }, []);

  useEffect(() => {
    const token = storage.getAccess();
    if (!token) {
      api.auth.refresh()
        .then((restored) => restored ? api.auth.me() : Promise.reject(new Error('Aucune session')))
        .then((data) => {
          setUser(data.user);
          setOrganizations(data.organizations ?? []);
          if (data.organizations?.length) storage.setOrg(data.organizations[0].id);
        })
        .catch(() => {
          storage.clear();
          setUser(null);
        })
        .finally(() => setLoading(false));
      return;
    }
    api.auth
      .me()
      .then((data) => {
        setUser(data.user);
        setOrganizations(data.organizations ?? []);
        const stored = storage.getOrg();
        if (!stored || !data.organizations?.some((o) => o.id === stored)) {
          if (data.organizations?.length) storage.setOrg(data.organizations[0].id);
        }
      })
      .catch(() => {
        storage.clear();
        setUser(null);
      })
      .finally(() => setLoading(false));
  }, []);

  const login = async (email: string, password: string) => {
    const { user, organizations, accessToken } = await api.auth.login(email, password);
    storage.setAccess(accessToken);
    if (organizations.length) storage.setOrg(organizations[0].id);
    setUser(user);
    setOrganizations(organizations);
  };

  const register = async (name: string, email: string, password: string) => {
    const { user, organizations, accessToken } = await api.auth.register(name, email, password);
    storage.setAccess(accessToken);
    if (organizations.length) storage.setOrg(organizations[0].id);
    setUser(user);
    setOrganizations(organizations);
  };

  const logout = async () => {
    try {
      await api.auth.logout();
    } catch {
      // Be tolerant of malformed persisted state.
    }
    storage.clear();
    setUser(null);
    setOrganizations([]);
  };

  const setActiveOrganizationId = useCallback((id: string) => {
    storage.setOrg(id);
    // Force re-render via state bump
    setOrganizations((prev) => [...prev]);
  }, []);

  const role = activeOrganization?.role;
  const permissions = activeOrganization?.permissions ?? [];
  const value: AuthState = {
    user,
    organizations,
    activeOrganization,
    loading,
    canEdit: role === 'ADMIN' || role === 'EDITOR' || permissions.some((permission) => permission.endsWith(':write') || permission.endsWith(':admin')),
    isAdmin: role === 'ADMIN',
    login,
    register,
    logout,
    hasRole: (...roles) => !!role && roles.includes(role),
    hasPermission: (permission) => role === 'ADMIN' || permissions.includes(permission),
    setActiveOrganizationId,
    refreshMe,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth doit être utilisé dans <AuthProvider>');
  return ctx;
}

export { ApiError };
