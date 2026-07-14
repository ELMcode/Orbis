import { type FormEvent, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  BookOpenCheck,
  CalendarClock,
  GitBranch,
  Plus,
  Save,
  SlidersHorizontal,
  Tags,
} from 'lucide-react';
import { api } from '@/lib/api';
import { useSiteScope } from '@/stores/siteScopeStore';
import { Button } from '@/components/ui/Button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';
import { Input, Textarea } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Badge } from '@/components/ui/Badge';
import { Field } from '@/components/ui/Label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/Tabs';
import { Loading } from '@/components/ui/Loading';
import { useToast } from '@/hooks/useToast';
import { localized, useLanguage } from '@/hooks/useLanguage';
import type {
  ApplicationDependency,
  ApplicationDependencyType,
  AssetContract,
  AssetContractType,
  CustomFieldTarget,
  CustomFieldType,
  Device,
  DeviceLifecycleStatus,
  SavedViewTarget,
} from '@/types';

const DEPENDENCY_TYPES: ApplicationDependencyType[] = [
  'APPLICATION',
  'DATABASE',
  'SERVICE',
  'NETWORK',
  'EXTERNAL',
  'STORAGE',
  'SECURITY',
  'OTHER',
];
const CONTRACT_TYPES: AssetContractType[] = [
  'LICENSE',
  'SUPPORT',
  'MAINTENANCE',
  'WARRANTY',
  'SUBSCRIPTION',
  'SERVICE',
  'OTHER',
];
const CUSTOM_TARGETS: CustomFieldTarget[] = [
  'DEVICE',
  'SITE',
  'IP_PREFIX',
  'IP_ADDRESS',
  'CONTRACT',
  'DEPENDENCY',
];
const CUSTOM_TYPES: CustomFieldType[] = ['TEXT', 'NUMBER', 'BOOLEAN', 'DATE', 'URL', 'SELECT'];
const VIEW_TARGETS: SavedViewTarget[] = [
  'DEVICES',
  'SITES',
  'IPAM',
  'DCIM',
  'CONTRACTS',
  'DEPENDENCIES',
  'DISCOVERY',
];
const LIFECYCLE: DeviceLifecycleStatus[] = [
  'PLANNED',
  'IN_SERVICE',
  'MAINTENANCE',
  'END_OF_SUPPORT',
  'REPLACEMENT_DUE',
  'RETIRED',
];

const LABELS: Record<string, string> = {
  APPLICATION: 'Application',
  DATABASE: 'Base de données',
  SERVICE: 'Service',
  NETWORK: 'Réseau',
  EXTERNAL: 'Externe',
  STORAGE: 'Stockage',
  SECURITY: 'Sécurité',
  OTHER: 'Autre',
  LICENSE: 'Licence',
  SUPPORT: 'Support',
  MAINTENANCE: 'Maintenance',
  WARRANTY: 'Garantie',
  SUBSCRIPTION: 'Abonnement',
  ACTIVE: 'Actif',
  EXPIRING: 'Expire bientôt',
  EXPIRED: 'Expiré',
  TERMINATED: 'Terminé',
  DRAFT: 'Brouillon',
  LOW: 'Faible',
  MEDIUM: 'Moyenne',
  HIGH: 'Haute',
  CRITICAL: 'Critique',
  PLANNED: 'Planifié',
  IN_SERVICE: 'En service',
  END_OF_SUPPORT: 'Fin de support',
  REPLACEMENT_DUE: 'Remplacement',
  RETIRED: 'Retiré',
  DEVICE: 'Équipement',
  SITE: 'Site',
  IP_PREFIX: 'Préfixe IP',
  IP_ADDRESS: 'Adresse IP',
  CONTRACT: 'Contrat',
  DEPENDENCY: 'Dépendance',
  TEXT: 'Texte',
  NUMBER: 'Nombre',
  BOOLEAN: 'Oui/non',
  DATE: 'Date',
  URL: 'URL',
  SELECT: 'Liste',
  DEVICES: 'Équipements',
  SITES: 'Sites',
  IPAM: 'IPAM',
  DCIM: 'DCIM',
  CONTRACTS: 'Contrats',
  DEPENDENCIES: 'Dépendances',
  DISCOVERY: 'Découverte',
};

