import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Activity,
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  Gauge,
  Mail,
  MessageSquare,
  RotateCw,
  Settings2,
  ShieldAlert,
  UsersRound,
  Webhook,
} from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import type {
  AlertChannel,
  AlertSettings,
  DiscoveryEvent,
  DiscoveryEventSeverity,
  DiscoveryEventType,
  Incident,
  MaintenanceWindow,
  MonitoringPolicy,
} from '@/types';
import { PageContainer, PageHeader } from '@/components/layout/PageHeader';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Input, Textarea } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Field } from '@/components/ui/Label';
import { FullLoading } from '@/components/ui/Loading';
import { useAuth } from '@/hooks/useAuth';
import { useCurrentSite } from '@/hooks/useCurrentSite';
import { useToast } from '@/hooks/useToast';
import { cn } from '@/lib/utils';
import { localized, useLanguage } from '@/hooks/useLanguage';

const SEVERITY_LABELS: Record<DiscoveryEventSeverity, string> = {
  INFO: 'Info',
  WARNING: 'Warning',
  CRITICAL: 'Critique',
};

const TYPE_LABELS: Record<DiscoveryEventType, string> = {
  NEW_DEVICE: 'Nouvel équipement',
  DEVICE_REAPPEARED: 'Équipement revenu',
  DEVICE_DOWN: 'Équipement down',
  IP_CHANGED: 'IP changée',
  PORTS_CHANGED: 'Ports changés',
  IP_CONFLICT: 'Conflit IP',
  MAC_CONFLICT: 'Conflit MAC',
  LATENCY_HIGH: 'Latence élevée',
};

const TYPE_LABELS_EN: Record<DiscoveryEventType, string> = {
  NEW_DEVICE: 'New device',
  DEVICE_REAPPEARED: 'Device back online',
  DEVICE_DOWN: 'Device down',
  IP_CHANGED: 'IP changed',
  PORTS_CHANGED: 'Ports changed',
  IP_CONFLICT: 'IP conflict',
  MAC_CONFLICT: 'MAC conflict',
  LATENCY_HIGH: 'High latency',
};

const EVENT_TYPES = Object.keys(TYPE_LABELS) as DiscoveryEventType[];

