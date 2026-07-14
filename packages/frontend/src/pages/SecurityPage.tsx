import { useMemo, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FileClock,
  RotateCw,
  Save,
  Settings2,
  ShieldCheck,
  ShieldAlert,
} from 'lucide-react';
import { api, ApiError, downloadAuthenticated } from '@/lib/api';
import type {
  AuditLog,
  SecurityPolicy,
  SecurityRisk,
  SecurityRiskCategory,
  SecurityRiskSeverity,
} from '@/types';
import { PageContainer, PageHeader } from '@/components/layout/PageHeader';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { FullLoading } from '@/components/ui/Loading';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/useToast';
import { cn } from '@/lib/utils';
import { useLanguage } from '@/hooks/useLanguage';

const SEVERITY_LABELS: Record<SecurityRiskSeverity, string> = {
  CRITICAL: 'Critique',
  HIGH: 'Élevé',
  MEDIUM: 'Moyen',
  LOW: 'Faible',
};

const CATEGORY_LABELS: Record<SecurityRiskCategory, string> = {
  RISKY_PORT: 'Port risqué',
  UNKNOWN_DEVICE: 'Équipement inconnu',
  MISSING_SITE: 'Sans site',
  MISSING_OWNER: 'Sans propriétaire',
  FIRMWARE_UNKNOWN: 'Firmware/OS inconnu',
  FIRMWARE_OBSOLETE: 'Support obsolète',
  WEAK_SNMP: 'SNMP faible',
  IP_CONFLICT: 'Conflit IP',
  MAC_CONFLICT: 'Conflit MAC',
  COLLECTOR_SECRET: 'Secret collector',
};

