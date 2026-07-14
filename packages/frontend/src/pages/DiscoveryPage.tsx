import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowRight,
  Copy,
  FileSearch,
  KeyRound,
  Network,
  Radar,
  Server,
  ShieldAlert,
  Wand2,
} from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/hooks/useAuth';
import { useCurrentSite } from '@/hooks/useCurrentSite';
import { useToast } from '@/hooks/useToast';
import { localized, useLanguage } from '@/hooks/useLanguage';
import { PageContainer, PageHeader } from '@/components/layout/PageHeader';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input, Textarea } from '@/components/ui/Input';
import { Field } from '@/components/ui/Label';
import { Select } from '@/components/ui/Select';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/Empty';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/Tabs';
import type { DiscoveryCollector, DiscoveryFormat, DiscoveryImportResult } from '@/types';
import { cn } from '@/lib/utils';

const EXAMPLES: Record<DiscoveryFormat, string> = {
  AUTO: 'localDevice,localPort,remoteDevice,remotePort,protocol,speed,vlan\nSW-CORE-01,Gi1/0/1,FW-EDGE-01,port1,CSV,10G,10\nSW-CORE-01,Gi1/0/2,SW-ACCESS-01,Gi0/48,CSV,1G,20',
  LINKS_CSV:
    'localDevice,localPort,remoteDevice,remotePort,protocol,speed,vlan\nSW-CORE-01,Gi1/0/1,FW-EDGE-01,port1,CSV,10G,10\nSW-CORE-01,Gi1/0/2,SW-ACCESS-01,Gi0/48,CSV,1G,20',
  CDP: 'Device ID: SW-ACCESS-01\nInterface: GigabitEthernet1/0/2, Port ID (outgoing port): GigabitEthernet0/48\n\nDevice ID: FW-EDGE-01\nInterface: TenGigabitEthernet1/1/1, Port ID (outgoing port): port1',
  LLDP: 'Local Intf: Gi1/0/2\nSystem Name: SW-ACCESS-01\nPort id: Gi0/48\n\nLocal Intf: Te1/1/1\nSystem Name: FW-EDGE-01\nPort id: port1',
  ARP: 'Internet  192.168.10.1  0  aabb.ccdd.eeff  ARPA  Vlan10\nInternet  192.168.10.25  12  00:11:22:33:44:55  ARPA  Vlan10',
};

const FORMATS: Array<{ value: DiscoveryFormat; label: string }> = [
  { value: 'AUTO', label: 'Détection automatique' },
  { value: 'LINKS_CSV', label: 'CSV liens' },
  { value: 'CDP', label: 'Cisco CDP' },
  { value: 'LLDP', label: 'LLDP' },
  { value: 'ARP', label: 'ARP / IP-MAC' },
];

const DEFAULT_SCAN_PORTS = '22,80,443,445,3389,8080,8443,9100';

