import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Box,
  CheckCircle2,
  Clipboard,
  Download,
  FileKey2,
  HardDrive,
  KeyRound,
  MonitorCog,
  Network,
  Radar,
  RotateCw,
  Server,
  TerminalSquare,
  TriangleAlert,
} from 'lucide-react';
import { api, downloadAuthenticated } from '@/lib/api';
import { useAuth } from '@/hooks/useAuth';
import { useCurrentSite } from '@/hooks/useCurrentSite';
import { useToast } from '@/hooks/useToast';
import { localized, useLanguage } from '@/hooks/useLanguage';
import { PageContainer, PageHeader } from '@/components/layout/PageHeader';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Field } from '@/components/ui/Label';
import { Select } from '@/components/ui/Select';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/Empty';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/Tabs';
import type { DiscoveryCollector } from '@/types';

const DEFAULT_PORTS = '22,80,443,445,3389,8080,8443,9100';
const CURRENT_COLLECTOR_VERSION = '1.1.0';

export default function CollectorsPage() {
  const { language } = useLanguage();
  const { canEdit } = useAuth();
  const { siteId } = useCurrentSite();
  const toast = useToast();
  const qc = useQueryClient();
  const [name, setName] = useState('Collector principal');
  const [cidrs, setCidrs] = useState('192.168.1.0/24');
  const [ports, setPorts] = useState(DEFAULT_PORTS);
  const [autoDiagram, setAutoDiagram] = useState(true);
  const [role, setRole] = useState<DiscoveryCollector['role']>('PRIMARY');
  const [priority, setPriority] = useState('100');
  const [failoverAfterMinutes, setFailoverAfterMinutes] = useState('15');
  const [tokenRotationDays, setTokenRotationDays] = useState('180');
  const [snmpCommunities, setSnmpCommunities] = useState('');
  const [snmpV3Username, setSnmpV3Username] = useState('');
  const [snmpV3Level, setSnmpV3Level] = useState('authPriv');
  const [snmpV3AuthProtocol, setSnmpV3AuthProtocol] = useState('sha256');
  const [snmpV3AuthPassword, setSnmpV3AuthPassword] = useState('');
  const [snmpV3PrivProtocol, setSnmpV3PrivProtocol] = useState('aes');
  const [snmpV3PrivPassword, setSnmpV3PrivPassword] = useState('');
  const [installMode, setInstallMode] = useState<'docker' | 'linux' | 'windows' | 'vm'>('docker');
  const [issuedToken, setIssuedToken] = useState<{
    collector: DiscoveryCollector;
    token: string;
  } | null>(null);

  const collectorsQuery = useQuery({
    queryKey: ['collectors', siteId],
    queryFn: () => api.collectors.list({ siteId }),
  });
  const downloadsQuery = useQuery({
    queryKey: ['collector-downloads'],
    queryFn: api.collectors.downloads,
  });
  const parsedCidrs = useMemo(() => parseCidrs(cidrs), [cidrs]);
  const parsedPorts = useMemo(() => parsePorts(ports, 32), [ports]);
  const snmp = {
    snmpCommunities,
    snmpV3Username,
    snmpV3Level,
    snmpV3AuthProtocol,
    snmpV3AuthPassword,
    snmpV3PrivProtocol,
    snmpV3PrivPassword,
  };

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['collectors'] });
    qc.invalidateQueries({ queryKey: ['devices'] });
    qc.invalidateQueries({ queryKey: ['diagrams'] });
    qc.invalidateQueries({ queryKey: ['alerts'] });
  };

  const createCollector = useMutation({
    mutationFn: () =>
      api.collectors.create({
        name: name.trim(),
        siteId: siteId ?? null,
        defaultCidrs: parsedCidrs,
        defaultPorts: parsedPorts,
        autoDiagram,
        role,
        priority: Number(priority) || 100,
        failoverAfterMinutes: Number(failoverAfterMinutes) || 15,
        tokenRotationDays: tokenRotationDays.trim() ? Number(tokenRotationDays) : null,
      }),
    onSuccess: (data) => {
      setIssuedToken(data);
      invalidate();
      toast.success(
        localized(language, 'Collector créé', 'Collector created'),
        localized(
          language,
          'Le token est affiché une seule fois.',
          'The token is shown only once.',
        ),
      );
    },
    onError: (err: any) =>
      toast.error(localized(language, 'Création impossible', 'Creation failed'), err.message),
  });

  const rotate = useMutation({
    mutationFn: (collector: DiscoveryCollector) => api.collectors.rotateToken(collector.id),
    onSuccess: (data) => {
      setIssuedToken(data);
      invalidate();
      toast.success(
        localized(language, 'Token renouvelé', 'Token rotated'),
        localized(
          language,
          'Réinstallez ou mettez à jour le service collector.',
          'Reinstall or update the collector service.',
        ),
      );
    },
    onError: (err: any) =>
      toast.error(localized(language, 'Rotation impossible', 'Rotation failed'), err.message),
  });

  const revoke = useMutation({
    mutationFn: (collector: DiscoveryCollector) => api.collectors.revoke(collector.id),
    onSuccess: () => {
      invalidate();
      toast.success(localized(language, 'Collector révoqué', 'Collector revoked'));
    },
    onError: (err: any) =>
      toast.error(localized(language, 'Révocation impossible', 'Revocation failed'), err.message),
  });

  return (
    <PageContainer>
      <PageHeader
        title="Collectors"
        description={
          language === 'fr'
            ? 'Installation, supervision et diagnostic des agents de découverte réseau.'
            : 'Install, supervise and diagnose network discovery agents.'
        }
        actions={
          <Button variant="outline" onClick={() => collectorsQuery.refetch()}>
            <RotateCw className="h-4 w-4" /> Actualiser
          </Button>
        }
      />

      <div className="grid gap-5 px-6 pt-5 xl:grid-cols-[minmax(0,1fr)_420px]">
        <div className="space-y-5">
          <Card className="p-4">
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <Field label="Nom">
                <Input value={name} onChange={(event) => setName(event.target.value)} />
              </Field>
              <Field label="CIDR à scanner">
                <Input value={cidrs} onChange={(event) => setCidrs(event.target.value)} />
              </Field>
              <Field label="Ports TCP">
                <Input value={ports} onChange={(event) => setPorts(event.target.value)} />
              </Field>
              <Field label="Schéma automatique">
                <Select
                  value={autoDiagram ? 'yes' : 'no'}
                  onChange={(event) => setAutoDiagram(event.target.value === 'yes')}
                >
                  <option value="yes">
                    {localized(language, 'Mettre à jour le schéma', 'Update diagram')}
                  </option>
                  <option value="no">
                    {localized(language, 'Ne pas modifier de schéma', 'Do not modify a diagram')}
                  </option>
                </Select>
              </Field>
              <Field label="Rôle failover">
                <Select
                  value={role}
                  onChange={(event) => setRole(event.target.value as DiscoveryCollector['role'])}
                >
                  <option value="PRIMARY">{localized(language, 'Primaire', 'Primary')}</option>
                  <option value="SECONDARY">
                    {localized(language, 'Secondaire', 'Secondary')}
                  </option>
                  <option value="STANDBY">{localized(language, 'Secours', 'Standby')}</option>
                </Select>
              </Field>
              <Field label="Priorité">
                <Input
                  type="number"
                  min={1}
                  max={10000}
                  value={priority}
                  onChange={(event) => setPriority(event.target.value)}
                />
              </Field>
              <Field label="Failover après">
                <Input
                  type="number"
                  min={1}
                  max={1440}
                  value={failoverAfterMinutes}
                  onChange={(event) => setFailoverAfterMinutes(event.target.value)}
                />
              </Field>
              <Field label="Rotation token">
                <Input
                  type="number"
                  min={1}
                  max={3650}
                  value={tokenRotationDays}
                  onChange={(event) => setTokenRotationDays(event.target.value)}
                />
              </Field>
              <Field label="SNMP v2c">
                <Input
                  value={snmpCommunities}
                  onChange={(event) => setSnmpCommunities(event.target.value)}
                  placeholder="public, supervision"
                />
              </Field>
            </div>

            <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              <Field label="SNMPv3 user">
                <Input
                  value={snmpV3Username}
                  onChange={(event) => setSnmpV3Username(event.target.value)}
                  placeholder="snmp-reader"
                />
              </Field>
              <Field label="SNMPv3 sécurité">
                <Select
                  value={snmpV3Level}
                  onChange={(event) => setSnmpV3Level(event.target.value)}
                >
                  <option value="authPriv">authPriv</option>
                  <option value="authNoPriv">authNoPriv</option>
                  <option value="noAuthNoPriv">noAuthNoPriv</option>
                </Select>
              </Field>
              <Field label="Auth protocol">
                <Select
                  value={snmpV3AuthProtocol}
                  onChange={(event) => setSnmpV3AuthProtocol(event.target.value)}
                >
                  <option value="sha256">SHA-256</option>
                  <option value="sha">SHA</option>
                  <option value="sha512">SHA-512</option>
                  <option value="md5">MD5</option>
                </Select>
              </Field>
              <Field label="Auth password">
                <Input
                  type="password"
                  value={snmpV3AuthPassword}
                  onChange={(event) => setSnmpV3AuthPassword(event.target.value)}
                />
              </Field>
              <Field label="Priv protocol">
                <Select
                  value={snmpV3PrivProtocol}
                  onChange={(event) => setSnmpV3PrivProtocol(event.target.value)}
                >
                  <option value="aes">AES</option>
                  <option value="aes256b">AES-256</option>
                  <option value="des">DES</option>
                </Select>
              </Field>
              <Field label="Priv password">
                <Input
                  type="password"
                  value={snmpV3PrivPassword}
                  onChange={(event) => setSnmpV3PrivPassword(event.target.value)}
                />
              </Field>
            </div>

            <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap gap-2">
                <Badge variant="outline">{parsedCidrs.length} CIDR</Badge>
                <Badge variant="outline">{parsedPorts.length} ports</Badge>
                <Badge variant={snmpCommunities || snmpV3Username ? 'default' : 'muted'}>
                  SNMP
                </Badge>
                <Badge variant={autoDiagram ? 'outline' : 'muted'}>
                  {autoDiagram ? 'Schéma auto' : 'Sans schéma'}
                </Badge>
              </div>
              <Button
                onClick={() => createCollector.mutate()}
                disabled={
                  !canEdit ||
                  !name.trim() ||
                  parsedCidrs.length === 0 ||
                  parsedPorts.length === 0 ||
                  createCollector.isPending
                }
              >
                <KeyRound className="h-4 w-4" />
                {createCollector.isPending
                  ? localized(language, 'Création...', 'Creating...')
                  : localized(language, 'Créer le collector', 'Create collector')}
              </Button>
            </div>
          </Card>

          {issuedToken && (
            <Card className="p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold">
                    {localized(language, "Assistant d'installation", 'Installation assistant')}
                  </h2>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {localized(
                      language,
                      'Token affiché une seule fois. Choisissez le mode d’installation du site client.',
                      'The token is shown once. Choose the customer site installation mode.',
                    )}
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    copyInstall(issuedToken.collector, issuedToken.token, installMode, snmp)
                  }
                >
                  <Clipboard className="h-4 w-4" /> Copier
                </Button>
              </div>
              <Tabs
                value={installMode}
                onValueChange={(value) => setInstallMode(value as typeof installMode)}
                className="mt-4"
              >
                <TabsList>
                  <TabsTrigger value="docker">
                    <Box className="h-4 w-4" />
                    Docker
                  </TabsTrigger>
                  <TabsTrigger value="linux">
                    <TerminalSquare className="h-4 w-4" />
                    Linux
                  </TabsTrigger>
                  <TabsTrigger value="windows">
                    <MonitorCog className="h-4 w-4" />
                    Windows
                  </TabsTrigger>
                  <TabsTrigger value="vm">
                    <HardDrive className="h-4 w-4" />
                    VM
                  </TabsTrigger>
                </TabsList>
                <TabsContent value="docker">
                  <InstallBlock
                    command={buildDockerCommand(issuedToken.collector, issuedToken.token, snmp)}
                  />
                </TabsContent>
                <TabsContent value="linux">
                  <InstallBlock
                    command={buildLinuxCommand(issuedToken.collector, issuedToken.token, snmp)}
                  />
                </TabsContent>
                <TabsContent value="windows">
                  <InstallBlock
                    command={buildWindowsCommand(issuedToken.collector, issuedToken.token, snmp)}
                  />
                </TabsContent>
                <TabsContent value="vm">
                  <InstallBlock
                    command={buildVmInstructions(issuedToken.collector, issuedToken.token, snmp)}
                  />
                </TabsContent>
              </Tabs>
              <div className="mt-4 flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => downloadEnvFile(issuedToken.collector, issuedToken.token, snmp)}
                >
                  <FileKey2 className="h-4 w-4" /> Télécharger collector.env
                </Button>
              </div>
            </Card>
          )}

          <div className="space-y-3">
            {(collectorsQuery.data?.collectors ?? []).map((collector) => (
              <CollectorOpsCard
                key={collector.id}
                collector={collector}
                busy={rotate.isPending || revoke.isPending}
                onRotate={() => rotate.mutate(collector)}
                onRevoke={() => revoke.mutate(collector)}
              />
            ))}
            {collectorsQuery.data?.collectors.length === 0 && (
              <EmptyState
                icon={KeyRound}
                title={localized(language, 'Aucun collector', 'No collector')}
                description={localized(
                  language,
                  'Créez un collector pour automatiser la découverte depuis le réseau client.',
                  'Create a collector to automate discovery from the customer network.',
                )}
              />
            )}
          </div>
        </div>

        <aside className="space-y-4">
          <Card className="p-4">
            <h2 className="text-sm font-semibold">
              {localized(language, 'Prérequis réseau', 'Network requirements')}
            </h2>
            <div className="mt-3 space-y-2 text-sm text-muted-foreground">
              <p>
                Le collector doit être installé dans le LAN à découvrir, avec sortie HTTPS vers
                Orbis.
              </p>
              <p>
                SNMPv3 est recommandé pour les équipements réseau. SNMPv2c reste supporté pour
                compatibilité.
              </p>
              <p>
                Docker est le mode le plus rapide. Linux service ou Windows service conviennent aux
                environnements verrouillés.
              </p>
            </div>
          </Card>
          <Card className="p-4">
            <h2 className="text-sm font-semibold">
              {localized(language, 'Version attendue', 'Expected version')}
            </h2>
            <div className="mt-3 flex items-center justify-between rounded-md border p-3">
              <span className="text-sm text-muted-foreground">
                {localized(language, 'Collector courant', 'Current collector')}
              </span>
              <Badge variant="default">{CURRENT_COLLECTOR_VERSION}</Badge>
            </div>
          </Card>
          <Card className="p-4">
            <h2 className="text-sm font-semibold">
              {localized(language, 'Téléchargements', 'Downloads')}
            </h2>
            <div className="mt-3 space-y-2">
              {(downloadsQuery.data?.files ?? []).map((item) => (
                <button
                  key={item.file}
                  type="button"
                  onClick={() =>
                    downloadAuthenticated(`/api/collectors/downloads/${item.file}`, item.file)
                  }
                  className="flex w-full items-center justify-between rounded-md border p-3 text-left text-sm transition-colors hover:bg-accent"
                >
                  <span>
                    <span className="font-medium">{item.label}</span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">
                      {formatBytes(item.size)}
                    </span>
                  </span>
                  <Download className="h-4 w-4 text-muted-foreground" />
                </button>
              ))}
              {!downloadsQuery.data && (
                <p className="text-sm text-muted-foreground">
                  {localized(
                    language,
                    'Artefacts non générés dans cet environnement.',
                    'Artifacts are not generated in this environment.',
                  )}
                </p>
              )}
            </div>
          </Card>
        </aside>
      </div>
    </PageContainer>
  );
}

