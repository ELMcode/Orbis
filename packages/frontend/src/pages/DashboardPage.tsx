import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Clock3,
  FileBarChart2,
  LayoutGrid,
  MapPin,
  Network,
  Radar,
  Server,
  ShieldAlert,
  SlidersHorizontal,
  TrendingUp,
} from 'lucide-react';
import { api } from '@/lib/api';
import { DEVICE_STATUSES, DEVICE_TYPES } from '@/lib/devices';
import type { DeviceStatus } from '@/types';
import { PageContainer, PageHeader } from '@/components/layout/PageHeader';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { FullLoading } from '@/components/ui/Loading';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/Dropdown';
import { useAuth } from '@/hooks/useAuth';
import { cn } from '@/lib/utils';
import { useCurrentSite } from '@/hooks/useCurrentSite';
import { useLanguage } from '@/hooks/useLanguage';

const DASHBOARD_PREFS_KEY = 'orbis_dashboard_sections';

type DashboardSection = 'types' | 'status' | 'risks' | 'collectors' | 'watch' | 'activity';
type DashboardLabels = {
  firstScope: string;
  createSite: string;
  installCollector: string;
  addCollector: string;
  importOrDiscover: string;
  launchDiscovery: string;
  documentTopology: string;
  createDiagram: string;
  onboarding: string;
  onboardingDescription: string;
  done: string;
};
type DashboardPrefs = Record<DashboardSection, boolean>;

const DEFAULT_PREFS: DashboardPrefs = {
  types: true,
  status: true,
  risks: true,
  collectors: true,
  watch: true,
  activity: true,
};