export default function DiscoveryPage() {
  const { language } = useLanguage();
  const { canEdit, isAdmin } = useAuth();
  const { siteId } = useCurrentSite();
  const toast = useToast();
  const qc = useQueryClient();
  const [format, setFormat] = useState<DiscoveryFormat>('AUTO');
  const [content, setContent] = useState(EXAMPLES.AUTO);
  const [localDevice, setLocalDevice] = useState('');
  const [diagramMode, setDiagramMode] = useState<'none' | 'new' | 'existing'>('none');
  const [diagramId, setDiagramId] = useState('');
  const [diagramName, setDiagramName] = useState('Network discovery');
  const [scanCidr, setScanCidr] = useState('192.168.1.0/24');
  const [scanPortsInput, setScanPortsInput] = useState(DEFAULT_SCAN_PORTS);
  const [scanTimeout, setScanTimeout] = useState(900);
  const [collectorName, setCollectorName] = useState('Collector principal');
  const [collectorCidrs, setCollectorCidrs] = useState('192.168.1.0/24');
  const [collectorPorts, setCollectorPorts] = useState(DEFAULT_SCAN_PORTS);
  const [collectorAutoDiagram, setCollectorAutoDiagram] = useState(true);
  const [collectorSnmpCommunities, setCollectorSnmpCommunities] = useState('');
  const [collectorSnmpV3Username, setCollectorSnmpV3Username] = useState('');
  const [collectorSnmpV3Level, setCollectorSnmpV3Level] = useState('authPriv');
  const [collectorSnmpV3AuthProtocol, setCollectorSnmpV3AuthProtocol] = useState('sha256');
  const [collectorSnmpV3AuthPassword, setCollectorSnmpV3AuthPassword] = useState('');
  const [collectorSnmpV3PrivProtocol, setCollectorSnmpV3PrivProtocol] = useState('aes');
  const [collectorSnmpV3PrivPassword, setCollectorSnmpV3PrivPassword] = useState('');
  const [collectorToken, setCollectorToken] = useState<{
    collector: DiscoveryCollector;
    token: string;
  } | null>(null);
  const [result, setResult] = useState<DiscoveryImportResult | null>(null);
  const [applyMode, setApplyMode] = useState<'APPLY' | 'PROPOSE'>('APPLY');

  const diagramsQuery = useQuery({
    queryKey: ['diagrams', siteId],
    queryFn: () => api.diagrams.list(siteId),
  });
  const collectorsQuery = useQuery({
    queryKey: ['collectors', siteId],
    queryFn: () => api.collectors.list({ siteId }),
  });
  const proposalsQuery = useQuery({
    queryKey: ['discovery-proposals'],
    queryFn: () => api.discovery.proposals(),
    enabled: isAdmin,
  });

  const requiresLocalDevice = format === 'CDP' || format === 'LLDP';
  const selectedDiagramId = diagramMode === 'existing' ? diagramId || null : null;
  const effectiveDiagramName = diagramMode === 'new' ? diagramName.trim() || null : null;
  const scanPorts = useMemo(() => parsePorts(scanPortsInput), [scanPortsInput]);
  const collectorParsedPorts = useMemo(() => parsePorts(collectorPorts, 32), [collectorPorts]);
  const collectorParsedCidrs = useMemo(() => parseCidrs(collectorCidrs), [collectorCidrs]);

  const stats = useMemo(() => {
    const lines = content.split(/\r?\n/).filter((line) => line.trim());
    return { lines: lines.length, chars: content.length };
  }, [content]);

  const invalidateDiscoveryTargets = () => {
    qc.invalidateQueries({ queryKey: ['devices'] });
    qc.invalidateQueries({ queryKey: ['diagrams'] });
    qc.invalidateQueries({ queryKey: ['ipam'] });
    qc.invalidateQueries({ queryKey: ['stats'] });
    qc.invalidateQueries({ queryKey: ['collectors'] });
  };

  const importMutation = useMutation({
    mutationFn: () =>
      api.discovery.import({
        format,
        content,
        siteId: siteId ?? null,
        diagramId: selectedDiagramId,
        diagramName: effectiveDiagramName,
        localDevice: localDevice.trim() || null,
        applyMode,
      }),
    onSuccess: (data) => {
      setResult(data);
      invalidateDiscoveryTargets();
      if (data.pendingApproval)
        toast.success(
          localized(language, 'Proposition envoyée', 'Proposal submitted'),
          localized(
            language,
            'Un administrateur doit approuver les changements.',
            'An administrator must approve the changes.',
          ),
        );
      else
        toast.success(
          localized(language, 'Découverte importée', 'Discovery imported'),
          `${data.devicesCreated} ${localized(language, 'équipement(s) créé(s)', 'device(s) created')}, ${data.linksDiscovered} ${localized(language, 'lien(s)', 'link(s)')}`,
        );
    },
    onError: (err: any) =>
      toast.error(localized(language, 'Découverte impossible', 'Discovery failed'), err.message),
  });

  const scanMutation = useMutation({
    mutationFn: () =>
      api.discovery.scan({
        cidr: scanCidr.trim(),
        ports: scanPorts,
        timeoutMs: scanTimeout,
        siteId: siteId ?? null,
        diagramId: selectedDiagramId,
        diagramName: effectiveDiagramName,
      }),
    onSuccess: (data) => {
      setResult(data);
      invalidateDiscoveryTargets();
      toast.success(
        localized(language, 'Scan terminé', 'Scan completed'),
        `${data.hostsUp ?? 0} ${localized(language, 'hôte(s) actif(s)', 'active host(s)')}, ${data.devicesCreated} ${localized(language, 'équipement(s) créé(s)', 'device(s) created')}`,
      );
    },
    onError: (err: any) =>
      toast.error(localized(language, 'Scan impossible', 'Scan failed'), err.message),
  });

  const createCollectorMutation = useMutation({
    mutationFn: () =>
      api.collectors.create({
        name: collectorName.trim(),
        siteId: siteId ?? null,
        defaultCidrs: collectorParsedCidrs,
        defaultPorts: collectorParsedPorts,
        autoDiagram: collectorAutoDiagram,
      }),
    onSuccess: (data) => {
      setCollectorToken(data);
      invalidateDiscoveryTargets();
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

  const rotateCollectorMutation = useMutation({
    mutationFn: (collector: DiscoveryCollector) => api.collectors.rotateToken(collector.id),
    onSuccess: (data) => {
      setCollectorToken(data);
      invalidateDiscoveryTargets();
      toast.success(
        localized(language, 'Token renouvelé', 'Token rotated'),
        localized(
          language,
          'Mettez à jour le collector installé.',
          'Update the installed collector.',
        ),
      );
    },
    onError: (err: any) =>
      toast.error(localized(language, 'Rotation impossible', 'Rotation failed'), err.message),
  });

  const revokeCollectorMutation = useMutation({
    mutationFn: (collector: DiscoveryCollector) => api.collectors.revoke(collector.id),
    onSuccess: () => {
      invalidateDiscoveryTargets();
      toast.success(localized(language, 'Collector révoqué', 'Collector revoked'));
    },
    onError: (err: any) =>
      toast.error(localized(language, 'Révocation impossible', 'Revocation failed'), err.message),
  });

  const loadExample = (nextFormat: DiscoveryFormat) => {
    setFormat(nextFormat);
    setContent(EXAMPLES[nextFormat]);
  };

  const diagramBlocked = diagramMode === 'existing' && !diagramId;

  return (
    <PageContainer>
      <PageHeader
        title={language === 'fr' ? 'Découverte' : 'Discovery'}
        description={localized(
          language,
          'Import de données réseau et scan contrôlé pour alimenter l’inventaire, l’IPAM et, si besoin, les schémas',
          'Import network data and run controlled scans to populate inventory, IPAM and, when selected, diagrams',
        )}
      />

      <div className="grid gap-5 px-6 pt-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-5">
          <Card className="p-4">
            <Field
              label={localized(language, 'Application des changements', 'Change application')}
              hint={localized(
                language,
                'Les propositions n’affectent pas l’inventaire avant validation',
                'Proposals do not affect inventory before approval',
              )}
            >
              <Select
                value={applyMode}
                onChange={(event) => setApplyMode(event.target.value as 'APPLY' | 'PROPOSE')}
              >
                <option value="APPLY">
                  {localized(language, 'Appliquer immédiatement', 'Apply immediately')}
                </option>
                <option value="PROPOSE">
                  {localized(language, 'Soumettre à validation', 'Submit for approval')}
                </option>
              </Select>
            </Field>
          </Card>
          <Card className="p-4">
            <div className="grid gap-4 md:grid-cols-2">
              <Field
                label={localized(language, 'Impact schéma', 'Diagram impact')}
                hint={localized(language, 'Optionnel', 'Optional')}
              >
                <Select
                  value={diagramMode}
                  onChange={(e) => setDiagramMode(e.target.value as 'none' | 'new' | 'existing')}
                >
                  <option value="none">
                    {localized(language, 'Ne pas modifier de schéma', 'Do not modify a diagram')}
                  </option>
                  <option value="new">
                    {localized(language, 'Créer un nouveau schéma', 'Create a new diagram')}
                  </option>
                  <option value="existing">
                    {localized(
                      language,
                      'Enrichir un schéma existant',
                      'Enrich an existing diagram',
                    )}
                  </option>
                </Select>
              </Field>
              {diagramMode === 'new' ? (
                <Field label={localized(language, 'Nom du schéma', 'Diagram name')}>
                  <Input value={diagramName} onChange={(e) => setDiagramName(e.target.value)} />
                </Field>
              ) : (
                <Field label={localized(language, 'Schéma existant', 'Existing diagram')}>
                  <Select value={diagramId} onChange={(e) => setDiagramId(e.target.value)}>
                    <option value="">{localized(language, 'Sélectionner…', 'Select…')}</option>
                    {(diagramsQuery.data?.diagrams ?? []).map((diagram) => (
                      <option key={diagram.id} value={diagram.id}>
                        {diagram.name}
                      </option>
                    ))}
                  </Select>
                </Field>
              )}
            </div>
          </Card>

          <Tabs defaultValue="import">
            <TabsList>
              <TabsTrigger value="import">
                <FileSearch className="h-4 w-4" />
                {language === 'fr' ? 'Import manuel' : 'Manual import'}
              </TabsTrigger>
              <TabsTrigger value="scan">
                <Radar className="h-4 w-4" />
                {language === 'fr' ? 'Scan réseau' : 'Network scan'}
              </TabsTrigger>
              <TabsTrigger value="collectors">
                <KeyRound className="h-4 w-4" />
                Collectors
              </TabsTrigger>
            </TabsList>

            <TabsContent value="import">
              <Card className="p-4">
                <div className="grid gap-4 md:grid-cols-2">
                  <Field label="Format">
                    <Select
                      value={format}
                      onChange={(e) => loadExample(e.target.value as DiscoveryFormat)}
                    >
                      {FORMATS.map((item) => (
                        <option key={item.value} value={item.value}>
                          {language === 'fr'
                            ? item.label
                            : item.value === 'AUTO'
                              ? 'Automatic detection'
                              : item.value === 'LINKS_CSV'
                                ? 'Links CSV'
                                : item.label}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field
                    label={localized(language, 'Équipement local', 'Local device')}
                    hint={localized(
                      language,
                      'Requis pour CDP/LLDP détaillé si le hostname local n’est pas dans la sortie',
                      'Required for detailed CDP/LLDP when the local hostname is not in the output',
                    )}
                  >
                    <Input
                      value={localDevice}
                      onChange={(e) => setLocalDevice(e.target.value)}
                      placeholder="SW-CORE-01"
                      disabled={!requiresLocalDevice}
                    />
                  </Field>
                </div>

                <Field
                  label={localized(language, 'Données à importer', 'Data to import')}
                  hint={`${stats.lines} ligne(s), ${stats.chars} caractère(s)`}
                  className="mt-4"
                >
                  <Textarea
                    rows={15}
                    value={content}
                    onChange={(e) => setContent(e.target.value)}
                    className="font-mono text-xs"
                    placeholder={localized(
                      language,
                      'Collez ici une sortie CDP/LLDP/ARP ou un CSV de liens',
                      'Paste CDP/LLDP/ARP output or a links CSV here',
                    )}
                  />
                </Field>

                <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-wrap gap-2">
                    {FORMATS.filter((item) => item.value !== 'AUTO').map((item) => (
                      <Button
                        key={item.value}
                        variant="outline"
                        size="sm"
                        onClick={() => loadExample(item.value)}
                      >
                        {localized(language, 'Exemple', 'Example')}{' '}
                        {language === 'fr'
                          ? item.label
                          : item.value === 'LINKS_CSV'
                            ? 'Links CSV'
                            : item.label}
                      </Button>
                    ))}
                  </div>
                  <Button
                    onClick={() => importMutation.mutate()}
                    disabled={
                      !canEdit ||
                      !content.trim() ||
                      importMutation.isPending ||
                      (requiresLocalDevice && !localDevice.trim()) ||
                      diagramBlocked
                    }
                  >
                    <Wand2 className="h-4 w-4" />
                    {importMutation.isPending
                      ? localized(language, 'Import…', 'Importing…')
                      : localized(language, 'Importer et rapprocher', 'Import and reconcile')}
                  </Button>
                </div>
              </Card>
            </TabsContent>

            <TabsContent value="scan">
              <Card className="p-4">
                <div className="grid gap-4 md:grid-cols-[1fr_1fr_160px]">
                  <Field
                    label={localized(language, 'Plage CIDR', 'CIDR range')}
                    hint={localized(
                      language,
                      'Plages privées ou loopback, 256 hôtes maximum',
                      'Private or loopback ranges, 256 hosts maximum',
                    )}
                  >
                    <Input
                      value={scanCidr}
                      onChange={(e) => setScanCidr(e.target.value)}
                      placeholder="192.168.1.0/24"
                    />
                  </Field>
                  <Field
                    label={localized(language, 'Ports TCP', 'TCP ports')}
                    hint={localized(
                      language,
                      'Séparés par virgules, 12 ports maximum',
                      'Comma-separated, 12 ports maximum',
                    )}
                  >
                    <Input
                      value={scanPortsInput}
                      onChange={(e) => setScanPortsInput(e.target.value)}
                      placeholder={DEFAULT_SCAN_PORTS}
                    />
                  </Field>
                  <Field label="Timeout">
                    <Input
                      type="number"
                      min={200}
                      max={5000}
                      value={scanTimeout}
                      onChange={(e) => setScanTimeout(Number(e.target.value))}
                    />
                  </Field>
                </div>

                <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-wrap gap-2">
                    <Badge variant="outline">{scanPorts.length} port(s)</Badge>
                    <Badge variant="outline">TCP</Badge>
                    <Badge variant="outline">
                      {localized(language, 'Inventaire + IPAM', 'Inventory + IPAM')}
                    </Badge>
                  </div>
                  <Button
                    onClick={() => scanMutation.mutate()}
                    disabled={
                      !canEdit ||
                      !scanCidr.trim() ||
                      scanPorts.length === 0 ||
                      scanMutation.isPending ||
                      diagramBlocked
                    }
                  >
                    <Radar className="h-4 w-4" />
                    {scanMutation.isPending
                      ? localized(language, 'Scan…', 'Scanning…')
                      : localized(language, 'Scanner et rapprocher', 'Scan and reconcile')}
                  </Button>
                </div>
              </Card>
            </TabsContent>

            <TabsContent value="collectors">
              <div className="space-y-4">
                <Card className="p-4">
                  <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                    <Field label="Nom">
                      <Input
                        value={collectorName}
                        onChange={(e) => setCollectorName(e.target.value)}
                        placeholder={localized(
                          language,
                          'Collector siège',
                          'Headquarters collector',
                        )}
                      />
                    </Field>
                    <Field
                      label={localized(language, 'CIDR à scanner', 'CIDRs to scan')}
                      hint={localized(language, 'Séparés par virgules', 'Comma-separated')}
                    >
                      <Input
                        value={collectorCidrs}
                        onChange={(e) => setCollectorCidrs(e.target.value)}
                        placeholder="192.168.1.0/24"
                      />
                    </Field>
                    <Field label="Ports TCP">
                      <Input
                        value={collectorPorts}
                        onChange={(e) => setCollectorPorts(e.target.value)}
                        placeholder={DEFAULT_SCAN_PORTS}
                      />
                    </Field>
                    <Field label={localized(language, 'Schéma automatique', 'Automatic diagram')}>
                      <Select
                        value={collectorAutoDiagram ? 'yes' : 'no'}
                        onChange={(e) => setCollectorAutoDiagram(e.target.value === 'yes')}
                      >
                        <option value="yes">
                          {localized(language, 'Mettre à jour le schéma', 'Update diagram')}
                        </option>
                        <option value="no">
                          {localized(
                            language,
                            'Ne pas modifier de schéma',
                            'Do not modify a diagram',
                          )}
                        </option>
                      </Select>
                    </Field>
                    <Field
                      label="SNMP"
                      hint={localized(
                        language,
                        'Optionnel, séparé par virgules',
                        'Optional, comma-separated',
                      )}
                    >
                      <Input
                        value={collectorSnmpCommunities}
                        onChange={(e) => setCollectorSnmpCommunities(e.target.value)}
                        placeholder="public, supervision"
                      />
                    </Field>
                  </div>
                  <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                    <Field label="SNMPv3 user" hint="Optionnel">
                      <Input
                        value={collectorSnmpV3Username}
                        onChange={(e) => setCollectorSnmpV3Username(e.target.value)}
                        placeholder="snmp-reader"
                      />
                    </Field>
                    <Field label={localized(language, 'SNMPv3 sécurité', 'SNMPv3 security')}>
                      <Select
                        value={collectorSnmpV3Level}
                        onChange={(e) => setCollectorSnmpV3Level(e.target.value)}
                      >
                        <option value="authPriv">authPriv</option>
                        <option value="authNoPriv">authNoPriv</option>
                        <option value="noAuthNoPriv">noAuthNoPriv</option>
                      </Select>
                    </Field>
                    <Field label="Auth protocol">
                      <Select
                        value={collectorSnmpV3AuthProtocol}
                        onChange={(e) => setCollectorSnmpV3AuthProtocol(e.target.value)}
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
                        value={collectorSnmpV3AuthPassword}
                        onChange={(e) => setCollectorSnmpV3AuthPassword(e.target.value)}
                        placeholder="••••••••"
                      />
                    </Field>
                    <Field label="Priv protocol">
                      <Select
                        value={collectorSnmpV3PrivProtocol}
                        onChange={(e) => setCollectorSnmpV3PrivProtocol(e.target.value)}
                      >
                        <option value="aes">AES</option>
                        <option value="aes256b">AES-256</option>
                        <option value="des">DES</option>
                      </Select>
                    </Field>
                    <Field label="Priv password">
                      <Input
                        type="password"
                        value={collectorSnmpV3PrivPassword}
                        onChange={(e) => setCollectorSnmpV3PrivPassword(e.target.value)}
                        placeholder="••••••••"
                      />
                    </Field>
                  </div>
                  <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                    <div className="flex flex-wrap gap-2">
                      <Badge variant="outline">{collectorParsedCidrs.length} CIDR</Badge>
                      <Badge variant="outline">{collectorParsedPorts.length} port(s)</Badge>
                      {collectorSnmpV3Username.trim() && <Badge variant="outline">SNMPv3</Badge>}
                      <Badge variant={collectorAutoDiagram ? 'outline' : 'muted'}>
                        {collectorAutoDiagram
                          ? localized(language, 'Schéma auto', 'Auto diagram')
                          : localized(language, 'Sans schéma', 'No diagram')}
                      </Badge>
                      <Badge variant="outline">
                        {localized(language, 'Token dédié', 'Dedicated token')}
                      </Badge>
                    </div>
                    <Button
                      onClick={() => createCollectorMutation.mutate()}
                      disabled={
                        !canEdit ||
                        !collectorName.trim() ||
                        collectorParsedCidrs.length === 0 ||
                        collectorParsedPorts.length === 0 ||
                        createCollectorMutation.isPending
                      }
                    >
                      <KeyRound className="h-4 w-4" />
                      {createCollectorMutation.isPending
                        ? localized(language, 'Création…', 'Creating…')
                        : localized(language, 'Créer le collector', 'Create collector')}
                    </Button>
                  </div>
                </Card>

                {collectorToken && (
                  <Card className="p-4">
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <div>
                        <h2 className="text-sm font-semibold">
                          {localized(language, 'Installation Docker', 'Docker installation')}
                        </h2>
                        <p className="text-xs text-muted-foreground">
                          {localized(
                            language,
                            'Token affiché une seule fois. Une rotation invalide l’ancien token.',
                            'The token is shown once. Rotating it invalidates the previous token.',
                          )}
                        </p>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          navigator.clipboard.writeText(
                            buildCollectorCommand(
                              collectorToken.collector,
                              collectorToken.token,
                              buildSnmpOptions({
                                communities: collectorSnmpCommunities,
                                v3Username: collectorSnmpV3Username,
                                v3Level: collectorSnmpV3Level,
                                v3AuthProtocol: collectorSnmpV3AuthProtocol,
                                v3AuthPassword: collectorSnmpV3AuthPassword,
                                v3PrivProtocol: collectorSnmpV3PrivProtocol,
                                v3PrivPassword: collectorSnmpV3PrivPassword,
                              }),
                            ),
                          )
                        }
                      >
                        <Copy className="h-4 w-4" />
                        Copier
                      </Button>
                    </div>
                    <pre className="overflow-x-auto rounded-md border bg-muted p-3 text-xs">
                      {buildCollectorCommand(
                        collectorToken.collector,
                        collectorToken.token,
                        buildSnmpOptions({
                          communities: collectorSnmpCommunities,
                          v3Username: collectorSnmpV3Username,
                          v3Level: collectorSnmpV3Level,
                          v3AuthProtocol: collectorSnmpV3AuthProtocol,
                          v3AuthPassword: collectorSnmpV3AuthPassword,
                          v3PrivProtocol: collectorSnmpV3PrivProtocol,
                          v3PrivPassword: collectorSnmpV3PrivPassword,
                        }),
                      )}
                    </pre>
                  </Card>
                )}

                <div className="space-y-3">
                  {(collectorsQuery.data?.collectors ?? []).map((collector) => (
                    <CollectorCard
                      key={collector.id}
                      collector={collector}
                      onRotate={() => rotateCollectorMutation.mutate(collector)}
                      onRevoke={() => revokeCollectorMutation.mutate(collector)}
                      busy={rotateCollectorMutation.isPending || revokeCollectorMutation.isPending}
                    />
                  ))}
                  {collectorsQuery.data?.collectors.length === 0 && (
                    <EmptyState
                      icon={KeyRound}
                      title={localized(language, 'Aucun collector', 'No collector')}
                      description={localized(
                        language,
                        'Créez un collector pour découvrir automatiquement les réseaux depuis le LAN client.',
                        'Create a collector to automatically discover networks from the customer LAN.',
                      )}
                    />
                  )}
                </div>
              </div>
            </TabsContent>
          </Tabs>

          {result && (
            <Card className="p-4">
              <div className="mb-4 flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold">
                    {localized(language, 'Résultat de découverte', 'Discovery result')}
                  </h2>
                  <p className="text-xs text-muted-foreground">
                    {result.diagram
                      ? localized(
                          language,
                          'Inventaire, IPAM et schéma ont été rapprochés.',
                          'Inventory, IPAM and diagram were reconciled.',
                        )
                      : localized(
                          language,
                          'Inventaire et IPAM ont été rapprochés sans modifier de schéma.',
                          'Inventory and IPAM were reconciled without modifying a diagram.',
                        )}
                  </p>
                </div>
                {result.diagram && (
                  <Button asChild size="sm">
                    <Link to={`/diagrams/${result.diagram.id}`}>
                      {localized(language, 'Ouvrir le schéma', 'Open diagram')}{' '}
                      <ArrowRight className="h-4 w-4" />
                    </Link>
                  </Button>
                )}
              </div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                <Metric label="Créés" value={result.devicesCreated} icon={Server} />
                <Metric label="Rapprochés" value={result.devicesMatched} icon={FileSearch} />
                <Metric label="Liens" value={result.linksDiscovered} icon={Network} />
                <Metric label="IP créées" value={result.ipAddressesCreated} icon={Radar} />
                <Metric label="IP connues" value={result.ipAddressesMatched} icon={FileSearch} />
              </div>
              {typeof result.hostsScanned === 'number' && (
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <Metric label="Hôtes scannés" value={result.hostsScanned} icon={Radar} />
                  <Metric label="Hôtes actifs" value={result.hostsUp ?? 0} icon={Server} />
                </div>
              )}
              {(result.openPorts?.length ?? 0) > 0 && (
                <div className="mt-4 overflow-hidden rounded-md border">
                  <div className="grid grid-cols-[1fr_1fr_1fr] bg-muted px-3 py-2 text-xs font-medium text-muted-foreground">
                    <span>Adresse</span>
                    <span>Ports</span>
                    <span>Équipement</span>
                  </div>
                  {result.openPorts!.map((host) => (
                    <div
                      key={host.address}
                      className="grid grid-cols-[1fr_1fr_1fr] border-t px-3 py-2 text-sm"
                    >
                      <span>{host.address}</span>
                      <span>{host.ports.join(', ')}</span>
                      <span>{host.deviceName}</span>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          )}
        </div>
        {isAdmin && (proposalsQuery.data?.proposals ?? []).length > 0 && (
          <Card className="p-4 xl:col-span-2">
            <p className="text-sm font-semibold">Validations en attente</p>
            <div className="mt-3 space-y-2">
              {proposalsQuery.data!.proposals.map((proposal) => (
                <div
                  key={proposal.id}
                  className="flex flex-wrap items-center justify-between gap-3 border-t pt-3 text-sm"
                >
                  <span>
                    {proposal.source} · {proposal.summary?.links ?? 0} lien(s),{' '}
                    {proposal.summary?.arp ?? 0} IP · {proposal.createdBy?.name ?? 'Utilisateur'}
                  </span>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      onClick={async () => {
                        await api.discovery.reviewProposal(proposal.id, 'APPROVE');
                        qc.invalidateQueries({ queryKey: ['discovery-proposals'] });
                        invalidateDiscoveryTargets();
                      }}
                    >
                      Approuver
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={async () => {
                        await api.discovery.reviewProposal(proposal.id, 'REJECT');
                        qc.invalidateQueries({ queryKey: ['discovery-proposals'] });
                      }}
                    >
                      Refuser
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        )}

        <aside className="space-y-4">
          <Card className="p-4">
            <h2 className="text-sm font-semibold">Rapprochement</h2>
            <div className="mt-3 space-y-2 text-sm text-muted-foreground">
              <p>
                Les équipements sont rapprochés par nom ou adresse détectée dans l’organisation
                active.
              </p>
              <p>
                {localized(
                  language,
                  'Les IP découvertes sont ajoutées comme adresses assignées dans l’IPAM.',
                  'Discovered IPs are added as assigned addresses in IPAM.',
                )}
              </p>
              <p>
                Les liens physiques peuvent enrichir un schéma uniquement si cette option est
                choisie.
              </p>
            </div>
          </Card>

          <Card className="p-4">
            <h2 className="text-sm font-semibold">Champs CSV liens</h2>
            <div className="mt-3 space-y-2">
              <Badge variant="outline">localDevice</Badge>
              <Badge variant="outline">localPort</Badge>
              <Badge variant="outline">remoteDevice</Badge>
              <Badge variant="outline">remotePort</Badge>
              <Badge variant="outline">speed</Badge>
              <Badge variant="outline">vlan</Badge>
            </div>
          </Card>

          {!canEdit && (
            <EmptyState
              icon={FileSearch}
              title="Lecture seule"
              description={localized(
                language,
                'Un rôle éditeur ou administrateur est requis pour lancer une découverte.',
                'An editor or administrator role is required to run discovery.',
              )}
            />
          )}
        </aside>
      </div>
    </PageContainer>
  );
}

function CollectorCard({
  collector,
  onRotate,
  onRevoke,
  busy,
}: {
  collector: DiscoveryCollector;
  onRotate: () => void;
  onRevoke: () => void;
  busy: boolean;
}) {
  const { language } = useLanguage();
  const lastRun = collector.runs?.[0];
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
            <Badge
              className="w-fit max-w-full whitespace-nowrap"
              variant={collector.autoDiagram === false ? 'muted' : 'outline'}
            >
              {collector.autoDiagram === false
                ? localized(language, 'Sans schéma auto', 'No automatic diagram')
                : localized(language, 'Schéma auto', 'Auto diagram')}
            </Badge>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {localized(language, 'Dernière activité', 'Last activity')}:{' '}
            {collector.lastSeenAt
              ? formatDate(collector.lastSeenAt)
              : localized(language, 'jamais', 'never')}
            {collector.lastIp ? ` · ${collector.lastIp}` : ''}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={onRotate} disabled={busy}>
            <KeyRound className="h-4 w-4" />
            {localized(language, 'Nouveau token', 'New token')}
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

      <div className="mt-4 grid gap-3 sm:grid-cols-4">
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
          label={localized(language, 'Événements', 'Events')}
          value={Number(
            lastRun?.summary?.eventsCreated ?? collector.lastSummary?.eventsCreated ?? 0,
          )}
          icon={FileSearch}
        />
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-4">
        <Metric
          label="Nouveaux"
          value={Number(lastRun?.summary?.newDevices ?? collector.lastSummary?.newDevices ?? 0)}
          icon={Server}
        />
        <Metric
          label="Down"
          value={Number(lastRun?.summary?.downDevices ?? collector.lastSummary?.downDevices ?? 0)}
          icon={Radar}
        />
        <Metric
          label={localized(language, 'Ports changés', 'Changed ports')}
          value={Number(lastRun?.summary?.portChanges ?? collector.lastSummary?.portChanges ?? 0)}
          icon={Network}
        />
        <Metric
          label={localized(language, 'IP changées', 'Changed IPs')}
          value={Number(lastRun?.summary?.ipChanges ?? collector.lastSummary?.ipChanges ?? 0)}
          icon={FileSearch}
        />
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-4">
        <Metric
          label="CDP"
          value={Number(lastRun?.summary?.cdpLinks ?? collector.lastSummary?.cdpLinks ?? 0)}
          icon={Network}
        />
        <Metric
          label="ARP SNMP"
          value={Number(lastRun?.summary?.arpEntries ?? collector.lastSummary?.arpEntries ?? 0)}
          icon={Radar}
        />
        <Metric
          label="MAC table"
          value={Number(lastRun?.summary?.macEntries ?? collector.lastSummary?.macEntries ?? 0)}
          icon={FileSearch}
        />
        <Metric
          label="VLANs"
          value={Number(lastRun?.summary?.vlansSeen ?? collector.lastSummary?.vlansSeen ?? 0)}
          icon={Network}
        />
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <Metric
          label="Confiance"
          value={Number(
            lastRun?.summary?.confidenceAverage ?? collector.lastSummary?.confidenceAverage ?? 0,
          )}
          icon={KeyRound}
        />
        <Metric
          label="Conflits IP"
          value={Number(lastRun?.summary?.ipConflicts ?? collector.lastSummary?.ipConflicts ?? 0)}
          icon={ShieldAlert}
        />
        <Metric
          label="Conflits MAC"
          value={Number(lastRun?.summary?.macConflicts ?? collector.lastSummary?.macConflicts ?? 0)}
          icon={ShieldAlert}
        />
      </div>

      {(collector.runs?.length ?? 0) > 0 && (
        <div className="mt-4 overflow-hidden rounded-md border">
          <div className="grid grid-cols-[1fr_90px_90px_90px] bg-muted px-3 py-2 text-xs font-medium text-muted-foreground">
            <span>Run</span>
            <span>{localized(language, 'Hôtes', 'Hosts')}</span>
            <span>{localized(language, 'Créés', 'Created')}</span>
            <span>{localized(language, 'Statut', 'Status')}</span>
          </div>
          {collector.runs!.map((run) => (
            <div
              key={run.id}
              className="grid grid-cols-[1fr_90px_90px_90px] border-t px-3 py-2 text-sm"
            >
              <span>{formatDate(run.createdAt)}</span>
              <span>{Number(run.summary?.hostsSeen ?? 0)}</span>
              <span>{Number(run.summary?.devicesCreated ?? 0)}</span>
              <span>{run.status}</span>
            </div>
          ))}
        </div>
      )}

      {(collector.events?.length ?? 0) > 0 && (
        <div className="mt-4 overflow-hidden rounded-md border">
          <div className="grid grid-cols-[90px_1fr_150px] bg-muted px-3 py-2 text-xs font-medium text-muted-foreground">
            <span>{localized(language, 'Niveau', 'Severity')}</span>
            <span>{localized(language, 'Événement', 'Event')}</span>
            <span>{localized(language, 'Date', 'Date')}</span>
          </div>
          {collector.events!.slice(0, 5).map((event) => (
            <div
              key={event.id}
              className="grid grid-cols-[90px_1fr_150px] border-t px-3 py-2 text-sm"
            >
              <Badge
                className="w-fit whitespace-nowrap"
                variant={
                  event.severity === 'CRITICAL'
                    ? 'danger'
                    : event.severity === 'WARNING'
                      ? 'warning'
                      : 'outline'
                }
              >
                {event.severity}
              </Badge>
              <span className="truncate" title={event.message ?? event.title}>
                {event.title}
              </span>
              <span className="text-muted-foreground">{formatDate(event.createdAt)}</span>
            </div>
          ))}
        </div>
      )}

      {(collector.states?.length ?? 0) > 0 && (
        <div className="mt-4 overflow-hidden rounded-md border">
          <div className="grid grid-cols-[1fr_90px_1fr_150px] bg-muted px-3 py-2 text-xs font-medium text-muted-foreground">
            <span>{localized(language, 'Équipement', 'Device')}</span>
            <span>{localized(language, 'État', 'State')}</span>
            <span>Ports</span>
            <span>{localized(language, 'Dernière vue', 'Last seen')}</span>
          </div>
          {collector.states!.slice(0, 6).map((state) => (
            <div
              key={state.id}
              className="grid grid-cols-[1fr_90px_1fr_150px] items-center border-t px-3 py-2 text-sm"
            >
              <span className="truncate">{state.device.name}</span>
              <span className="flex items-center gap-1.5">
                <span
                  className={cn(
                    'h-1.5 w-1.5 shrink-0 rounded-full',
                    state.status === 'ONLINE'
                      ? 'bg-status-online'
                      : state.status === 'DOWN'
                        ? 'bg-status-offline'
                        : 'bg-muted-foreground',
                  )}
                />
                <span className="text-xs text-muted-foreground">
                  {state.status === 'ONLINE'
                    ? localized(language, 'En ligne', 'Online')
                    : state.status === 'DOWN'
                      ? localized(language, 'Hors ligne', 'Offline')
                      : state.status}
                </span>
              </span>
              <span className="truncate">{state.lastPorts.join(', ') || 'aucun'}</span>
              <span className="text-muted-foreground">{formatDate(state.lastSeenAt)}</span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function parsePorts(value: string, max = 12): number[] {
  const ports = value
    .split(/[,\s;]+/)
    .map((item) => Number(item.trim()))
    .filter((port) => Number.isInteger(port) && port >= 1 && port <= 65_535);
  return [...new Set(ports)].slice(0, max);
}

function parseCidrs(value: string): string[] {
  return value
    .split(/[,\s;]+/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 20);
}

type SnmpCommandOptions = {
  communities: string;
  v3Username: string;
  v3Level: string;
  v3AuthProtocol: string;
  v3AuthPassword: string;
  v3PrivProtocol: string;
  v3PrivPassword: string;
};

function buildSnmpOptions(options: SnmpCommandOptions): SnmpCommandOptions {
  return options;
}

function buildCollectorCommand(
  collector: DiscoveryCollector,
  token: string,
  snmp: SnmpCommandOptions = {
    communities: '',
    v3Username: '',
    v3Level: 'authPriv',
    v3AuthProtocol: 'sha256',
    v3AuthPassword: '',
    v3PrivProtocol: 'aes',
    v3PrivPassword: '',
  },
): string {
  const apiUrl = window.location.origin;
  const cidrs = collector.defaultCidrs.join(',');
  const ports = collector.defaultPorts.join(',');
  const parts = [
    'docker run -d --name orbis-collector --restart unless-stopped',
    '--network host',
    '-e ORBIS_API_URL="' + apiUrl + '"',
    '-e ORBIS_COLLECTOR_ID="' + collector.id + '"',
    '-e ORBIS_COLLECTOR_TOKEN="' + token + '"',
    '-e ORBIS_CIDRS="' + cidrs + '"',
    '-e ORBIS_PORTS="' + ports + '"',
  ];
  if (snmp.communities.trim()) {
    parts.push('-e ORBIS_SNMP_COMMUNITIES="' + escapeShellEnv(snmp.communities.trim()) + '"');
  }
  if (snmp.v3Username.trim()) {
    parts.push('-e ORBIS_SNMPV3_USERNAME="' + escapeShellEnv(snmp.v3Username.trim()) + '"');
    parts.push(
      '-e ORBIS_SNMPV3_LEVEL="' + escapeShellEnv(snmp.v3Level.trim() || 'authPriv') + '"',
    );
    if (snmp.v3Level !== 'noAuthNoPriv') {
      parts.push(
        '-e ORBIS_SNMPV3_AUTH_PROTOCOL="' +
          escapeShellEnv(snmp.v3AuthProtocol.trim() || 'sha256') +
          '"',
      );
      parts.push(
        '-e ORBIS_SNMPV3_AUTH_PASSWORD="' + escapeShellEnv(snmp.v3AuthPassword.trim()) + '"',
      );
    }
    if (snmp.v3Level === 'authPriv') {
      parts.push(
        '-e ORBIS_SNMPV3_PRIV_PROTOCOL="' +
          escapeShellEnv(snmp.v3PrivProtocol.trim() || 'aes') +
          '"',
      );
      parts.push(
        '-e ORBIS_SNMPV3_PRIV_PASSWORD="' + escapeShellEnv(snmp.v3PrivPassword.trim()) + '"',
      );
    }
  }
  parts.push('orbis-collector:latest');
  return parts.join(' \\\n  ');
}

function escapeShellEnv(value: string): string {
  return value.replace(/["\\$`]/g, '\\$&');
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('fr-FR', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(value));
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