export default function AlertsPage() {
  const { t, language } = useLanguage();
  const { isAdmin } = useAuth();
  const { siteId } = useCurrentSite();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<'open' | 'acknowledged' | 'all'>('open');
  const [severity, setSeverity] = useState<DiscoveryEventSeverity | ''>('');
  const [settingsOpen, setSettingsOpen] = useState(false);

  const alertsQuery = useQuery({
    queryKey: ['alerts', status, severity, siteId],
    queryFn: () => api.alerts.list({ status, severity: severity || undefined, siteId, limit: 80 }),
  });
  const settingsQuery = useQuery({
    queryKey: ['alert-settings'],
    queryFn: () => api.alerts.settings(),
  });
  const availabilityQuery = useQuery({
    queryKey: ['monitoring-availability', siteId],
    queryFn: () => api.monitoring.availability({ siteId, days: 30 }),
  });
  const incidentsQuery = useQuery({
    queryKey: ['monitoring-incidents', siteId],
    queryFn: () => api.monitoring.incidents({ siteId, status: 'OPEN' }),
  });
  const maintenanceQuery = useQuery({
    queryKey: ['monitoring-maintenance'],
    queryFn: () => api.monitoring.maintenance(),
  });
  const policyQuery = useQuery({
    queryKey: ['monitoring-policy'],
    queryFn: () => api.monitoring.policy(),
  });

  const acknowledge = useMutation({
    mutationFn: (id: string) => api.alerts.acknowledge(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['alerts'] });
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
      toast.success(t.alerts.acknowledged);
    },
    onError: (err) =>
      toast.error(t.alerts.acknowledgeFailed, err instanceof ApiError ? err.message : undefined),
  });

  const saveSettings = useMutation({
    mutationFn: (settings: AlertSettingsForm) => api.alerts.updateSettings(settings),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['alert-settings'] });
      toast.success(t.alerts.saved);
    },
    onError: (err) =>
      toast.error(t.alerts.invalidConfig, err instanceof ApiError ? err.message : undefined),
  });
  const savePolicy = useMutation({
    mutationFn: (policy: MonitoringPolicyForm) => api.monitoring.updatePolicy(policy),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['monitoring-policy'] });
      queryClient.invalidateQueries({ queryKey: ['alerts'] });
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
      toast.success(t.alerts.monitoringSaved);
    },
    onError: (err) =>
      toast.error(t.alerts.invalidPolicy, err instanceof ApiError ? err.message : undefined),
  });
  const updateIncident = useMutation({
    mutationFn: ({ id, status }: { id: string; status: 'ACKNOWLEDGED' | 'RESOLVED' }) =>
      api.monitoring.updateIncident(id, { status }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['monitoring-incidents'] });
      toast.success(t.alerts.incidentUpdated);
    },
    onError: (err) =>
      toast.error(t.alerts.incidentNotUpdated, err instanceof ApiError ? err.message : undefined),
  });
  const createMaintenance = useMutation({
    mutationFn: (data: MaintenanceForm) => api.monitoring.createMaintenance(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['monitoring-maintenance'] });
      toast.success(t.alerts.maintenanceScheduled);
    },
    onError: (err) =>
      toast.error(t.alerts.maintenanceInvalid, err instanceof ApiError ? err.message : undefined),
  });

  if (
    alertsQuery.isLoading ||
    settingsQuery.isLoading ||
    !alertsQuery.data ||
    !settingsQuery.data
  ) {
    return (
      <PageContainer>
        <PageHeader title={t.alerts.title} />
        <FullLoading />
      </PageContainer>
    );
  }

  const { alerts, counts } = alertsQuery.data;
  const settings = settingsQuery.data.settings;

  return (
    <PageContainer>
      <PageHeader
        title={t.alerts.title}
        description={localized(
          language,
          'Événements de découverte à traiter, notifications sortantes et acquittements.',
          'Discovery events, outbound notifications and acknowledgements.',
        )}
        actions={
          <>
            <Button variant="outline" onClick={() => alertsQuery.refetch()}>
              <RotateCw className="h-4 w-4" /> Actualiser
            </Button>
            {isAdmin && (
              <Button
                variant={settingsOpen ? 'secondary' : 'outline'}
                onClick={() => setSettingsOpen((v) => !v)}
              >
                <Settings2 className="h-4 w-4" /> Configuration
              </Button>
            )}
          </>
        }
      />

      <div className="mt-6 grid grid-cols-2 gap-4 px-6 lg:grid-cols-4">
        <MetricCard label={t.alerts.open} value={counts.open} icon={ShieldAlert} tone="critical" />
        <MetricCard
          label={t.alerts.critical}
          value={counts.critical}
          icon={AlertTriangle}
          tone="critical"
        />
        <MetricCard
          label={t.alerts.warning}
          value={counts.warning}
          icon={AlertTriangle}
          tone="warning"
        />
        <MetricCard label={t.alerts.info} value={counts.info} icon={CheckCircle2} tone="info" />
      </div>

      {availabilityQuery.data && incidentsQuery.data && maintenanceQuery.data && (
        <div className="mt-6 px-6">
          <MonitoringPanel
            availability={availabilityQuery.data.summary}
            incidents={incidentsQuery.data.incidents}
            maintenance={maintenanceQuery.data.windows}
            policy={policyQuery.data?.policy}
            isAdmin={isAdmin}
            savingPolicy={savePolicy.isPending}
            updatingIncident={updateIncident.isPending}
            creatingMaintenance={createMaintenance.isPending}
            onSavePolicy={(value) => savePolicy.mutate(value)}
            onUpdateIncident={(id, status) => updateIncident.mutate({ id, status })}
            onCreateMaintenance={(value) => createMaintenance.mutate(value)}
          />
        </div>
      )}

      {settingsOpen && isAdmin && (
        <div className="mt-6 px-6">
          <AlertSettingsPanel
            settings={settings}
            saving={saveSettings.isPending}
            onSave={(value) => saveSettings.mutate(value)}
          />
        </div>
      )}

      <div className="mt-6 px-6">
        <Card>
          <div className="flex flex-wrap items-center justify-between gap-3 border-b p-4">
            <div className="flex flex-wrap items-center gap-2">
              <Select
                value={status}
                onChange={(event) => setStatus(event.target.value as typeof status)}
                className="w-44"
              >
                <option value="open">{t.alerts.open}</option>
                <option value="acknowledged">{t.alerts.acknowledgedPlural}</option>
                <option value="all">{t.alerts.all}</option>
              </Select>
              <Select
                value={severity}
                onChange={(event) => setSeverity(event.target.value as DiscoveryEventSeverity | '')}
                className="w-44"
              >
                <option value="">{t.alerts.allSeverities}</option>
                <option value="CRITICAL">{t.alerts.critical}</option>
                <option value="WARNING">{t.alerts.warning}</option>
                <option value="INFO">{t.alerts.info}</option>
              </Select>
            </div>
            <Badge variant={hasActiveNotificationChannel(settings) ? 'success' : 'muted'}>
              {hasActiveNotificationChannel(settings)
                ? 'Notifications actives'
                : 'Notifications désactivées'}
            </Badge>
          </div>

          <div className="divide-y">
            {alerts.map((alert) => (
              <AlertRow
                key={alert.id}
                alert={alert}
                acknowledging={acknowledge.isPending}
                onAcknowledge={() => acknowledge.mutate(alert.id)}
              />
            ))}
            {alerts.length === 0 && (
              <div className="flex flex-col items-center justify-center p-10 text-center">
                <CheckCircle2 className="h-8 w-8 text-status-online" />
                <p className="mt-3 text-sm font-medium">{t.alerts.noAlert}</p>
                <p className="mt-1 text-xs text-muted-foreground">{t.alerts.upcoming}</p>
              </div>
            )}
          </div>
        </Card>
      </div>
    </PageContainer>
  );
}

