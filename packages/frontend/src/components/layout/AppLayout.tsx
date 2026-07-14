import { useMemo, useState, type FormEvent } from 'react';
import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  LayoutDashboard,
  Network,
  Server,
  MapPin,
  Settings,
  Users,
  LogOut,
  Sun,
  Moon,
  Search,
  ChevronDown,
  Ruler,
  Building2,
  Check,
  Binary,
  Radar,
  BellRing,
  Boxes,
  FileBarChart2,
  ShieldAlert,
  Cable,
  AlertTriangle,
  DatabaseZap,
} from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useTheme } from '@/hooks/useTheme';
import { useLanguage } from '@/hooks/useLanguage';
import { useSiteScope } from '@/stores/siteScopeStore';
import { cn, initials } from '@/lib/utils';
import { Badge } from '@/components/ui/Badge';
import { SiteScopeSelector } from '@/components/layout/SiteScopeSelector';
import { api } from '@/lib/api';
import type { Site } from '@/types';
import { OrbisMark } from '@/components/layout/OrbisMark';
import { LanguageSwitcher } from '@/components/layout/LanguageSwitcher';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from '@/components/ui/Dropdown';

const NAV = [
  { to: '/dashboard', labelKey: 'dashboard', icon: LayoutDashboard },
  { to: '/diagrams', labelKey: 'diagrams', icon: Network },
  { to: '/devices', labelKey: 'devices', icon: Server },
  { to: '/source-of-truth', labelKey: 'sourceOfTruth', icon: DatabaseZap },
  { to: '/discovery', labelKey: 'discovery', icon: Radar },
  { to: '/collectors', labelKey: 'collectors', icon: Boxes },
  { to: '/alerts', labelKey: 'alerts', icon: BellRing },
  { to: '/security', labelKey: 'security', icon: ShieldAlert },
  { to: '/reports', labelKey: 'reports', icon: FileBarChart2 },
  { to: '/ipam', labelKey: 'ipam', icon: Binary },
  { to: '/dcim', labelKey: 'dcim', icon: Cable },
  { to: '/sites', labelKey: 'sites', icon: MapPin },
  { to: '/racks', labelKey: 'racks', icon: Ruler },
];

const ROLE_VARIANTS = {
  ADMIN: 'default',
  EDITOR: 'success',
  VIEWER: 'muted',
} as const;