export default function SecurityPage() {
  const { t, language } = useLanguage();
  const { isAdmin } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [policyOpen, setPolicyOpen] = useState(false);
  const [severity, setSeverity] = useState<SecurityRiskSeverity | ''>('');
  const [category, setCategory] = useState<SecurityRiskCategory | ''>('');
  const [auditAction, setAuditAction] = useState('');

  const summaryQuery = useQuery({
    queryKey: ['security-summary'],
    queryFn: () => api.security.summary(),
  });
  const policyQuery = useQuery({
    queryKey: ['security-policy'],
    queryFn: () => api.security.policy(),
  });
  const auditQuery = useQuery({
    queryKey: ['security-audit', auditAction],
    queryFn: () => api.security.audit({ limit: 80, action: auditAction || undefined }),
  });

  const savePolicy = useMutation({
    mutationFn: (policy: PolicyFormValue) => api.security.updatePolicy(policy),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['security-policy'] });
      queryClient.invalidateQueries({ queryKey: ['security-summary'] });
      toast.success(
        language === 'fr' ? 'Politique de conformité enregistrée' : 'Compliance policy saved',
      );
    },
    onError: (err) =>
      toast.error(
        language === 'fr' ? 'Politique invalide' : 'Invalid policy',
        err instanceof ApiError ? err.message : undefined,
      ),
  });

  const filteredRisks = useMemo(() => {
    const risks = summaryQuery.data?.risks ?? [];
    return risks.filter(
      (risk) =>
        (!severity || risk.severity === severity) && (!category || risk.category === category),
    );
  }, [summaryQuery.data?.risks, severity, category]);

  if (
    summaryQuery.isLoading ||
    policyQuery.isLoading ||
    auditQuery.isLoading ||
    !summaryQuery.data ||
    !policyQuery.data ||
    !auditQuery.data
  ) {
    return (
      <PageContainer>
        <PageHeader title={t.nav.security} />
        <FullLoading />
      </PageContainer>
    );
  }

  const summary = summaryQuery.data;
  const policy = policyQuery.data.policy;

  return (
    <PageContainer>
      <PageHeader
        title={t.nav.security}
        description={
          language === 'fr'
            ? 'Risques détectés, conformité opérationnelle et journal d’audit exploitable.'
            : 'Detected risks, operational compliance and an actionable audit log.'
        }
        actions={
          <>
            <Button variant="outline" onClick={() => summaryQuery.refetch()}>
              <RotateCw className="h-4 w-4" /> {t.ui.refresh}
            </Button>
            <Button
              variant="outline"
              onClick={() => downloadAuthenticated('/api/security/risks.csv', 'orbis-risques.csv')}
            >
              <Download className="h-4 w-4" />{' '}
              {language === 'fr' ? 'Export risques' : 'Export risks'}
            </Button>
            <Button
              variant="outline"
              onClick={() => downloadAuthenticated('/api/security/audit.csv', 'orbis-audit.csv')}
            >
              <FileClock className="h-4 w-4" />{' '}
              {language === 'fr' ? 'Export audit' : 'Export audit'}
            </Button>
            {isAdmin && (
              <Button
                variant={policyOpen ? 'secondary' : 'outline'}
                onClick={() => setPolicyOpen((value) => !value)}
              >
                <Settings2 className="h-4 w-4" /> {language === 'fr' ? 'Politique' : 'Policy'}
              </Button>
            )}
          </>
        }
      />

      <div className="mt-6 grid grid-cols-2 gap-4 px-6 lg:grid-cols-5">
        <ScoreCard score={summary.score} />
        <MetricCard label={language === 'fr' ? 'Total' : 'Total'} value={summary.counts.total} />
        <MetricCard
          label={language === 'fr' ? 'Critiques' : 'Critical'}
          value={summary.counts.critical}
          tone="critical"
        />
        <MetricCard
          label={language === 'fr' ? 'Élevés' : 'High'}
          value={summary.counts.high}
          tone="high"
        />
        <MetricCard
          label={language === 'fr' ? 'Moyens' : 'Medium'}
          value={summary.counts.medium}
          tone="medium"
        />
      </div>

      {policyOpen && isAdmin && (
        <div className="mt-6 px-6">
          <PolicyPanel
            policy={policy}
            saving={savePolicy.isPending}
            onSave={(value) => savePolicy.mutate(value)}
          />
        </div>
      )}

      <div className="mt-6 grid gap-6 px-6 xl:grid-cols-[minmax(0,1fr)_420px]">
        <Card className="overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b p-4">
            <div>
              <p className="text-sm font-semibold">
                {language === 'fr' ? 'Risques ouverts' : 'Open risks'}
              </p>
              <p className="text-xs text-muted-foreground">
                {language === 'fr'
                  ? 'Priorisés par impact et preuve collectée.'
                  : 'Prioritized by impact and collected evidence.'}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <select
                value={severity}
                onChange={(event) => setSeverity(event.target.value as SecurityRiskSeverity | '')}
                className="h-9 rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="">
                  {language === 'fr' ? 'Toutes sévérités' : 'All severities'}
                </option>
                <option value="CRITICAL">{language === 'fr' ? 'Critiques' : 'Critical'}</option>
                <option value="HIGH">{language === 'fr' ? 'Élevés' : 'High'}</option>
                <option value="MEDIUM">{language === 'fr' ? 'Moyens' : 'Medium'}</option>
                <option value="LOW">{language === 'fr' ? 'Faibles' : 'Low'}</option>
              </select>
              <select
                value={category}
                onChange={(event) => setCategory(event.target.value as SecurityRiskCategory | '')}
                className="h-9 rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="">
                  {language === 'fr' ? 'Toutes catégories' : 'All categories'}
                </option>
                {Object.entries(CATEGORY_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="divide-y">
            {filteredRisks.map((risk) => (
              <RiskRow key={risk.id} risk={risk} />
            ))}
            {filteredRisks.length === 0 && (
              <div className="flex flex-col items-center justify-center p-12 text-center">
                <CheckCircle2 className="h-8 w-8 text-status-online" />
                <p className="mt-3 text-sm font-medium">
                  {language === 'fr' ? 'Aucun risque dans cette vue' : 'No risks in this view'}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {language === 'fr'
                    ? 'La politique actuelle ne remonte pas d’action à traiter.'
                    : 'The current policy has no action to address.'}
                </p>
              </div>
            )}
          </div>
        </Card>

        <Card className="overflow-hidden">
          <div className="border-b p-4">
            <p className="text-sm font-semibold">
              {language === 'fr' ? 'Journal d’audit' : 'Audit log'}
            </p>
            <p className="text-xs text-muted-foreground">
              {language === 'fr'
                ? 'Dernières actions traçables dans l’organisation.'
                : 'Latest traceable actions in the organization.'}
            </p>
            <Input
              value={auditAction}
              onChange={(event) => setAuditAction(event.target.value)}
              placeholder={language === 'fr' ? 'Filtrer par action' : 'Filter by action'}
              className="mt-3"
            />
          </div>
          <div className="max-h-[720px] divide-y overflow-y-auto">
            {auditQuery.data.logs.map((log) => (
              <AuditRow key={log.id} log={log} />
            ))}
            {auditQuery.data.logs.length === 0 && (
              <div className="p-8 text-center text-sm text-muted-foreground">
                {language === 'fr' ? 'Aucune entrée d’audit.' : 'No audit entries.'}
              </div>
            )}
          </div>
        </Card>
      </div>
    </PageContainer>
  );
}

function ScoreCard({ score }: { score: number }) {
  const { language } = useLanguage();
  const tone =
    score >= 85 ? 'text-status-online' : score >= 65 ? 'text-status-warning' : 'text-destructive';
  return (
    <Card className="col-span-2 p-4 lg:col-span-1">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {language === 'fr' ? 'Score conformité' : 'Compliance score'}
        </p>
        <ShieldCheck className={cn('h-5 w-5', tone)} />
      </div>
      <p className={cn('mt-3 text-3xl font-bold', tone)}>{score}</p>
      <p className="mt-1 text-xs text-muted-foreground">
        {language === 'fr'
          ? 'sur 100, selon la politique active'
          : 'out of 100, based on the active policy'}
      </p>
    </Card>
  );
}

function MetricCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: 'critical' | 'high' | 'medium';
}) {
  const color =
    tone === 'critical'
      ? 'text-destructive'
      : tone === 'high'
        ? 'text-orange-500'
        : tone === 'medium'
          ? 'text-status-warning'
          : 'text-foreground';
  return (
    <Card className="p-4">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className={cn('mt-2 text-2xl font-semibold', color)}>{value}</p>
    </Card>
  );
}