function CollectorOpsCard({
  collector,
  busy,
  onRotate,
  onRevoke,
}: {
  collector: DiscoveryCollector;
  busy: boolean;
  onRotate: () => void;
  onRevoke: () => void;
}) {
  const { language } = useLanguage();
  const lastRun = collector.runs?.[0];
  const diagnostic = collector.logs?.find((log) => log.level === 'DIAGNOSTIC');
  const obsolete = isVersionOlder(collector.version, CURRENT_COLLECTOR_VERSION);
  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-semibold">{collector.name}</h2>
            <Badge
              className="w-fit max-w-full whitespace-nowrap"
              variant={collector.status === 'ACTIVE' ? 'default' : 'outline'}
            >
              {collector.status}
            </Badge>
            {collector.site && (
              <Badge className="w-fit max-w-full whitespace-nowrap" variant="outline">
                {collector.site.name}
              </Badge>
            )}
            {obsolete && (
              <Badge className="w-fit whitespace-nowrap" variant="warning">
                {localized(language, 'Upgrade requis', 'Upgrade required')}
              </Badge>
            )}
            <Badge
              className="w-fit whitespace-nowrap"
              variant={
                collector.failoverState === 'PRIMARY'
                  ? 'default'
                  : collector.failoverState === 'READY'
                    ? 'warning'
                    : 'outline'
              }
            >
              {failoverLabel(collector.failoverState, language)}
            </Badge>
            <Badge className="w-fit whitespace-nowrap" variant="outline">
              {roleLabel(collector.role, language)} · P{collector.priority}
            </Badge>
            <Badge
              className="w-fit whitespace-nowrap"
              variant={collector.autoDiagram === false ? 'muted' : 'outline'}
            >
              {collector.autoDiagram === false
                ? localized(language, 'Sans schéma auto', 'No automatic diagram')
                : localized(language, 'Schéma auto', 'Auto diagram')}
            </Badge>
            {(collector.tokenRotationDue || collector.tokenExpiresSoon) && (
              <Badge
                className="w-fit whitespace-nowrap"
                variant={collector.tokenRotationDue ? 'danger' : 'warning'}
              >
                {collector.tokenRotationDue
                  ? localized(language, 'Rotation requise', 'Rotation required')
                  : localized(language, 'Token bientôt expiré', 'Token expiring soon')}
              </Badge>
            )}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {localized(language, 'Dernière activité', 'Last activity')}:{' '}
            {collector.lastSeenAt
              ? formatDate(collector.lastSeenAt)
              : localized(language, 'jamais', 'never')}
            {collector.version ? ` · v${collector.version}` : ''}
            {' · '}Failover {collector.failoverAfterMinutes} min
            {collector.nextTokenRotationAt
              ? ` · prochaine rotation ${formatDate(collector.nextTokenRotationAt)}`
              : ''}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={onRotate} disabled={busy}>
            <KeyRound className="h-4 w-4" /> Nouveau token
          </Button>
          <Button
            variant="destructive"
            size="sm"
            onClick={onRevoke}
            disabled={busy || collector.status === 'REVOKED'}
          >
            {localized(language, 'Révoquer', 'Revoke')}
          </Button>
        </div>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-5">
        <Metric label="CIDR" value={collector.defaultCidrs.length} icon={Network} />
        <Metric label="Ports" value={collector.defaultPorts.length} icon={Radar} />
        <Metric
          label="Hôtes"
          value={Number(lastRun?.summary?.hostsSeen ?? collector.lastSummary?.hostsSeen ?? 0)}
          icon={Server}
        />
        <Metric
          label="SNMP"
          value={Number(lastRun?.summary?.snmpHosts ?? collector.lastSummary?.snmpHosts ?? 0)}
          icon={KeyRound}
        />
        <Metric
          label="Événements"
          value={Number(
            lastRun?.summary?.eventsCreated ?? collector.lastSummary?.eventsCreated ?? 0,
          )}
          icon={TriangleAlert}
        />
      </div>

      {diagnostic && (
        <div className="mt-4 rounded-md border p-3">
          <div className="mb-2 flex items-center gap-2 text-sm font-medium">
            <CheckCircle2 className="h-4 w-4 text-status-online" /> Diagnostic
          </div>
          <pre className="max-h-44 overflow-auto text-xs text-muted-foreground">
            {JSON.stringify(diagnostic.meta, null, 2)}
          </pre>
        </div>
      )}

      {(collector.logs?.length ?? 0) > 0 && (
        <div className="mt-4 overflow-hidden rounded-md border">
          <div className="grid grid-cols-[96px_minmax(0,1fr)_128px] bg-muted px-3 py-2 text-xs font-medium text-muted-foreground sm:grid-cols-[110px_minmax(0,1fr)_150px]">
            <span>{localized(language, 'Niveau', 'Severity')}</span>
            <span>{localized(language, 'Message', 'Message')}</span>
            <span>{localized(language, 'Date', 'Date')}</span>
          </div>
          {collector.logs!.slice(0, 8).map((log) => (
            <div
              key={log.id}
              className="grid grid-cols-[96px_minmax(0,1fr)_128px] items-center gap-2 border-t px-3 py-2 text-sm sm:grid-cols-[110px_minmax(0,1fr)_150px]"
            >
              <Badge
                className="w-fit whitespace-nowrap"
                variant={
                  log.level === 'ERROR'
                    ? 'danger'
                    : log.level === 'WARNING'
                      ? 'warning'
                      : log.level === 'DIAGNOSTIC'
                        ? 'default'
                        : 'outline'
                }
              >
                {log.level}
              </Badge>
              <span className="truncate" title={log.message}>
                {log.message}
              </span>
              <span className="text-muted-foreground">{formatDate(log.createdAt)}</span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function InstallBlock({ command }: { command: string }) {
  return (
    <pre className="mt-4 overflow-x-auto rounded-md border bg-muted p-3 text-xs">{command}</pre>
  );
}

function roleLabel(role?: DiscoveryCollector['role'], language: 'fr' | 'en' = 'fr') {
  if (role === 'PRIMARY') return localized(language, 'Primaire', 'Primary');
  if (role === 'SECONDARY') return localized(language, 'Secondaire', 'Secondary');
  if (role === 'STANDBY') return localized(language, 'Secours', 'Standby');
  return 'Collector';
}

function failoverLabel(state?: DiscoveryCollector['failoverState'], language: 'fr' | 'en' = 'fr') {
  if (state === 'PRIMARY') return localized(language, 'Actif', 'Active');
  if (state === 'STALE_PRIMARY') return localized(language, 'Actif en retard', 'Stale active');
  if (state === 'READY') return localized(language, 'Secours prêt', 'Standby ready');
  if (state === 'STANDBY') return localized(language, 'En attente', 'Standby');
  return localized(language, 'Indisponible', 'Unavailable');
}

function parsePorts(value: string, max = 12): number[] {
  return [
    ...new Set(
      value
        .split(/[,\s;]+/)
        .map(Number)
        .filter((port) => Number.isInteger(port) && port >= 1 && port <= 65_535),
    ),
  ].slice(0, max);
}

function parseCidrs(value: string): string[] {
  return value
    .split(/[,\s;]+/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 20);
}

type SnmpInputs = {
  snmpCommunities: string;
  snmpV3Username: string;
  snmpV3Level: string;
  snmpV3AuthProtocol: string;
  snmpV3AuthPassword: string;
  snmpV3PrivProtocol: string;
  snmpV3PrivPassword: string;
};

function copyInstall(
  collector: DiscoveryCollector,
  token: string,
  mode: 'docker' | 'linux' | 'windows' | 'vm',
  snmp: SnmpInputs,
) {
  const command =
    mode === 'docker'
      ? buildDockerCommand(collector, token, snmp)
      : mode === 'linux'
        ? buildLinuxCommand(collector, token, snmp)
        : mode === 'windows'
          ? buildWindowsCommand(collector, token, snmp)
          : buildVmInstructions(collector, token, snmp);
  navigator.clipboard.writeText(command);
}

function downloadEnvFile(collector: DiscoveryCollector, token: string, snmp: SnmpInputs) {
  const content = `${envLines(collector, token, snmp).join('\n')}\n`;
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `collector-${collector.id}.env`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function envLines(collector: DiscoveryCollector, token: string, snmp: SnmpInputs) {
  const lines = [
    `ORBIS_API_URL="${window.location.origin}"`,
    `ORBIS_COLLECTOR_ID="${collector.id}"`,
    `ORBIS_COLLECTOR_TOKEN="${token}"`,
    `ORBIS_CIDRS="${collector.defaultCidrs.join(',')}"`,
    `ORBIS_PORTS="${collector.defaultPorts.join(',')}"`,
  ];
  if (snmp.snmpCommunities.trim())
    lines.push(`ORBIS_SNMP_COMMUNITIES="${escapeShell(snmp.snmpCommunities.trim())}"`);
  if (snmp.snmpV3Username.trim()) {
    lines.push(`ORBIS_SNMPV3_USERNAME="${escapeShell(snmp.snmpV3Username.trim())}"`);
    lines.push(`ORBIS_SNMPV3_LEVEL="${escapeShell(snmp.snmpV3Level)}"`);
    if (snmp.snmpV3Level !== 'noAuthNoPriv') {
      lines.push(`ORBIS_SNMPV3_AUTH_PROTOCOL="${escapeShell(snmp.snmpV3AuthProtocol)}"`);
      lines.push(`ORBIS_SNMPV3_AUTH_PASSWORD="${escapeShell(snmp.snmpV3AuthPassword)}"`);
    }
    if (snmp.snmpV3Level === 'authPriv') {
      lines.push(`ORBIS_SNMPV3_PRIV_PROTOCOL="${escapeShell(snmp.snmpV3PrivProtocol)}"`);
      lines.push(`ORBIS_SNMPV3_PRIV_PASSWORD="${escapeShell(snmp.snmpV3PrivPassword)}"`);
    }
  }
  return lines;
}

function buildDockerCommand(collector: DiscoveryCollector, token: string, snmp: SnmpInputs) {
  return [
    'docker run -d --name orbis-collector --restart unless-stopped',
    '--network host',
    ...envLines(collector, token, snmp).map((line) => `-e ${line}`),
    'orbis-collector:latest',
  ].join(' \\\n  ');
}

function buildLinuxCommand(collector: DiscoveryCollector, token: string, snmp: SnmpInputs) {
  return [
    'sudo mkdir -p /etc/orbis-collector',
    `sudo tee /etc/orbis-collector/collector.env >/dev/null <<'EOF'\n${envLines(collector, token, snmp).join('\n')}\nEOF`,
    'sudo apt install ./orbis-collector_1.1.0_amd64.deb',
    'sudo systemctl enable --now orbis-collector',
    'sudo journalctl -u orbis-collector -f',
  ].join('\n');
}

function buildWindowsCommand(collector: DiscoveryCollector, token: string, snmp: SnmpInputs) {
  return [
    'msiexec /i OrbisCollector-1.1.0-x64.msi /qn',
    ...envLines(collector, token, snmp).map((line) => {
      const [key, value] = line.split('=');
      return `[Environment]::SetEnvironmentVariable("${key}", ${value}, "Machine")`;
    }),
    'Restart-Service OrbisCollector',
    'Get-EventLog -LogName Application -Source OrbisCollector -Newest 20',
  ].join('\n');
}

function buildVmInstructions(collector: DiscoveryCollector, token: string, snmp: SnmpInputs) {
  return [
    '1. Déployer l’appliance Orbis Collector sur Proxmox, VMware ou Hyper-V.',
    '2. Placer la VM sur le VLAN qui voit les équipements à découvrir.',
    '3. Ouvrir la console VM et coller cette configuration :',
    '',
    envLines(collector, token, snmp).join('\n'),
    '',
    '4. Lancer : sudo systemctl restart orbis-collector',
  ].join('\n');
}

function escapeShell(value: string) {
  return value.replace(/["\\$`]/g, '\\$&');
}

function isVersionOlder(version: string | null | undefined, expected: string) {
  if (!version) return true;
  const left = version.split('.').map(Number);
  const right = expected.split('.').map(Number);
  for (let index = 0; index < right.length; index += 1) {
    if ((left[index] ?? 0) < right[index]) return true;
    if ((left[index] ?? 0) > right[index]) return false;
  }
  return false;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('fr-FR', { dateStyle: 'short', timeStyle: 'short' }).format(
    new Date(value),
  );
}

function formatBytes(value: number) {
  if (value < 1024) return `${value} o`;
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} Ko`;
  return `${(value / 1024 / 1024).toFixed(1)} Mo`;
}

function Metric({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: number;
  icon: React.ComponentType<{ className?: string }>;
}) {
  return (
    <div className="rounded-md border bg-background p-3">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Icon className="h-4 w-4" />
        {label}
      </div>
      <p className="mt-2 text-2xl font-semibold">{value}</p>
    </div>
  );
}