export default function AppLayout() {
  const { user, logout, isAdmin, organizations, activeOrganization, setActiveOrganizationId } =
    useAuth();
  const { theme, toggle } = useTheme();
  const { t } = useLanguage();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const clearSiteScope = useSiteScope((s) => s.clear);
  const currentSiteId = useSiteScope((s) => s.currentSiteId);
  const role = activeOrganization?.role ?? 'VIEWER';

  const selectOrganization = (id: string) => {
    setActiveOrganizationId(id);
    clearSiteScope();
    queryClient.invalidateQueries();
  };

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-background">
      {/* ─── Sidebar ─────────────────────────────────────── */}
      <aside className="flex w-60 shrink-0 flex-col border-r bg-card/50">
        <div className="flex h-16 items-center gap-2.5 border-b px-5">
          <OrbisMark className="h-9 w-9" />
          <div>
            <p className="text-sm font-bold leading-tight">Orbis</p>
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
              {t.brandSubtitle}
            </p>
          </div>
        </div>

        {/* Active scope selector (multi-site) */}
        <SiteScopeSelector />

        <nav className="flex-1 space-y-1 overflow-y-auto p-3">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-primary/10 text-primary'
                    : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                )
              }
            >
              <item.icon className="h-4 w-4 shrink-0" />
              {t.nav[item.labelKey as keyof typeof t.nav]}
            </NavLink>
          ))}

          {isAdmin && (
            <>
              <div className="my-3 px-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                {t.nav.administration}
              </div>
              <NavLink
                to="/admin/users"
                className={({ isActive }) =>
                  cn(
                    'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                    isActive
                      ? 'bg-primary/10 text-primary'
                      : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                  )
                }
              >
                <Users className="h-4 w-4 shrink-0" />
                {t.nav.users}
              </NavLink>
            </>
          )}
        </nav>

        <div className="border-t p-3">
          <NavLink
            to="/settings"
            className={({ isActive }) =>
              cn(
                'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                isActive
                  ? 'bg-primary/10 text-primary'
                  : 'text-muted-foreground hover:bg-accent hover:text-foreground',
              )
            }
          >
            <Settings className="h-4 w-4 shrink-0" />
            {t.settings}
          </NavLink>
        </div>
      </aside>

      {/* ─── Main ───────────────────────────────────────── */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Topbar */}
        <header className="flex h-16 shrink-0 items-center justify-between border-b bg-card/50 px-6 backdrop-blur">
          <GlobalSearch siteId={currentSiteId} />

          <div className="flex items-center gap-2">
            <LanguageSwitcher />
            <NotificationsMenu siteId={currentSiteId} onNavigate={(to) => navigate(to)} />

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  className="hidden max-w-56 items-center gap-2 rounded-lg border border-input bg-background px-3 py-1.5 text-sm transition-colors hover:bg-accent md:flex"
                  title={t.activeOrganization}
                >
                  <Building2 className="h-4 w-4 text-muted-foreground" />
                  <span className="truncate">{activeOrganization?.name ?? t.organization}</span>
                  <ChevronDown className="h-4 w-4 text-muted-foreground" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-64" align="end">
                <DropdownMenuLabel>{t.activeOrganization}</DropdownMenuLabel>
                {organizations.map((org) => (
                  <DropdownMenuItem
                    key={org.id}
                    onSelect={() => selectOrganization(org.id)}
                    className="justify-between"
                  >
                    <span className="truncate">{org.name}</span>
                    <span className="flex items-center gap-2">
                      <Badge variant={ROLE_VARIANTS[org.role]}>
                        {t.roles[org.role as keyof typeof t.roles]}
                      </Badge>
                      {activeOrganization?.id === org.id && (
                        <Check className="h-4 w-4 text-primary" />
                      )}
                    </span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            <button
              onClick={toggle}
              className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              title={t.changeTheme}
            >
              {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="flex items-center gap-2 rounded-lg px-2 py-1.5 transition-colors hover:bg-accent">
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 text-xs font-semibold text-white">
                    {initials(user?.name ?? '?')}
                  </div>
                  <div className="hidden text-left sm:block">
                    <p className="text-sm font-medium leading-tight">{user?.name}</p>
                    <p className="text-[11px] text-muted-foreground">{user?.email}</p>
                  </div>
                  <ChevronDown className="h-4 w-4 text-muted-foreground" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-60">
                <DropdownMenuLabel className="flex items-center justify-between">
                  <span>{user?.name}</span>
                  <Badge variant={ROLE_VARIANTS[role]}>
                    {t.roles[role as keyof typeof t.roles]}
                  </Badge>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => navigate('/settings')}>
                  <Settings className="h-4 w-4" /> {t.settings}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => logout()}>
                  <LogOut className="h-4 w-4" /> {t.logout}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-hidden">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

function NotificationsMenu({
  siteId,
  onNavigate,
}: {
  siteId: string | null;
  onNavigate: (to: string) => void;
}) {
  const alertsQuery = useQuery({
    queryKey: ['notifications', siteId],
    queryFn: () => api.alerts.list({ status: 'open', siteId: siteId ?? undefined, limit: 6 }),
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  });

  const alerts = alertsQuery.data?.alerts ?? [];
  const openCount = alertsQuery.data?.counts.open ?? 0;
  const mentionsQuery = useQuery({
    queryKey: ['user-notifications'],
    queryFn: () => api.notifications.list(),
    refetchInterval: 30_000,
  });
  const mentions = mentionsQuery.data?.notifications ?? [];
  const mentionCount = mentionsQuery.data?.unread ?? 0;
  const totalCount = openCount + mentionCount;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className="relative flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          title="Notifications"
        >
          <BellRing className="h-4 w-4" />
          {totalCount > 0 && (
            <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold text-destructive-foreground">
              {totalCount > 9 ? '9+' : totalCount}
            </span>
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-96" align="end">
        <DropdownMenuLabel className="flex items-center justify-between">
          <span>Notifications</span>
          <Badge variant={totalCount > 0 ? 'danger' : 'success'}>{totalCount} à traiter</Badge>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {mentions.map((notification) => (
          <div key={notification.id} className="rounded-md px-2 py-2 hover:bg-accent">
            <button
              type="button"
              className="flex w-full items-start gap-2 text-left"
              onClick={() => {
                api.notifications.markRead(notification.id);
                onNavigate(
                  notification.target === 'DIAGRAM'
                    ? `/diagrams/${notification.targetId}`
                    : '/devices',
                );
              }}
            >
              <BellRing className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{notification.title}</span>
                <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                  {notification.body}
                </span>
              </span>
            </button>
          </div>
        ))}
        {alerts.length > 0 ? (
          <div className="max-h-96 overflow-y-auto p-1">
            {alerts.map((alert) => (
              <div key={alert.id} className="rounded-md px-2 py-2 hover:bg-accent">
                <button
                  type="button"
                  className="flex w-full items-start gap-2 text-left"
                  onClick={() => onNavigate('/alerts')}
                >
                  <AlertTriangle
                    className={cn(
                      'mt-0.5 h-4 w-4 shrink-0',
                      alert.severity === 'CRITICAL' ? 'text-destructive' : 'text-status-warning',
                    )}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{alert.title}</span>
                    <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                      {alert.site?.name ??
                        alert.collector?.name ??
                        alert.device?.name ??
                        'Organisation'}{' '}
                      · {formatRelativeDate(alert.createdAt)}
                    </span>
                  </span>
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p className="px-3 py-6 text-center text-sm text-muted-foreground">
            Aucune notification ouverte.
          </p>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => onNavigate('/alerts')} className="justify-center">
          Ouvrir les alertes
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

type SearchResult = {
  id: string;
  title: string;
  subtitle: string;
  to: string;
  icon: typeof Server;
};

function GlobalSearch({ siteId }: { siteId: string | null }) {
  const { language } = useLanguage();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const normalized = query.trim();
  const enabled = normalized.length >= 2;

  const devicesQuery = useQuery({
    queryKey: ['global-search-devices', { search: normalized, siteId }],
    queryFn: () => api.devices.list({ search: normalized, siteId: siteId ?? undefined }),
    enabled,
  });
  const addressesQuery = useQuery({
    queryKey: ['global-search-ipam', { search: normalized, siteId }],
    queryFn: () => api.ipam.addresses.list({ search: normalized, siteId: siteId ?? undefined }),
    enabled,
  });
  const diagramsQuery = useQuery({
    queryKey: ['global-search-diagrams', siteId],
    queryFn: () => api.diagrams.list(siteId ?? undefined),
    enabled,
  });
  const racksQuery = useQuery({
    queryKey: ['global-search-racks', siteId],
    queryFn: () => api.racks.list(siteId ?? undefined),
    enabled,
  });
  const sitesQuery = useQuery({
    queryKey: ['global-search-sites'],
    queryFn: api.sites.list,
    enabled,
  });

  const results = useMemo<SearchResult[]>(() => {
    if (!enabled) return [];
    const term = normalized.toLowerCase();
    const sites = flattenSites(sitesQuery.data?.sites ?? [])
      .filter((site) => matches(site.name, term) || matches(site.location, term))
      .slice(0, 4)
      .map((site) => ({
        id: `site-${site.id}`,
        title: site.name,
        subtitle: site.location ? `Site · ${site.location}` : 'Site',
        to: '/sites',
        icon: MapPin,
      }));
    const devices = (devicesQuery.data?.devices ?? []).slice(0, 6).map((device) => ({
      id: `device-${device.id}`,
      title: device.name,
      subtitle: ['Équipement', device.ip, device.site?.name].filter(Boolean).join(' · '),
      to: `/devices/${device.id}`,
      icon: Server,
    }));
    const addresses = (addressesQuery.data?.addresses ?? []).slice(0, 4).map((address) => ({
      id: `ip-${address.id}`,
      title: address.address,
      subtitle: ['Adresse IP', address.device?.name, address.prefix?.cidr]
        .filter(Boolean)
        .join(' · '),
      to: '/ipam',
      icon: Binary,
    }));
    const diagrams = (diagramsQuery.data?.diagrams ?? [])
      .filter((diagram) => matches(diagram.name, term) || matches(diagram.site?.name, term))
      .slice(0, 4)
      .map((diagram) => ({
        id: `diagram-${diagram.id}`,
        title: diagram.name,
        subtitle: diagram.site?.name ? `Schéma · ${diagram.site.name}` : 'Schéma',
        to: `/diagrams/${diagram.id}`,
        icon: Network,
      }));
    const racks = (racksQuery.data?.racks ?? [])
      .filter((rack) => matches(rack.name, term) || matches(rack.site?.name, term))
      .slice(0, 4)
      .map((rack) => ({
        id: `rack-${rack.id}`,
        title: rack.name,
        subtitle: rack.site?.name ? `Baie · ${rack.site.name}` : 'Baie',
        to: `/racks/${rack.id}`,
        icon: Ruler,
      }));
    return [...devices, ...addresses, ...diagrams, ...racks, ...sites].slice(0, 10);
  }, [
    addressesQuery.data?.addresses,
    devicesQuery.data?.devices,
    diagramsQuery.data?.diagrams,
    enabled,
    normalized,
    racksQuery.data?.racks,
    sitesQuery.data?.sites,
  ]);

  const loading =
    enabled &&
    (devicesQuery.isLoading ||
      addressesQuery.isLoading ||
      diagramsQuery.isLoading ||
      racksQuery.isLoading ||
      sitesQuery.isLoading);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (results[0]) {
      navigate(results[0].to);
      setQuery('');
      setOpen(false);
      return;
    }
    if (normalized) navigate(`/devices?search=${encodeURIComponent(normalized)}`);
  };

  return (
    <form onSubmit={submit} className="relative w-full max-w-md">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <input
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') setOpen(false);
        }}
        placeholder="Rechercher globalement..."
        className="h-9 w-full rounded-lg border border-input bg-background pl-9 pr-14 text-sm outline-none transition-colors placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/15"
      />
      <kbd className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 rounded border bg-muted px-1.5 text-[10px] font-medium text-muted-foreground">
        Entrée
      </kbd>
      {open && enabled && (
        <div className="absolute left-0 right-0 top-11 z-50 overflow-hidden rounded-lg border bg-popover shadow-lg">
          {loading ? (
            <p className="p-3 text-sm text-muted-foreground">Recherche en cours...</p>
          ) : results.length > 0 ? (
            <div className="max-h-96 overflow-y-auto p-1">
              {results.map((result) => (
                <button
                  key={result.id}
                  type="button"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => {
                    navigate(result.to);
                    setQuery('');
                    setOpen(false);
                  }}
                  className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left transition-colors hover:bg-accent"
                >
                  <result.icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{result.title}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {result.subtitle}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <p className="p-3 text-sm text-muted-foreground">
              {language === 'fr' ? 'Aucun résultat.' : 'No results.'}
            </p>
          )}
        </div>
      )}
    </form>
  );
}

function matches(value: string | null | undefined, term: string) {
  return value?.toLowerCase().includes(term) ?? false;
}

function flattenSites(sites: Site[]): Site[] {
  return sites.flatMap((site) => [site, ...flattenSites(site.children ?? [])]);
}

function formatRelativeDate(value: string) {
  const delta = Date.now() - new Date(value).getTime();
  const minutes = Math.max(0, Math.round(delta / 60_000));
  if (minutes < 1) return 'maintenant';
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h`;
  return new Intl.DateTimeFormat('fr-FR', { dateStyle: 'short' }).format(new Date(value));
}