function MonitoringPanel({
  availability,
  incidents,
  maintenance,
  policy,
  isAdmin,
  savingPolicy,
  updatingIncident,
  creatingMaintenance,
  onSavePolicy,
  onUpdateIncident,
  onCreateMaintenance,
}: {
  availability: {
    availabilityPct: number;
    targetPct: number;
    latencyAvgMs?: number | null;
    latencyP95Ms?: number | null;
    targetMet: boolean;
  };
  incidents: Incident[];
  maintenance: MaintenanceWindow[];
  policy?: MonitoringPolicy;
  isAdmin: boolean;
  savingPolicy: boolean;
  updatingIncident: boolean;
  creatingMaintenance: boolean;
  onSavePolicy: (value: MonitoringPolicyForm) => void;
  onUpdateIncident: (id: string, status: 'ACKNOWLEDGED' | 'RESOLVED') => void;
  onCreateMaintenance: (value: MaintenanceForm) => void;
}) {
  const { t } = useLanguage();
  return (
    <Card>
      <div className="grid gap-4 p-4 lg:grid-cols-4">
        <CompactMetric
          icon={Activity}
          label={t.alerts.availability}
          value={`${availability.availabilityPct}%`}
          tone={availability.targetMet ? 'ok' : 'bad'}
        />
        <CompactMetric
          icon={Gauge}
          label={t.alerts.averageLatency}
          value={availability.latencyAvgMs == null ? 'n/a' : `${availability.latencyAvgMs} ms`}
          tone="neutral"
        />
        <CompactMetric
          icon={ShieldAlert}
          label={t.alerts.openIncidents}
          value={String(incidents.length)}
          tone={incidents.length === 0 ? 'ok' : 'bad'}
        />
        <CompactMetric
          icon={CalendarClock}
          label={t.alerts.maintenance}
          value={String(maintenance.length)}
          tone="neutral"
        />
      </div>
      <div className="grid gap-4 border-t p-4 lg:grid-cols-2">
        <div>
          <p className="text-sm font-semibold">{t.alerts.activeIncidents}</p>
          <div className="mt-3 space-y-2">
            {incidents.slice(0, 5).map((incident) => (
              <div key={incident.id} className="rounded-md border p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <SeverityBadge severity={incident.severity} />
                      <Badge variant="outline">{incident.source}</Badge>
                    </div>
                    <p className="mt-2 text-sm font-medium">{incident.title}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {incident.device?.name ?? t.dashboard.scope} ·{' '}
                      {formatDate(incident.lastEventAt)}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={updatingIncident}
                      onClick={() => onUpdateIncident(incident.id, 'ACKNOWLEDGED')}
                    >
                      {t.alerts.ack}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={updatingIncident}
                      onClick={() => onUpdateIncident(incident.id, 'RESOLVED')}
                    >
                      {t.alerts.resolve}
                    </Button>
                  </div>
                </div>
              </div>
            ))}
            {incidents.length === 0 && (
              <p className="rounded-md border p-3 text-sm text-muted-foreground">
                {t.alerts.noOpenIncident}
              </p>
            )}
          </div>
        </div>
        <div>
          <p className="text-sm font-semibold">{t.alerts.slo}</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Objectif {availability.targetPct}% · P95{' '}
            {availability.latencyP95Ms == null ? 'n/a' : `${availability.latencyP95Ms} ms`}
          </p>
          {isAdmin && policy && (
            <MonitoringPolicyFormView policy={policy} saving={savingPolicy} onSave={onSavePolicy} />
          )}
          {isAdmin && (
            <MaintenanceFormView saving={creatingMaintenance} onCreate={onCreateMaintenance} />
          )}
          <div className="mt-3 space-y-2">
            {maintenance.slice(0, 3).map((window) => (
              <div key={window.id} className="rounded-md border p-2 text-xs">
                <p className="font-medium">{window.title}</p>
                <p className="text-muted-foreground">
                  {formatDate(window.startsAt)} → {formatDate(window.endsAt)}
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </Card>
  );
}

function MaintenanceFormView({
  saving,
  onCreate,
}: {
  saving: boolean;
  onCreate: (value: MaintenanceForm) => void;
}) {
  const { t, language } = useLanguage();
  const now = new Date();
  const later = new Date(now.getTime() + 60 * 60 * 1000);
  const [title, setTitle] = useState(
    language === 'fr' ? 'Maintenance planifiée' : 'Scheduled maintenance',
  );
  const [startsAt, setStartsAt] = useState(toDatetimeLocal(now));
  const [endsAt, setEndsAt] = useState(toDatetimeLocal(later));

  return (
    <div className="mt-4 rounded-md border p-3">
      <p className="text-sm font-medium">{t.alerts.newMaintenance}</p>
      <div className="mt-2 grid gap-2">
        <Input value={title} onChange={(event) => setTitle(event.target.value)} />
        <div className="grid grid-cols-2 gap-2">
          <Input
            type="datetime-local"
            value={startsAt}
            onChange={(event) => setStartsAt(event.target.value)}
          />
          <Input
            type="datetime-local"
            value={endsAt}
            onChange={(event) => setEndsAt(event.target.value)}
          />
        </div>
        <Button
          size="sm"
          variant="outline"
          disabled={saving || !title.trim()}
          onClick={() =>
            onCreate({
              title,
              startsAt: new Date(startsAt).toISOString(),
              endsAt: new Date(endsAt).toISOString(),
              siteId: null,
              deviceId: null,
              notes: null,
            })
          }
        >
          <CalendarClock className="h-4 w-4" /> {language === 'fr' ? 'Planifier' : 'Schedule'}
        </Button>
      </div>
    </div>
  );
}

function MonitoringPolicyFormView({
  policy,
  saving,
  onSave,
}: {
  policy: MonitoringPolicy;
  saving: boolean;
  onSave: (value: MonitoringPolicyForm) => void;
}) {
  const { t, language } = useLanguage();
  const [availabilityTargetPct, setAvailabilityTargetPct] = useState(policy.availabilityTargetPct);
  const [latencyWarningMs, setLatencyWarningMs] = useState(policy.latencyWarningMs);
  const [latencyCriticalMs, setLatencyCriticalMs] = useState(policy.latencyCriticalMs);
  const [latencyAlertsEnabled, setLatencyAlertsEnabled] = useState(policy.latencyAlertsEnabled);
  const [measurementRetentionDays, setMeasurementRetentionDays] = useState(
    policy.measurementRetentionDays,
  );
  const [incidentAutoResolve, setIncidentAutoResolve] = useState(policy.incidentAutoResolve);

  return (
    <div className="mt-3 grid gap-3">
      <div className="grid grid-cols-2 gap-2">
        <Field label={t.alerts.availabilitySlo}>
          <Input
            type="number"
            value={availabilityTargetPct}
            onChange={(e) => setAvailabilityTargetPct(Number(e.target.value))}
          />
        </Field>
        <Field label={t.alerts.retention}>
          <Input
            type="number"
            value={measurementRetentionDays}
            onChange={(e) => setMeasurementRetentionDays(Number(e.target.value))}
          />
        </Field>
        <Field label={t.alerts.latencyWarning}>
          <Input
            type="number"
            value={latencyWarningMs}
            onChange={(e) => setLatencyWarningMs(Number(e.target.value))}
          />
        </Field>
        <Field label={t.alerts.latencyCritical}>
          <Input
            type="number"
            value={latencyCriticalMs}
            onChange={(e) => setLatencyCriticalMs(Number(e.target.value))}
          />
        </Field>
      </div>
      <label className="flex items-start gap-2 rounded-md border p-3 text-sm">
        <input
          className="mt-1"
          type="checkbox"
          checked={latencyAlertsEnabled}
          onChange={(e) => setLatencyAlertsEnabled(e.target.checked)}
        />
        <span>
          <span className="block font-medium">{t.alerts.createLatencyAlerts}</span>
          <span className="mt-0.5 block text-xs text-muted-foreground">
            {language === 'fr'
              ? localized(
                  language,
                  "Si désactivé, la disponibilité et l'historique restent mesurés, mais aucune alerte LATENCY_HIGH n'est créée.",
                  'When disabled, availability and history remain measured, but no LATENCY_HIGH alert is created.',
                )
              : 'When disabled, availability and history are still measured, but no LATENCY_HIGH alert is created.'}
          </span>
        </span>
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={incidentAutoResolve}
          onChange={(e) => setIncidentAutoResolve(e.target.checked)}
        />
        {language === 'fr'
          ? localized(
              language,
              'Résolution automatique des incidents revenus à la normale',
              'Automatically resolve incidents when they return to normal',
            )
          : 'Automatically resolve incidents when service returns to normal'}
      </label>
      <Button
        size="sm"
        disabled={saving}
        onClick={() =>
          onSave({
            availabilityTargetPct,
            latencyWarningMs,
            latencyCriticalMs,
            latencyAlertsEnabled,
            measurementRetentionDays,
            incidentAutoResolve,
          })
        }
      >
        {language === 'fr' ? 'Enregistrer les seuils' : 'Save thresholds'}
      </Button>
    </div>
  );
}

function CompactMetric({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: typeof Activity;
  label: string;
  value: string;
  tone: 'ok' | 'bad' | 'neutral';
}) {
  return (
    <div className="rounded-lg border p-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">{label}</p>
        <Icon
          className={cn(
            'h-4 w-4',
            tone === 'ok' && 'text-status-online',
            tone === 'bad' && 'text-destructive',
            tone === 'neutral' && 'text-muted-foreground',
          )}
        />
      </div>
      <p className="mt-2 text-xl font-semibold tabular-nums">{value}</p>
    </div>
  );
}

function AlertRow({
  alert,
  acknowledging,
  onAcknowledge,
}: {
  alert: DiscoveryEvent;
  acknowledging: boolean;
  onAcknowledge: () => void;
}) {
  const { t, language } = useLanguage();
  const isOpen = !alert.acknowledgedAt;
  return (
    <div className="flex flex-col gap-3 p-4 lg:flex-row lg:items-start lg:justify-between">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <SeverityBadge severity={alert.severity} />
          <Badge variant="outline">
            {language === 'fr' ? TYPE_LABELS[alert.type] : TYPE_LABELS_EN[alert.type]}
          </Badge>
          {alert.site && <Badge variant="muted">{alert.site.name}</Badge>}
          {alert.acknowledgedAt && <Badge variant="success">{t.alerts.acknowledgedStatus}</Badge>}
        </div>
        <p className="mt-2 font-medium">{alert.title}</p>
        {alert.message && <p className="mt-1 text-sm text-muted-foreground">{alert.message}</p>}
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          {alert.device && (
            <span>
              {alert.device.name}
              {alert.device.ip ? ` · ${alert.device.ip}` : ''}
            </span>
          )}
          {alert.collector && <span>Collector {alert.collector.name}</span>}
          <span>{formatDate(alert.createdAt, language)}</span>
          {alert.acknowledgedBy && (
            <span>
              {language === 'fr' ? 'Acquittée par' : 'Acknowledged by'} {alert.acknowledgedBy.name}
            </span>
          )}
        </div>
        {alert.deliveries && alert.deliveries.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {alert.deliveries.map((delivery) => (
              <Badge
                key={delivery.id}
                variant={
                  delivery.status === 'SENT'
                    ? 'success'
                    : delivery.status === 'FAILED'
                      ? 'danger'
                      : 'muted'
                }
                title={delivery.error ?? delivery.target ?? undefined}
              >
                <DeliveryIcon channel={delivery.channel} />
                {delivery.status}
              </Badge>
            ))}
          </div>
        )}
      </div>
      {isOpen && (
        <Button variant="outline" size="sm" onClick={onAcknowledge} disabled={acknowledging}>
          <CheckCircle2 className="h-4 w-4" /> {language === 'fr' ? 'Acquitter' : 'Acknowledge'}
        </Button>
      )}
    </div>
  );
}

function AlertSettingsPanel({
  settings,
  saving,
  onSave,
}: {
  settings: AlertSettings;
  saving: boolean;
  onSave: (value: AlertSettingsForm) => void;
}) {
  const { t, language } = useLanguage();
  const [emailEnabled, setEmailEnabled] = useState(settings.emailEnabled);
  const [emailRecipients, setEmailRecipients] = useState(settings.emailRecipients.join('\n'));
  const [webhookEnabled, setWebhookEnabled] = useState(settings.webhookEnabled);
  const [webhookUrl, setWebhookUrl] = useState(settings.webhookUrl ?? '');
  const [slackEnabled, setSlackEnabled] = useState(settings.slackEnabled);
  const [slackWebhookUrl, setSlackWebhookUrl] = useState(settings.slackWebhookUrl ?? '');
  const [teamsEnabled, setTeamsEnabled] = useState(settings.teamsEnabled);
  const [teamsWebhookUrl, setTeamsWebhookUrl] = useState(settings.teamsWebhookUrl ?? '');
  const [minSeverity, setMinSeverity] = useState<DiscoveryEventSeverity>(settings.minSeverity);
  const [eventTypes, setEventTypes] = useState<DiscoveryEventType[]>(settings.eventTypes);
  const [includeResolvedInfo, setIncludeResolvedInfo] = useState(settings.includeResolvedInfo);

  const recipients = useMemo(
    () =>
      emailRecipients
        .split(/[\n,;]/)
        .map((item) => item.trim())
        .filter(Boolean),
    [emailRecipients],
  );

  const toggleType = (type: DiscoveryEventType) => {
    setEventTypes((current) =>
      current.includes(type) ? current.filter((item) => item !== type) : [...current, type],
    );
  };

  return (
    <Card>
      <div className="grid gap-6 p-5 lg:grid-cols-2">
        <div className="space-y-4">
          <div>
            <p className="font-semibold">{t.alerts.outboundChannels}</p>
            <p className="mt-1 text-sm text-muted-foreground">{t.alerts.notificationNote}</p>
          </div>
          <ChannelToggle
            icon={Mail}
            label="Email"
            description={
              language === 'fr'
                ? 'Notification aux équipes d’exploitation.'
                : 'Notify operations teams.'
            }
            checked={emailEnabled}
            onChange={setEmailEnabled}
          />
          <Textarea
            value={emailRecipients}
            onChange={(event) => setEmailRecipients(event.target.value)}
            placeholder="ops@example.com&#10;admin@example.com"
            disabled={!emailEnabled}
          />
          <ChannelToggle
            icon={Webhook}
            label="Webhook générique"
            description={
              language === 'fr'
                ? 'Payload JSON Orbis vers un outil interne.'
                : 'Orbis JSON payload to an internal tool.'
            }
            checked={webhookEnabled}
            onChange={setWebhookEnabled}
          />
          <Input
            value={webhookUrl}
            onChange={(event) => setWebhookUrl(event.target.value)}
            placeholder="https://hooks.example.com/orbis"
            disabled={!webhookEnabled}
          />
          <ChannelToggle
            icon={MessageSquare}
            label="Slack"
            description={
              language === 'fr'
                ? 'Message formaté pour Incoming Webhook Slack.'
                : 'Formatted message for a Slack incoming webhook.'
            }
            checked={slackEnabled}
            onChange={setSlackEnabled}
          />
          <Input
            value={slackWebhookUrl}
            onChange={(event) => setSlackWebhookUrl(event.target.value)}
            placeholder="https://hooks.slack.com/services/..."
            disabled={!slackEnabled}
          />
          <ChannelToggle
            icon={UsersRound}
            label="Microsoft Teams"
            description={
              language === 'fr'
                ? 'Carte d’alerte pour connecteur Teams.'
                : 'Alert card for a Teams connector.'
            }
            checked={teamsEnabled}
            onChange={setTeamsEnabled}
          />
          <Input
            value={teamsWebhookUrl}
            onChange={(event) => setTeamsWebhookUrl(event.target.value)}
            placeholder="https://outlook.office.com/webhook/..."
            disabled={!teamsEnabled}
          />
        </div>

        <div className="space-y-4">
          <div>
            <p className="font-semibold">{t.alerts.triggerPolicy}</p>
            <p className="mt-1 text-sm text-muted-foreground">{t.alerts.triggerNote}</p>
          </div>
          <Select
            value={minSeverity}
            onChange={(event) => setMinSeverity(event.target.value as DiscoveryEventSeverity)}
          >
            <option value="WARNING">{t.alerts.warningAndCritical}</option>
            <option value="CRITICAL">{t.alerts.criticalOnly}</option>
            <option value="INFO">{t.alerts.allSeverity}</option>
          </Select>
          <label className="flex items-center gap-3 rounded-lg border p-3 text-sm">
            <input
              type="checkbox"
              checked={includeResolvedInfo}
              onChange={(event) => setIncludeResolvedInfo(event.target.checked)}
            />
            <span>{t.alerts.notifyInformative}</span>
          </label>
          <div className="flex flex-wrap gap-2">
            {EVENT_TYPES.map((type) => (
              <button
                key={type}
                type="button"
                onClick={() => toggleType(type)}
                className={cn(
                  'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                  eventTypes.includes(type)
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-input text-muted-foreground hover:bg-accent',
                )}
              >
                {language === 'fr' ? TYPE_LABELS[type] : TYPE_LABELS_EN[type]}
              </button>
            ))}
          </div>
          <div className="flex justify-end">
            <Button
              onClick={() =>
                onSave({
                  emailEnabled,
                  emailRecipients: recipients,
                  webhookEnabled,
                  webhookUrl: webhookUrl || null,
                  slackEnabled,
                  slackWebhookUrl: slackWebhookUrl || null,
                  teamsEnabled,
                  teamsWebhookUrl: teamsWebhookUrl || null,
                  minSeverity,
                  eventTypes,
                  includeResolvedInfo,
                })
              }
              disabled={saving}
            >
              {localized(language, 'Enregistrer', 'Save')}
            </Button>
          </div>
        </div>
      </div>
    </Card>
  );
}

function ChannelToggle({
  icon: Icon,
  label,
  description,
  checked,
  onChange,
}: {
  icon: typeof Mail;
  label: string;
  description: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="flex items-start gap-3 rounded-lg border p-3 text-sm">
      <input
        className="mt-1"
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
      <span className="min-w-0">
        <span className="block font-medium">{label}</span>
        <span className="mt-0.5 block text-xs text-muted-foreground">{description}</span>
      </span>
    </label>
  );
}

function DeliveryIcon({ channel }: { channel: AlertChannel }) {
  if (channel === 'EMAIL') return <Mail className="h-3 w-3" />;
  if (channel === 'SLACK') return <MessageSquare className="h-3 w-3" />;
  if (channel === 'TEAMS') return <UsersRound className="h-3 w-3" />;
  return <Webhook className="h-3 w-3" />;
}

function hasActiveNotificationChannel(settings: AlertSettings) {
  return (
    settings.emailEnabled ||
    settings.webhookEnabled ||
    settings.slackEnabled ||
    settings.teamsEnabled
  );
}

function MetricCard({
  label,
  value,
  icon: Icon,
  tone,
}: {
  label: string;
  value: number;
  icon: typeof AlertTriangle;
  tone: 'critical' | 'warning' | 'info';
}) {
  return (
    <Card className="p-5">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-muted-foreground">{label}</p>
          <p className="mt-1 text-3xl font-bold tabular-nums">{value}</p>
        </div>
        <div
          className={cn(
            'flex h-11 w-11 items-center justify-center rounded-lg',
            tone === 'critical' && 'bg-destructive/10 text-destructive',
            tone === 'warning' && 'bg-status-warning/10 text-status-warning',
            tone === 'info' && 'bg-primary/10 text-primary',
          )}
        >
          <Icon className="h-5 w-5" />
        </div>
      </div>
    </Card>
  );
}

function SeverityBadge({ severity }: { severity: DiscoveryEventSeverity }) {
  const { language } = useLanguage();
  const labels =
    language === 'fr'
      ? SEVERITY_LABELS
      : { INFO: 'Info', WARNING: 'Warning', CRITICAL: 'Critical' };
  return (
    <Badge
      variant={severity === 'CRITICAL' ? 'danger' : severity === 'WARNING' ? 'warning' : 'default'}
    >
      {labels[severity]}
    </Badge>
  );
}

function formatDate(value: string, language: 'fr' | 'en' = 'fr') {
  return new Intl.DateTimeFormat(language === 'en' ? 'en-GB' : 'fr-FR', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(value));
}

function toDatetimeLocal(value: Date) {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}T${pad(value.getHours())}:${pad(value.getMinutes())}`;
}

type AlertSettingsForm = Pick<
  AlertSettings,
  | 'emailEnabled'
  | 'emailRecipients'
  | 'webhookEnabled'
  | 'webhookUrl'
  | 'slackEnabled'
  | 'slackWebhookUrl'
  | 'teamsEnabled'
  | 'teamsWebhookUrl'
  | 'minSeverity'
  | 'eventTypes'
  | 'includeResolvedInfo'
>;

type MonitoringPolicyForm = Pick<
  MonitoringPolicy,
  | 'availabilityTargetPct'
  | 'latencyWarningMs'
  | 'latencyCriticalMs'
  | 'latencyAlertsEnabled'
  | 'measurementRetentionDays'
  | 'incidentAutoResolve'
>;

type MaintenanceForm = Pick<
  MaintenanceWindow,
  'title' | 'siteId' | 'deviceId' | 'startsAt' | 'endsAt' | 'notes'
>;