export default function SourceOfTruthPage() {
  const { language } = useLanguage();
  const siteId = useSiteScope((s) => s.currentSiteId);
  const devicesQuery = useQuery({
    queryKey: ['devices', siteId, 'source-of-truth'],
    queryFn: () => api.devices.list({ siteId: siteId ?? undefined }),
  });

  return (
    <div className="h-full overflow-y-auto bg-muted/20 p-6">
      <div className="mx-auto max-w-7xl space-y-6">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              {language === 'fr' ? 'Référentiel' : 'Source of truth'}
            </h1>
            <p className="text-sm text-muted-foreground">
              {language === 'fr'
                ? "Source of truth pour dépendances, contrats, cycle de vie, champs métier et vues d'exploitation."
                : 'Source of truth for dependencies, contracts, lifecycle, business fields and operational views.'}
            </p>
          </div>
          <Badge variant="default">
            {localized(language, 'Organisation active', 'Active organization')}
          </Badge>
        </div>

        <Tabs defaultValue="dependencies" className="space-y-4">
          <TabsList>
            <TabsTrigger value="dependencies">
              <GitBranch className="h-4 w-4" /> {localized(language, 'Dépendances', 'Dependencies')}
            </TabsTrigger>
            <TabsTrigger value="contracts">
              <BookOpenCheck className="h-4 w-4" /> Contrats
            </TabsTrigger>
            <TabsTrigger value="lifecycle">
              <CalendarClock className="h-4 w-4" /> Cycle de vie
            </TabsTrigger>
            <TabsTrigger value="fields">
              <SlidersHorizontal className="h-4 w-4" /> Champs
            </TabsTrigger>
            <TabsTrigger value="views">
              <Tags className="h-4 w-4" /> Tags & vues
            </TabsTrigger>
          </TabsList>

          <TabsContent value="dependencies">
            <DependenciesPanel
              devices={devicesQuery.data?.devices ?? []}
              loadingDevices={devicesQuery.isLoading}
            />
          </TabsContent>
          <TabsContent value="contracts">
            <ContractsPanel
              devices={devicesQuery.data?.devices ?? []}
              loadingDevices={devicesQuery.isLoading}
            />
          </TabsContent>
          <TabsContent value="lifecycle">
            <LifecyclePanel
              devices={devicesQuery.data?.devices ?? []}
              loading={devicesQuery.isLoading}
            />
          </TabsContent>
          <TabsContent value="fields">
            <CustomFieldsPanel />
          </TabsContent>
          <TabsContent value="views">
            <TagsViewsPanel />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

function DependenciesPanel({
  devices,
  loadingDevices,
}: {
  devices: Device[];
  loadingDevices: boolean;
}) {
  const { language } = useLanguage();
  const toast = useToast();
  const qc = useQueryClient();
  const [form, setForm] = useState({
    name: '',
    dependencyType: 'APPLICATION' as ApplicationDependencyType,
    criticality: 'MEDIUM' as ApplicationDependency['criticality'],
    sourceDeviceId: '',
    targetDeviceId: '',
    protocol: '',
    port: '',
    owner: '',
    description: '',
  });
  const query = useQuery({
    queryKey: ['source-dependencies'],
    queryFn: () => api.sourceOfTruth.dependencies.list(),
  });
  const create = useMutation({
    mutationFn: () =>
      api.sourceOfTruth.dependencies.create({
        ...form,
        sourceDeviceId: form.sourceDeviceId || null,
        targetDeviceId: form.targetDeviceId || null,
        port: form.port ? Number(form.port) : null,
      }),
    onSuccess: () => {
      toast.success(localized(language, 'Dépendance créée', 'Dependency created'));
      setForm({
        name: '',
        dependencyType: 'APPLICATION',
        criticality: 'MEDIUM',
        sourceDeviceId: '',
        targetDeviceId: '',
        protocol: '',
        port: '',
        owner: '',
        description: '',
      });
      qc.invalidateQueries({ queryKey: ['source-dependencies'] });
    },
    onError: (err: any) =>
      toast.error(localized(language, 'Création impossible', 'Creation failed'), err.message),
  });

  return (
    <div className="grid gap-4 xl:grid-cols-[420px_1fr]">
      <Card>
        <CardHeader>
          <CardTitle>{localized(language, 'Nouvelle dépendance', 'New dependency')}</CardTitle>
          <CardDescription>
            {localized(
              language,
              'Cartographie applicative ou technique entre deux équipements ou services.',
              'Application or technical mapping between two devices or services.',
            )}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-3" onSubmit={(e) => submit(e, create.mutate)}>
            <Field label="Nom">
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                required
                placeholder="ERP vers base PostgreSQL"
              />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Type">
                <Select
                  value={form.dependencyType}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      dependencyType: e.target.value as ApplicationDependencyType,
                    })
                  }
                >
                  {DEPENDENCY_TYPES.map(option)}
                </Select>
              </Field>
              <Field label="Criticité">
                <Select
                  value={form.criticality}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      criticality: e.target.value as ApplicationDependency['criticality'],
                    })
                  }
                >
                  {['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].map(option)}
                </Select>
              </Field>
            </div>
            <Field label="Source">
              <DeviceSelect
                value={form.sourceDeviceId}
                devices={devices}
                loading={loadingDevices}
                onChange={(value) => setForm({ ...form, sourceDeviceId: value })}
              />
            </Field>
            <Field label="Cible">
              <DeviceSelect
                value={form.targetDeviceId}
                devices={devices}
                loading={loadingDevices}
                onChange={(value) => setForm({ ...form, targetDeviceId: value })}
              />
            </Field>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Protocole">
                <Input
                  value={form.protocol}
                  onChange={(e) => setForm({ ...form, protocol: e.target.value })}
                  placeholder="HTTPS"
                />
              </Field>
              <Field label="Port">
                <Input
                  type="number"
                  min={1}
                  max={65535}
                  value={form.port}
                  onChange={(e) => setForm({ ...form, port: e.target.value })}
                  placeholder="443"
                />
              </Field>
              <Field label="Responsable">
                <Input
                  value={form.owner}
                  onChange={(e) => setForm({ ...form, owner: e.target.value })}
                />
              </Field>
            </div>
            <Field label="Description">
              <Textarea
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
              />
            </Field>
            <Button type="submit" disabled={create.isPending}>
              <Plus className="h-4 w-4" /> Ajouter
            </Button>
          </form>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>
            {localized(language, 'Dépendances déclarées', 'Declared dependencies')}
          </CardTitle>
          <CardDescription>
            Vue opérationnelle des flux critiques et responsabilités associées.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ListLoading loading={query.isLoading} />
          <div className="space-y-2">
            {(query.data?.dependencies ?? []).map((dep) => (
              <div key={dep.id} className="rounded-lg border bg-background p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-medium">{dep.name}</p>
                  <Badge
                    variant={
                      dep.criticality === 'CRITICAL'
                        ? 'danger'
                        : dep.criticality === 'HIGH'
                          ? 'warning'
                          : 'muted'
                    }
                  >
                    {label(dep.criticality, language)}
                  </Badge>
                  <Badge variant="outline">{label(dep.dependencyType, language)}</Badge>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  {dep.sourceDevice?.name ?? dep.sourceName ?? 'Source libre'} vers{' '}
                  {dep.targetDevice?.name ?? dep.targetName ?? 'Cible libre'}
                  {dep.protocol ? ` · ${dep.protocol}${dep.port ? `/${dep.port}` : ''}` : ''}
                </p>
              </div>
            ))}
            {!query.isLoading && !query.data?.dependencies.length && (
              <EmptyLine
                text={localized(
                  language,
                  'Aucune dépendance référencée.',
                  'No dependencies recorded.',
                )}
              />
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function ContractsPanel({
  devices,
  loadingDevices,
}: {
  devices: Device[];
  loadingDevices: boolean;
}) {
  const { language } = useLanguage();
  const toast = useToast();
  const qc = useQueryClient();
  const [form, setForm] = useState({
    name: '',
    type: 'LICENSE' as AssetContractType,
    vendor: '',
    deviceId: '',
    seatsTotal: '',
    seatsUsed: '',
    endDate: '',
    owner: '',
  });
  const query = useQuery({
    queryKey: ['source-contracts'],
    queryFn: () => api.sourceOfTruth.contracts.list(),
  });
  const create = useMutation({
    mutationFn: () =>
      api.sourceOfTruth.contracts.create({
        ...form,
        deviceId: form.deviceId || null,
        seatsTotal: form.seatsTotal ? Number(form.seatsTotal) : null,
        seatsUsed: form.seatsUsed ? Number(form.seatsUsed) : null,
        endDate: form.endDate || null,
      }),
    onSuccess: () => {
      toast.success(localized(language, 'Contrat créé', 'Contract created'));
      setForm({
        name: '',
        type: 'LICENSE',
        vendor: '',
        deviceId: '',
        seatsTotal: '',
        seatsUsed: '',
        endDate: '',
        owner: '',
      });
      qc.invalidateQueries({ queryKey: ['source-contracts'] });
    },
    onError: (err: any) =>
      toast.error(localized(language, 'Création impossible', 'Creation failed'), err.message),
  });

  return (
    <div className="grid gap-4 xl:grid-cols-[420px_1fr]">
      <Card>
        <CardHeader>
          <CardTitle>Nouveau contrat ou licence</CardTitle>
          <CardDescription>
            {localized(
              language,
              'Suivi des renouvellements, licences utilisées et contrats rattachés aux actifs.',
              'Track renewals, used licenses and contracts attached to assets.',
            )}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-3" onSubmit={(e) => submit(e, create.mutate)}>
            <Field label="Nom">
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                required
                placeholder="Support Fortinet 2026"
              />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Type">
                <Select
                  value={form.type}
                  onChange={(e) => setForm({ ...form, type: e.target.value as AssetContractType })}
                >
                  {CONTRACT_TYPES.map(option)}
                </Select>
              </Field>
              <Field label="Fournisseur">
                <Input
                  value={form.vendor}
                  onChange={(e) => setForm({ ...form, vendor: e.target.value })}
                />
              </Field>
            </div>
            <Field label="Équipement associé">
              <DeviceSelect
                value={form.deviceId}
                devices={devices}
                loading={loadingDevices}
                onChange={(value) => setForm({ ...form, deviceId: value })}
              />
            </Field>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Licences totales">
                <Input
                  type="number"
                  min={0}
                  value={form.seatsTotal}
                  onChange={(e) => setForm({ ...form, seatsTotal: e.target.value })}
                />
              </Field>
              <Field label="Utilisées">
                <Input
                  type="number"
                  min={0}
                  value={form.seatsUsed}
                  onChange={(e) => setForm({ ...form, seatsUsed: e.target.value })}
                />
              </Field>
              <Field label="Fin">
                <Input
                  type="date"
                  value={form.endDate}
                  onChange={(e) => setForm({ ...form, endDate: e.target.value })}
                />
              </Field>
            </div>
            <Field label="Responsable">
              <Input
                value={form.owner}
                onChange={(e) => setForm({ ...form, owner: e.target.value })}
              />
            </Field>
            <Button type="submit" disabled={create.isPending}>
              <Plus className="h-4 w-4" /> Ajouter
            </Button>
          </form>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Contrats et licences</CardTitle>
          <CardDescription>
            Les échéances proches ressortent pour anticiper renouvellement et remplacement.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ListLoading loading={query.isLoading} />
          <div className="space-y-2">
            {(query.data?.contracts ?? []).map((contract) => (
              <ContractRow key={contract.id} contract={contract} />
            ))}
            {!query.isLoading && !query.data?.contracts.length && (
              <EmptyLine
                text={localized(language, 'Aucun contrat référencé.', 'No contracts recorded.')}
              />
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function LifecyclePanel({ devices, loading }: { devices: Device[]; loading: boolean }) {
  const { language } = useLanguage();
  const toast = useToast();
  const qc = useQueryClient();
  const [selectedId, setSelectedId] = useState('');
  const selected = devices.find((device) => device.id === selectedId);
  const [draft, setDraft] = useState({
    lifecycleStatus: 'IN_SERVICE' as DeviceLifecycleStatus,
    assetTag: '',
    warrantyEnd: '',
    supportEnd: '',
    replacementDue: '',
    owner: '',
  });
  const riskDevices = useMemo(
    () =>
      devices.filter(
        (device) =>
          isSoon(device.supportEnd) ||
          isSoon(device.warrantyEnd) ||
          device.lifecycleStatus === 'REPLACEMENT_DUE',
      ),
    [devices],
  );
  const update = useMutation({
    mutationFn: () =>
      api.devices.update(selectedId, {
        ...draft,
        warrantyEnd: draft.warrantyEnd || null,
        supportEnd: draft.supportEnd || null,
        replacementDue: draft.replacementDue || null,
      }),
    onSuccess: () => {
      toast.success(localized(language, 'Cycle de vie mis à jour', 'Lifecycle updated'));
      qc.invalidateQueries({ queryKey: ['devices'] });
    },
    onError: (err: any) =>
      toast.error(localized(language, 'Mise à jour impossible', 'Update failed'), err.message),
  });

  function selectDevice(id: string) {
    setSelectedId(id);
    const device = devices.find((item) => item.id === id);
    setDraft({
      lifecycleStatus: device?.lifecycleStatus ?? 'IN_SERVICE',
      assetTag: device?.assetTag ?? '',
      warrantyEnd: toDateInput(device?.warrantyEnd),
      supportEnd: toDateInput(device?.supportEnd),
      replacementDue: toDateInput(device?.replacementDue),
      owner: device?.owner ?? '',
    });
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[420px_1fr]">
      <Card>
        <CardHeader>
          <CardTitle>
            {localized(language, 'Cycle de vie matériel', 'Hardware lifecycle')}
          </CardTitle>
          <CardDescription>
            {localized(
              language,
              "Achat, garantie, fin de support et remplacement sont portés par l'équipement.",
              'Purchase, warranty, end of support and replacement are tracked on the device.',
            )}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-3" onSubmit={(e) => submit(e, update.mutate)}>
            <Field label="Équipement">
              <DeviceSelect
                value={selectedId}
                devices={devices}
                loading={loading}
                onChange={selectDevice}
                required
              />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Statut">
                <Select
                  value={draft.lifecycleStatus}
                  onChange={(e) =>
                    setDraft({ ...draft, lifecycleStatus: e.target.value as DeviceLifecycleStatus })
                  }
                >
                  {LIFECYCLE.map(option)}
                </Select>
              </Field>
              <Field label="Asset tag">
                <Input
                  value={draft.assetTag}
                  onChange={(e) => setDraft({ ...draft, assetTag: e.target.value })}
                />
              </Field>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Garantie">
                <Input
                  type="date"
                  value={draft.warrantyEnd}
                  onChange={(e) => setDraft({ ...draft, warrantyEnd: e.target.value })}
                />
              </Field>
              <Field label="Fin support">
                <Input
                  type="date"
                  value={draft.supportEnd}
                  onChange={(e) => setDraft({ ...draft, supportEnd: e.target.value })}
                />
              </Field>
              <Field label="Remplacement">
                <Input
                  type="date"
                  value={draft.replacementDue}
                  onChange={(e) => setDraft({ ...draft, replacementDue: e.target.value })}
                />
              </Field>
            </div>
            <Field label="Propriétaire">
              <Input
                value={draft.owner}
                onChange={(e) => setDraft({ ...draft, owner: e.target.value })}
              />
            </Field>
            <Button type="submit" disabled={!selected || update.isPending}>
              <Save className="h-4 w-4" /> {localized(language, 'Enregistrer', 'Save')}
            </Button>
          </form>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>{localized(language, 'Actifs à surveiller', 'Assets to watch')}</CardTitle>
          <CardDescription>
            Vue rapide des garanties, fins de support ou remplacements proches.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ListLoading loading={loading} />
          <div className="space-y-2">
            {riskDevices.map((device) => (
              <div key={device.id} className="rounded-lg border bg-background p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-medium">{device.name}</p>
                  <Badge
                    variant={
                      device.lifecycleStatus === 'REPLACEMENT_DUE' || isSoon(device.supportEnd)
                        ? 'warning'
                        : 'muted'
                    }
                  >
                    {label(device.lifecycleStatus ?? 'IN_SERVICE', language)}
                  </Badge>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  {localized(language, 'Garantie', 'Warranty')}{' '}
                  {formatDate(device.warrantyEnd, language)} ·{' '}
                  {localized(language, 'Support', 'Support')}{' '}
                  {formatDate(device.supportEnd, language)} ·{' '}
                  {localized(language, 'Remplacement', 'Replacement')}{' '}
                  {formatDate(device.replacementDue, language)}
                </p>
              </div>
            ))}
            {!loading && riskDevices.length === 0 && (
              <EmptyLine
                text={localized(
                  language,
                  'Aucun actif à risque à court terme.',
                  'No assets at near-term risk.',
                )}
              />
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function CustomFieldsPanel() {
  const { language } = useLanguage();
  const toast = useToast();
  const qc = useQueryClient();
  const [form, setForm] = useState({
    target: 'DEVICE' as CustomFieldTarget,
    key: '',
    label: '',
    type: 'TEXT' as CustomFieldType,
    options: '',
  });
  const query = useQuery({
    queryKey: ['custom-fields'],
    queryFn: () => api.sourceOfTruth.customFields.list(),
  });
  const create = useMutation({
    mutationFn: () =>
      api.sourceOfTruth.customFields.create({
        ...form,
        options: form.options
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean),
      }),
    onSuccess: () => {
      toast.success(localized(language, 'Champ personnalisé créé', 'Custom field created'));
      setForm({ target: 'DEVICE', key: '', label: '', type: 'TEXT', options: '' });
      qc.invalidateQueries({ queryKey: ['custom-fields'] });
    },
    onError: (err: any) =>
      toast.error(localized(language, 'Création impossible', 'Creation failed'), err.message),
  });

  return (
    <div className="grid gap-4 xl:grid-cols-[420px_1fr]">
      <Card>
        <CardHeader>
          <CardTitle>Nouveau champ</CardTitle>
          <CardDescription>
            {localized(
              language,
              "Normalise les informations propres à l'organisation sans changer le produit.",
              'Standardize organization-specific information without changing the product.',
            )}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-3" onSubmit={(e) => submit(e, create.mutate)}>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Cible">
                <Select
                  value={form.target}
                  onChange={(e) =>
                    setForm({ ...form, target: e.target.value as CustomFieldTarget })
                  }
                >
                  {CUSTOM_TARGETS.map(option)}
                </Select>
              </Field>
              <Field label="Type">
                <Select
                  value={form.type}
                  onChange={(e) => setForm({ ...form, type: e.target.value as CustomFieldType })}
                >
                  {CUSTOM_TYPES.map(option)}
                </Select>
              </Field>
            </div>
            <Field label="Clé">
              <Input
                value={form.key}
                onChange={(e) => setForm({ ...form, key: e.target.value })}
                required
                placeholder="business_owner"
              />
            </Field>
            <Field label="Libellé">
              <Input
                value={form.label}
                onChange={(e) => setForm({ ...form, label: e.target.value })}
                required
                placeholder={localized(language, 'Responsable métier', 'Business owner')}
              />
            </Field>
            <Field label="Options" hint="Pour les listes : valeurs séparées par des virgules.">
              <Input
                value={form.options}
                onChange={(e) => setForm({ ...form, options: e.target.value })}
              />
            </Field>
            <Button type="submit" disabled={create.isPending}>
              <Plus className="h-4 w-4" /> Ajouter
            </Button>
          </form>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>{localized(language, 'Champs configurés', 'Configured fields')}</CardTitle>
          <CardDescription>
            Définitions disponibles pour équipements, sites, IPAM, contrats et dépendances.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ListLoading loading={query.isLoading} />
          <div className="space-y-2">
            {(query.data?.fields ?? []).map((field) => (
              <div
                key={field.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-background p-3"
              >
                <div>
                  <p className="font-medium">{field.label}</p>
                  <p className="text-sm text-muted-foreground">
                    {label(field.target, language)} · {field.key}
                  </p>
                </div>
                <Badge variant="outline">{label(field.type, language)}</Badge>
              </div>
            ))}
            {!query.isLoading && !query.data?.fields.length && (
              <EmptyLine
                text={localized(language, 'Aucun champ personnalisé.', 'No custom fields.')}
              />
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function TagsViewsPanel() {
  const { language } = useLanguage();
  const toast = useToast();
  const qc = useQueryClient();
  const [tag, setTag] = useState({ name: '', color: '#2563eb', description: '' });
  const [view, setView] = useState({
    name: '',
    target: 'DEVICES' as SavedViewTarget,
    filters: '',
    columns: '',
  });
  const tags = useQuery({
    queryKey: ['tag-definitions'],
    queryFn: () => api.sourceOfTruth.tags.list(),
  });
  const views = useQuery({
    queryKey: ['saved-views'],
    queryFn: () => api.sourceOfTruth.savedViews.list(),
  });
  const createTag = useMutation({
    mutationFn: () => api.sourceOfTruth.tags.create(tag),
    onSuccess: () => {
      toast.success(localized(language, 'Tag créé', 'Tag created'));
      setTag({ name: '', color: '#2563eb', description: '' });
      qc.invalidateQueries({ queryKey: ['tag-definitions'] });
    },
    onError: (err: any) =>
      toast.error(localized(language, 'Création impossible', 'Creation failed'), err.message),
  });
  const createView = useMutation({
    mutationFn: () =>
      api.sourceOfTruth.savedViews.create({
        name: view.name,
        target: view.target,
        filters: parseJsonObject(view.filters),
        columns: view.columns
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean),
      }),
    onSuccess: () => {
      toast.success(localized(language, 'Vue sauvegardée', 'View saved'));
      setView({ name: '', target: 'DEVICES', filters: '', columns: '' });
      qc.invalidateQueries({ queryKey: ['saved-views'] });
    },
    onError: (err: any) =>
      toast.error(localized(language, 'Création impossible', 'Creation failed'), err.message),
  });

  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>{localized(language, 'Tags normalisés', 'Normalized tags')}</CardTitle>
          <CardDescription>
            {localized(
              language,
              'Palette commune pour filtrer et qualifier les objets du référentiel.',
              'Shared vocabulary for filtering and qualifying source-of-truth objects.',
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <form
            className="grid gap-3 sm:grid-cols-[1fr_120px_auto]"
            onSubmit={(e) => submit(e, createTag.mutate)}
          >
            <Field label="Nom">
              <Input
                value={tag.name}
                onChange={(e) => setTag({ ...tag, name: e.target.value })}
                required
              />
            </Field>
            <Field label="Couleur">
              <Input
                type="color"
                value={tag.color}
                onChange={(e) => setTag({ ...tag, color: e.target.value })}
              />
            </Field>
            <div className="flex items-end">
              <Button type="submit" disabled={createTag.isPending}>
                Ajouter
              </Button>
            </div>
          </form>
          <div className="flex flex-wrap gap-2">
            {(tags.data?.tags ?? []).map((item) => (
              <span
                key={item.id}
                className="inline-flex items-center gap-2 rounded-full border px-3 py-1 text-sm"
              >
                <span
                  className="h-2.5 w-2.5 rounded-full"
                  style={{ backgroundColor: item.color }}
                />
                {item.name}
              </span>
            ))}
            {!tags.isLoading && !tags.data?.tags.length && (
              <EmptyLine
                text={localized(language, 'Aucun tag normalisé.', 'No normalized tags.')}
              />
            )}
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>{localized(language, 'Vues sauvegardées', 'Saved views')}</CardTitle>
          <CardDescription>
            {localized(
              language,
              "Filtres et colonnes réutilisables pour les équipes d'exploitation.",
              'Reusable filters and columns for operations teams.',
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <form className="space-y-3" onSubmit={(e) => submit(e, createView.mutate)}>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Nom">
                <Input
                  value={view.name}
                  onChange={(e) => setView({ ...view, name: e.target.value })}
                  required
                  placeholder="Switches critiques"
                />
              </Field>
              <Field label="Module">
                <Select
                  value={view.target}
                  onChange={(e) => setView({ ...view, target: e.target.value as SavedViewTarget })}
                >
                  {VIEW_TARGETS.map(option)}
                </Select>
              </Field>
            </div>
            <Field label="Filtres JSON" hint='Exemple : {"status":"ONLINE","tag":"core"}'>
              <Input
                value={view.filters}
                onChange={(e) => setView({ ...view, filters: e.target.value })}
              />
            </Field>
            <Field label="Colonnes" hint="Valeurs séparées par des virgules.">
              <Input
                value={view.columns}
                onChange={(e) => setView({ ...view, columns: e.target.value })}
                placeholder="name,status,site,owner"
              />
            </Field>
            <Button type="submit" disabled={createView.isPending}>
              {localized(language, 'Enregistrer la vue', 'Save view')}
            </Button>
          </form>
          <div className="space-y-2">
            {(views.data?.views ?? []).map((item) => (
              <div key={item.id} className="rounded-lg border bg-background p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-medium">{item.name}</p>
                  <Badge variant="outline">{label(item.target, language)}</Badge>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  {item.columns.length ? item.columns.join(', ') : 'Colonnes par défaut'}
                </p>
              </div>
            ))}
            {!views.isLoading && !views.data?.views.length && (
              <EmptyLine text={localized(language, 'Aucune vue sauvegardée.', 'No saved views.')} />
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function ContractRow({ contract }: { contract: AssetContract }) {
  const { language } = useLanguage();
  const expiring = isSoon(contract.endDate);
  return (
    <div className="rounded-lg border bg-background p-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="font-medium">{contract.name}</p>
        <Badge variant={contract.status === 'EXPIRED' ? 'danger' : expiring ? 'warning' : 'muted'}>
          {label(contract.status, language)}
        </Badge>
        <Badge variant="outline">{label(contract.type, language)}</Badge>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        {contract.vendor ??
          localized(language, 'Fournisseur non renseigné', 'Provider not specified')}{' '}
        · {localized(language, 'Fin', 'End')} {formatDate(contract.endDate, language)} ·{' '}
        {contract.device?.name ?? localized(language, 'Organisation', 'Organization')}
        {contract.seatsTotal != null
          ? ` · ${contract.seatsUsed ?? 0}/${contract.seatsTotal} licences`
          : ''}
      </p>
    </div>
  );
}

function DeviceSelect({
  value,
  devices,
  loading,
  onChange,
  required = false,
}: {
  value: string;
  devices: Device[];
  loading: boolean;
  onChange: (value: string) => void;
  required?: boolean;
}) {
  return (
    <Select value={value} onChange={(e) => onChange(e.target.value)} required={required}>
      <option value="">
        {loading
          ? 'Chargement…'
          : required
            ? 'Choisir un équipement'
            : 'Aucun équipement spécifique'}
      </option>
      {devices.map((device) => (
        <option key={device.id} value={device.id}>
          {device.name}
          {device.site?.name ? ` · ${device.site.name}` : ''}
        </option>
      ))}
    </Select>
  );
}

function ListLoading({ loading }: { loading: boolean }) {
  if (!loading) return null;
  return (
    <div className="py-6">
      <Loading />
    </div>
  );
}

function EmptyLine({ text }: { text: string }) {
  return (
    <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">{text}</p>
  );
}

function option(value: string) {
  return (
    <option key={value} value={value}>
      {label(value)}
    </option>
  );
}

function label(value?: string | null, language: 'fr' | 'en' = 'fr') {
  if (!value) return localized(language, 'Non renseigné', 'Not specified');
  const translated: Record<string, string> = {
    DATABASE: 'Database',
    NETWORK: 'Network',
    SECURITY: 'Security',
    EXPIRING: 'Expiring soon',
    EXPIRED: 'Expired',
    TERMINATED: 'Terminated',
    PLANNED: 'Planned',
    RETIRED: 'Retired',
    DEVICE: 'Device',
    IP_PREFIX: 'IP prefix',
    IP_ADDRESS: 'IP address',
    DEPENDENCY: 'Dependency',
    DEVICES: 'Devices',
    DEPENDENCIES: 'Dependencies',
    DISCOVERY: 'Discovery',
    IN_SERVICE: 'In service',
  };
  return language === 'fr' ? (LABELS[value] ?? value) : (translated[value] ?? value);
}

function submit(event: FormEvent, mutate: () => void) {
  event.preventDefault();
  mutate();
}

function formatDate(value?: string | null, language: 'fr' | 'en' = 'fr') {
  if (!value) return localized(language, 'non renseignée', 'not specified');
  return new Intl.DateTimeFormat(language === 'fr' ? 'fr-FR' : 'en-GB', {
    dateStyle: 'medium',
  }).format(new Date(value));
}

function toDateInput(value?: string | null) {
  if (!value) return '';
  return new Date(value).toISOString().slice(0, 10);
}

function isSoon(value?: string | null) {
  if (!value) return false;
  const time = new Date(value).getTime();
  return time < Date.now() + 120 * 24 * 60 * 60 * 1000;
}

function parseJsonObject(value: string) {
  if (!value.trim()) return {};
  const parsed = JSON.parse(value);
  if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
    throw new Error('Les filtres doivent être un objet JSON');
  }
  return parsed as Record<string, unknown>;
}