function RiskRow({ risk }: { risk: SecurityRisk }) {
  const { language } = useLanguage();
  return (
    <div className="p-4">
      <div className="flex flex-wrap items-center gap-2">
        <SeverityBadge severity={risk.severity} />
        <Badge variant="outline">{categoryLabel(risk.category, language)}</Badge>
        {risk.site && <Badge variant="muted">{risk.site.name}</Badge>}
      </div>
      <div className="mt-2 flex items-start gap-3">
        <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0">
          <p className="font-medium">{risk.title}</p>
          <p className="mt-1 text-sm text-muted-foreground">{risk.description}</p>
          <p className="mt-2 text-sm">{risk.remediation}</p>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            {risk.device && (
              <span>
                {risk.device.name}
                {risk.device.ip ? ` · ${risk.device.ip}` : ''}
              </span>
            )}
            {risk.collector && <span>Collector {risk.collector.name}</span>}
            <span>{formatDate(risk.detectedAt)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function AuditRow({ log }: { log: AuditLog }) {
  return (
    <div className="p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="truncate text-sm font-medium">{log.action}</p>
        <span className="shrink-0 text-xs text-muted-foreground">{formatDate(log.createdAt)}</span>
      </div>
      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
        {log.user && <span>{log.user.name}</span>}
        {log.target && (
          <span>
            {log.target}
            {log.targetId ? ` · ${log.targetId.slice(0, 8)}` : ''}
          </span>
        )}
        {log.ip && <span>{log.ip}</span>}
      </div>
    </div>
  );
}

type PolicyFormValue = Partial<
  Pick<
    SecurityPolicy,
    | 'requireDeviceSite'
    | 'requireDeviceOwner'
    | 'riskyPorts'
    | 'criticalPorts'
    | 'weakSnmpCommunities'
    | 'firmwareUnknownDays'
    | 'warrantyWarningDays'
    | 'collectorTokenMaxAgeDays'
  >
>;

function PolicyPanel({
  policy,
  saving,
  onSave,
}: {
  policy: SecurityPolicy;
  saving: boolean;
  onSave: (value: PolicyFormValue) => void;
}) {
  const { t, language } = useLanguage();
  const [requireDeviceSite, setRequireDeviceSite] = useState(policy.requireDeviceSite);
  const [requireDeviceOwner, setRequireDeviceOwner] = useState(policy.requireDeviceOwner);
  const [riskyPorts, setRiskyPorts] = useState(policy.riskyPorts.join(', '));
  const [criticalPorts, setCriticalPorts] = useState(policy.criticalPorts.join(', '));
  const [weakSnmpCommunities, setWeakSnmpCommunities] = useState(
    policy.weakSnmpCommunities.join(', '),
  );
  const [collectorTokenMaxAgeDays, setCollectorTokenMaxAgeDays] = useState(
    policy.collectorTokenMaxAgeDays,
  );
  const [warrantyWarningDays, setWarrantyWarningDays] = useState(policy.warrantyWarningDays);

  const submit = () =>
    onSave({
      requireDeviceSite,
      requireDeviceOwner,
      riskyPorts: parseNumbers(riskyPorts),
      criticalPorts: parseNumbers(criticalPorts),
      weakSnmpCommunities: parseStrings(weakSnmpCommunities),
      collectorTokenMaxAgeDays,
      warrantyWarningDays,
    });

  return (
    <Card>
      <div className="grid gap-4 p-4 lg:grid-cols-2">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={requireDeviceSite}
            onChange={(event) => setRequireDeviceSite(event.target.checked)}
          />
          {language === 'fr'
            ? 'Site obligatoire pour chaque équipement'
            : 'A site is required for every device'}
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={requireDeviceOwner}
            onChange={(event) => setRequireDeviceOwner(event.target.checked)}
          />
          {language === 'fr'
            ? 'Propriétaire obligatoire pour chaque équipement'
            : 'An owner is required for every device'}
        </label>
        <Field label={language === 'fr' ? 'Ports surveillés' : 'Monitored ports'}>
          <Input value={riskyPorts} onChange={(event) => setRiskyPorts(event.target.value)} />
        </Field>
        <Field label={language === 'fr' ? 'Ports critiques' : 'Critical ports'}>
          <Input value={criticalPorts} onChange={(event) => setCriticalPorts(event.target.value)} />
        </Field>
        <Field label={language === 'fr' ? 'Communautés SNMP faibles' : 'Weak SNMP communities'}>
          <Input
            value={weakSnmpCommunities}
            onChange={(event) => setWeakSnmpCommunities(event.target.value)}
          />
        </Field>
        <Field
          label={language === 'fr' ? 'Âge maximum token collector' : 'Maximum collector token age'}
        >
          <Input
            type="number"
            min={1}
            value={collectorTokenMaxAgeDays}
            onChange={(event) => setCollectorTokenMaxAgeDays(Number(event.target.value))}
          />
        </Field>
        <Field
          label={language === 'fr' ? 'Alerte support avant expiration' : 'Support expiry warning'}
        >
          <Input
            type="number"
            min={1}
            value={warrantyWarningDays}
            onChange={(event) => setWarrantyWarningDays(Number(event.target.value))}
          />
        </Field>
      </div>
      <div className="flex justify-end border-t p-4">
        <Button onClick={submit} disabled={saving}>
          <Save className="h-4 w-4" /> {t.ui.save}
        </Button>
      </div>
    </Card>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="space-y-1 text-sm">
      <span className="font-medium">{label}</span>
      {children}
    </label>
  );
}

function SeverityBadge({ severity }: { severity: SecurityRiskSeverity }) {
  const { language } = useLanguage();
  const variant =
    severity === 'CRITICAL'
      ? 'danger'
      : severity === 'HIGH'
        ? 'warning'
        : severity === 'MEDIUM'
          ? 'secondary'
          : 'muted';
  return (
    <Badge variant={variant}>
      {severity === 'CRITICAL' && <AlertTriangle className="h-3 w-3" />}
      {language === 'fr'
        ? SEVERITY_LABELS[severity]
        : { CRITICAL: 'Critical', HIGH: 'High', MEDIUM: 'Medium', LOW: 'Low' }[severity]}
    </Badge>
  );
}

function parseNumbers(value: string) {
  return [
    ...new Set(
      value
        .split(/[,\s]+/)
        .map((item) => Number(item.trim()))
        .filter((item) => Number.isInteger(item) && item > 0 && item <= 65_535),
    ),
  ];
}

function parseStrings(value: string) {
  return [
    ...new Set(
      value
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ];
}

function categoryLabel(category: SecurityRiskCategory, language: 'fr' | 'en') {
  if (language === 'fr') return CATEGORY_LABELS[category];
  const labels: Record<SecurityRiskCategory, string> = {
    RISKY_PORT: 'Risky port',
    UNKNOWN_DEVICE: 'Unknown device',
    MISSING_SITE: 'No site',
    MISSING_OWNER: 'No owner',
    FIRMWARE_UNKNOWN: 'Unknown firmware/OS',
    FIRMWARE_OBSOLETE: 'Obsolete support',
    WEAK_SNMP: 'Weak SNMP',
    IP_CONFLICT: 'IP conflict',
    MAC_CONFLICT: 'MAC conflict',
    COLLECTOR_SECRET: 'Collector secret',
  };
  return labels[category];
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('fr-FR', { dateStyle: 'short', timeStyle: 'short' }).format(
    new Date(value),
  );
}