export default function DashboardPage() {
  const { user } = useAuth();
  const { siteId } = useCurrentSite();
  const { t, language } = useLanguage();
  const sectionLabels: Record<DashboardSection, string> = {
    types: t.dashboard.typeDistribution,
    status: t.dashboard.globalStatus,
    risks: t.dashboard.securityRisks,
    collectors: 'Collectors',
    watch: t.dashboard.watch,
    activity: t.dashboard.recentActivity,
  };
  const [sections, setSections] = useState<DashboardPrefs>(() => loadDashboardPrefs());

  useEffect(() => {
    localStorage.setItem(DASHBOARD_PREFS_KEY, JSON.stringify(sections));
  }, [sections]);

  const statsQuery = useQuery({
    queryKey: ['stats', siteId],
    queryFn: () => api.devices.stats(siteId),
  });
  const alertsQuery = useQuery({
    queryKey: ['alerts-dashboard', siteId],
    queryFn: () => api.alerts.list({ status: 'open', siteId: siteId ?? undefined, limit: 5 }),
  });
  const collectorsQuery = useQuery({
    queryKey: ['collectors-dashboard', siteId],
    queryFn: () => api.collectors.list({ siteId: siteId ?? undefined }),
  });
  const securityQuery = useQuery({
    queryKey: ['security-dashboard', siteId],
    queryFn: () => api.security.summary({ siteId: siteId ?? undefined }),
  });
  const schedulesQuery = useQuery({
    queryKey: ['report-schedules-dashboard'],
    queryFn: api.reports.schedules,
  });
  const auditQuery = useQuery({
    queryKey: ['audit-dashboard'],
    queryFn: () => api.security.audit({ limit: 8 }),
  });

  const data = statsQuery.data;
  const isLoading = statsQuery.isLoading || !data;
  const openAlerts = alertsQuery.data?.counts.open ?? data?.warnings.length ?? 0;
  const criticalAlerts = alertsQuery.data?.counts.critical ?? 0;
  const collectors = collectorsQuery.data?.collectors ?? [];
  const activeCollectors = collectors.filter((collector) => collector.status === 'ACTIVE').length;
  const activeSchedules =
    schedulesQuery.data?.schedules.filter((schedule) => schedule.active).length ?? 0;
  const security = securityQuery.data;

  const visibleSections = useMemo(
    () =>
      Object.entries(sections)
        .filter(([, enabled]) => enabled)
        .map(([key]) => key as DashboardSection),
    [sections],
  );

  if (isLoading) {
    return (
      <PageContainer>
        <PageHeader title={t.dashboard.title} />
        <FullLoading />
      </PageContainer>
    );
  }

  const stats = [
    {
      label: t.dashboard.equipment,
      value: data.total,
      icon: Server,
      color: 'from-sky-500 to-blue-600',
      to: '/devices',
    },
    {
      label: t.dashboard.sites,
      value: data.sitesCount,
      icon: MapPin,
      color: 'from-emerald-500 to-teal-600',
      to: '/sites',
    },
    {
      label: t.dashboard.diagrams,
      value: data.diagramsCount,
      icon: Network,
      color: 'from-violet-500 to-fuchsia-600',
      to: '/diagrams',
    },
    {
      label: t.dashboard.openAlerts,
      value: openAlerts,
      icon: AlertTriangle,
      color: 'from-amber-500 to-orange-600',
      to: '/alerts',
      meta: criticalAlerts > 0 ? `${criticalAlerts} ${t.dashboard.critical}` : undefined,
    },
    {
      label: t.dashboard.activeCollectors,
      value: activeCollectors,
      icon: Radar,
      color: 'from-cyan-500 to-emerald-600',
      to: '/collectors',
      meta: `${collectors.length} ${t.dashboard.total}`,
    },
    {
      label: t.dashboard.activeReports,
      value: activeSchedules,
      icon: FileBarChart2,
      color: 'from-slate-500 to-zinc-700',
      to: '/reports',
    },
    {
      label: t.dashboard.securityScore,
      value: security?.score ?? 'n/a',
      icon: ShieldAlert,
      color: 'from-rose-500 to-red-600',
      to: '/security',
      meta: security ? `${security.counts.total} ${t.dashboard.risks}` : undefined,
    },
    {
      label: t.dashboard.scope,
      value: siteId ? t.dashboard.site : t.dashboard.organizationShort,
      icon: LayoutGrid,
      color: 'from-indigo-500 to-blue-700',
      to: '/sites',
    },
  ];

  return (
    <PageContainer>
      <PageHeader
        title={t.dashboard.title}
        description={user?.name ? t.dashboard.connectedView : t.dashboard.view}
        actions={
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline">
                <SlidersHorizontal className="h-4 w-4" /> {t.dashboard.customize}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-64" align="end">
              <DropdownMenuLabel>{t.dashboard.visibleBlocks}</DropdownMenuLabel>
              {visibleSections.length === 0 && (
                <p className="px-2 pb-1 text-xs text-muted-foreground">
                  {t.dashboard.keepOneBlock}
                </p>
              )}
              <DropdownMenuSeparator />
              {(Object.keys(sectionLabels) as DashboardSection[]).map((section) => (
                <DropdownMenuCheckboxItem
                  key={section}
                  checked={sections[section]}
                  onCheckedChange={(checked) => {
                    if (!checked && visibleSections.length <= 1) return;
                    setSections((current) => ({ ...current, [section]: checked }));
                  }}
                >
                  {sectionLabels[section]}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        }
      />

      <div className="mt-6 grid grid-cols-1 gap-4 px-6 sm:grid-cols-2 xl:grid-cols-4">
        {stats.map((s) => (
          <MetricCard key={s.label} {...s} openLabel={t.dashboard.open} />
        ))}
      </div>

      <OnboardingChecklist
        labels={t.dashboard}
        sites={data.sitesCount}
        collectors={collectors.length}
        devices={data.total}
        diagrams={data.diagramsCount}
      />

      <div className="mt-6 grid gap-4 px-6 lg:grid-cols-3">
        {sections.types && (
          <Card className="lg:col-span-2">
            <div className="flex items-center justify-between border-b p-5">
              <div className="flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-muted-foreground" />
                <h3 className="font-semibold">{t.dashboard.typeDistribution}</h3>
              </div>
              <Badge variant="muted">
                {data.total} {t.dashboard.allEquipment}
              </Badge>
            </div>
            <div className="space-y-3 p-5">
              {data.byType
                .sort((a, b) => b._count - a._count)
                .slice(0, 8)
                .map((row) => {
                  const pct = data.total > 0 ? (row._count / data.total) * 100 : 0;
                  const meta = DEVICE_TYPES[row.type as keyof typeof DEVICE_TYPES];
                  return (
                    <div key={row.type} className="flex items-center gap-3">
                      <div className="flex w-40 min-w-0 items-center gap-2 text-sm">
                        <meta.icon className="h-4 w-4 shrink-0" style={{ color: meta.color }} />
                        <span className="truncate">{meta?.label ?? row.type}</span>
                      </div>
                      <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full rounded-full transition-all"
                          style={{ width: `${pct}%`, backgroundColor: meta.color }}
                        />
                      </div>
                      <span className="w-8 text-right text-sm font-medium tabular-nums">
                        {row._count}
                      </span>
                    </div>
                  );
                })}
              {data.byType.length === 0 && (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  {t.dashboard.noEquipment}
                </p>
              )}
            </div>
          </Card>
        )}

        {sections.status && (
          <Card>
            <div className="flex items-center gap-2 border-b p-5">
              <Activity className="h-4 w-4 text-muted-foreground" />
              <h3 className="font-semibold">{t.dashboard.globalStatus}</h3>
            </div>
            <div className="space-y-3 p-5">
              {data.byStatus.map((row) => {
                const meta = DEVICE_STATUSES[row.status as DeviceStatus];
                const pct = data.total > 0 ? Math.round((row._count / data.total) * 100) : 0;
                return (
                  <div key={row.status} className="flex items-center justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className={cn('h-2 w-2 shrink-0 rounded-full', meta.dot)} />
                      <span className="truncate text-sm">{meta.label}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium tabular-nums">{row._count}</span>
                      <span className="text-xs text-muted-foreground tabular-nums">{pct}%</span>
                    </div>
                  </div>
                );
              })}
              {data.byStatus.length === 0 && (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  {t.dashboard.noData}
                </p>
              )}
            </div>
          </Card>
        )}
      </div>

      <div className="mt-4 grid gap-4 px-6 xl:grid-cols-2">
        {sections.risks && security && (
          <Card>
            <div className="flex items-center justify-between border-b p-5">
              <div className="flex items-center gap-2">
                <ShieldAlert className="h-4 w-4 text-destructive" />
                <h3 className="font-semibold">{t.dashboard.securityRisks}</h3>
              </div>
              <Button variant="ghost" size="sm" asChild>
                <Link to="/security">
                  {t.dashboard.analyze} <ArrowRight className="h-3 w-3" />
                </Link>
              </Button>
            </div>
            <div className="divide-y">
              {security.risks.slice(0, 5).map((risk) => (
                <Link
                  key={risk.id}
                  to="/security"
                  className="flex items-center justify-between gap-3 px-5 py-3 transition-colors hover:bg-accent"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{risk.title}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {risk.device?.name ??
                        risk.collector?.name ??
                        risk.site?.name ??
                        'Organisation'}
                    </p>
                  </div>
                  <Badge
                    className="shrink-0"
                    variant={
                      risk.severity === 'CRITICAL' || risk.severity === 'HIGH'
                        ? 'danger'
                        : 'warning'
                    }
                  >
                    {risk.severity}
                  </Badge>
                </Link>
              ))}
              {security.risks.length === 0 && (
                <div className="flex items-center gap-3 p-5">
                  <CheckCircle2 className="h-5 w-5 text-status-online" />
                  <p className="text-sm font-medium">{t.dashboard.noOpenRisk}</p>
                </div>
              )}
            </div>
          </Card>
        )}

        {sections.collectors && (
          <Card>
            <div className="flex items-center justify-between border-b p-5">
              <div className="flex items-center gap-2">
                <Radar className="h-4 w-4 text-muted-foreground" />
                <h3 className="font-semibold">Collectors</h3>
              </div>
              <Button variant="ghost" size="sm" asChild>
                <Link to="/collectors">
                  {t.dashboard.manage} <ArrowRight className="h-3 w-3" />
                </Link>
              </Button>
            </div>
            <div className="divide-y">
              {collectors.slice(0, 5).map((collector) => (
                <Link
                  key={collector.id}
                  to="/collectors"
                  className="flex items-center justify-between gap-3 px-5 py-3 transition-colors hover:bg-accent"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{collector.name}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {collector.site?.name ?? t.dashboard.organization}
                      {collector.lastSeenAt
                        ? ` · ${formatDate(collector.lastSeenAt, language)}`
                        : ` · ${t.dashboard.neverSeen}`}
                    </p>
                  </div>
                  <Badge
                    className="shrink-0"
                    variant={
                      collector.status === 'ACTIVE'
                        ? 'success'
                        : collector.status === 'ERROR'
                          ? 'danger'
                          : 'outline'
                    }
                  >
                    {collector.status}
                  </Badge>
                </Link>
              ))}
              {collectors.length === 0 && (
                <p className="p-5 text-sm text-muted-foreground">{t.dashboard.noCollector}</p>
              )}
            </div>
          </Card>
        )}
      </div>

      {sections.watch && (
        <div className="mt-4 px-6">
          {data.warnings.length > 0 ? (
            <Card>
              <div className="flex items-center justify-between border-b p-5">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-status-warning" />
                  <h3 className="font-semibold">{t.dashboard.watch}</h3>
                </div>
                <Button variant="ghost" size="sm" asChild>
                  <Link to="/devices">
                    {t.dashboard.viewAll} <ArrowRight className="h-3 w-3" />
                  </Link>
                </Button>
              </div>
              <div className="divide-y">
                {data.warnings.slice(0, 5).map((w) => {
                  const meta = DEVICE_STATUSES[w.status];
                  const typeMeta = DEVICE_TYPES[w.type];
                  return (
                    <Link
                      key={w.id}
                      to={`/devices/${w.id}`}
                      className="flex items-center justify-between gap-3 px-5 py-3 transition-colors hover:bg-accent"
                    >
                      <div className="flex min-w-0 items-center gap-3">
                        <typeMeta.icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">{w.name}</p>
                          <p className="truncate text-xs text-muted-foreground">{typeMeta.label}</p>
                        </div>
                      </div>
                      <Badge
                        className="shrink-0"
                        variant={w.status === 'OFFLINE' ? 'danger' : 'warning'}
                      >
                        <span className={cn('h-1.5 w-1.5 rounded-full', meta.dot)} />
                        {meta.label}
                      </Badge>
                    </Link>
                  );
                })}
              </div>
            </Card>
          ) : data.total > 0 ? (
            <Card className="flex items-center gap-3 border-status-online/20 bg-status-online/5 p-5">
              <CheckCircle2 className="h-5 w-5 text-status-online" />
              <p className="text-sm font-medium">{t.dashboard.allOperational}</p>
            </Card>
          ) : null}
        </div>
      )}

      {sections.activity && (
        <div className="mt-4 px-6 pb-6">
          <Card>
            <div className="flex items-center justify-between border-b p-5">
              <div className="flex items-center gap-2">
                <Clock3 className="h-4 w-4 text-muted-foreground" />
                <h3 className="font-semibold">{t.dashboard.recentActivity}</h3>
              </div>
              <Button variant="ghost" size="sm" asChild>
                <Link to="/security">
                  {t.dashboard.audit} <ArrowRight className="h-3 w-3" />
                </Link>
              </Button>
            </div>
            <div className="divide-y">
              {(auditQuery.data?.logs ?? []).map((log) => (
                <Link
                  key={log.id}
                  to="/security"
                  className="flex items-center justify-between gap-4 px-5 py-3 transition-colors hover:bg-accent"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">
                      {formatAuditAction(log.action, language)}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {log.user?.name ?? log.user?.email ?? t.dashboard.organization}
                      {log.target ? ` · ${formatAuditTarget(log.target, language)}` : ''}
                    </p>
                  </div>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {formatDate(log.createdAt, language)}
                  </span>
                </Link>
              ))}
              {!auditQuery.isLoading && (auditQuery.data?.logs.length ?? 0) === 0 && (
                <p className="p-5 text-sm text-muted-foreground">{t.dashboard.noRecentActivity}</p>
              )}
              {auditQuery.isLoading && (
                <p className="p-5 text-sm text-muted-foreground">{t.dashboard.loadingActivity}</p>
              )}
            </div>
          </Card>
        </div>
      )}
    </PageContainer>
  );
}

function OnboardingChecklist({
  sites,
  collectors,
  devices,
  diagrams,
  labels,
}: {
  sites: number;
  collectors: number;
  devices: number;
  diagrams: number;
  labels: DashboardLabels;
}) {
  if (sites > 0 && collectors > 0 && (devices > 0 || diagrams > 0)) return null;
  const steps = [
    { label: labels.firstScope, complete: sites > 0, to: '/sites', action: labels.createSite },
    {
      label: labels.installCollector,
      complete: collectors > 0,
      to: '/collectors',
      action: labels.addCollector,
    },
    {
      label: labels.importOrDiscover,
      complete: devices > 0,
      to: '/discovery',
      action: labels.launchDiscovery,
    },
    {
      label: labels.documentTopology,
      complete: diagrams > 0,
      to: '/diagrams',
      action: labels.createDiagram,
    },
  ];
  return (
    <Card className="mt-6 px-6">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b py-4">
        <div>
          <h2 className="text-sm font-semibold">{labels.onboarding}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{labels.onboardingDescription}</p>
        </div>
        <Badge variant="outline">
          {steps.filter((step) => step.complete).length}/{steps.length}
        </Badge>
      </div>
      <div className="grid gap-2 py-4 md:grid-cols-2">
        {steps.map((step) => (
          <Link
            key={step.label}
            to={step.to}
            className="flex min-h-12 items-center justify-between gap-3 rounded-md border px-3 py-2 transition-colors hover:bg-muted/50"
          >
            <span className="flex items-center gap-2 text-sm font-medium">
              {step.complete ? (
                <CheckCircle2 className="h-4 w-4 text-status-online" />
              ) : (
                <Clock3 className="h-4 w-4 text-muted-foreground" />
              )}
              {step.label}
            </span>
            <span className="shrink-0 text-xs text-primary">
              {step.complete ? labels.done : step.action}
            </span>
          </Link>
        ))}
      </div>
    </Card>
  );
}

function MetricCard({
  label,
  value,
  icon: Icon,
  color,
  to,
  meta,
  openLabel,
}: {
  label: string;
  value: string | number;
  icon: typeof Server;
  color: string;
  to: string;
  meta?: string;
  openLabel: string;
}) {
  return (
    <Link to={to} className="block h-full">
      <Card className="group relative h-full min-h-[132px] overflow-hidden transition-all hover:border-primary/30 hover:shadow-md">
        <div className="flex h-full items-center justify-between gap-3 p-5 pb-8">
          <div className="min-w-0">
            <p className="truncate text-sm text-muted-foreground">{label}</p>
            <p className="mt-1 truncate text-3xl font-bold tracking-tight">{value}</p>
            <p className="mt-1 min-h-4 truncate text-xs text-muted-foreground">
              {meta ?? '\u00a0'}
            </p>
          </div>
          <div
            className={cn(
              'flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br text-white shadow-lg',
              color,
            )}
          >
            <Icon className="h-5 w-5" />
          </div>
        </div>
        <div className="absolute inset-x-0 bottom-0 flex items-center gap-1 bg-primary/0 px-5 py-2 text-xs font-medium text-primary opacity-0 transition-all group-hover:bg-primary/5 group-hover:opacity-100">
          {openLabel} <ArrowRight className="h-3 w-3" />
        </div>
      </Card>
    </Link>
  );
}

function loadDashboardPrefs(): DashboardPrefs {
  try {
    const parsed = JSON.parse(
      localStorage.getItem(DASHBOARD_PREFS_KEY) ?? 'null',
    ) as Partial<DashboardPrefs> | null;
    return { ...DEFAULT_PREFS, ...(parsed ?? {}) };
  } catch {
    return DEFAULT_PREFS;
  }
}

function formatDate(value: string, language: 'fr' | 'en') {
  return new Intl.DateTimeFormat(language === 'en' ? 'en-GB' : 'fr-FR', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(value));
}

function formatAuditAction(action: string, language: 'fr' | 'en') {
  const labels: Record<'fr' | 'en', Record<string, string>> = {
    fr: {
      'auth.login': 'Connexion',
      'auth.logout': 'Déconnexion',
      'device.create': 'Équipement créé',
      'device.update': 'Équipement modifié',
      'device.delete': 'Équipement supprimé',
      'site.create': 'Périmètre créé',
      'site.update': 'Périmètre modifié',
      'site.delete': 'Périmètre supprimé',
      'diagram.create': 'Schéma créé',
      'diagram.update': 'Schéma modifié',
      'diagram.delete': 'Schéma supprimé',
      'collector.create': 'Collector créé',
      'collector.update': 'Collector modifié',
      'collector.delete': 'Collector supprimé',
      'alert.acknowledge': 'Alerte acquittée',
    },
    en: {
      'auth.login': 'Signed in',
      'auth.logout': 'Signed out',
      'device.create': 'Device created',
      'device.update': 'Device updated',
      'device.delete': 'Device deleted',
      'site.create': 'Scope created',
      'site.update': 'Scope updated',
      'site.delete': 'Scope deleted',
      'diagram.create': 'Diagram created',
      'diagram.update': 'Diagram updated',
      'diagram.delete': 'Diagram deleted',
      'collector.create': 'Collector created',
      'collector.update': 'Collector updated',
      'collector.delete': 'Collector deleted',
      'alert.acknowledge': 'Alert acknowledged',
    },
  };
  return labels[language][action] ?? action.replace(/[._-]/g, ' ');
}

function formatAuditTarget(target: string, language: 'fr' | 'en') {
  const labels: Record<'fr' | 'en', Record<string, string>> = {
    fr: {
      device: 'équipement',
      site: 'périmètre',
      diagram: 'schéma',
      collector: 'collector',
      alert: 'alerte',
      user: 'utilisateur',
      organization: 'organisation',
    },
    en: {
      device: 'device',
      site: 'scope',
      diagram: 'diagram',
      collector: 'collector',
      alert: 'alert',
      user: 'user',
      organization: 'organization',
    },
  };
  return labels[language][target] ?? target;
}
