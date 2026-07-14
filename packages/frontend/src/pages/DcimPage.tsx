import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Cable as CableIcon, Factory, PanelTop, Plus, RadioTower, Trash2 } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/hooks/useAuth';
import { useCurrentSite } from '@/hooks/useCurrentSite';
import { useToast } from '@/hooks/useToast';
import { PageContainer, PageHeader } from '@/components/layout/PageHeader';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Field } from '@/components/ui/Label';
import { Badge } from '@/components/ui/Badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/Tabs';
import { EmptyState } from '@/components/ui/Empty';
import { FullLoading } from '@/components/ui/Loading';
import { useLanguage } from '@/hooks/useLanguage';

export default function DcimPage() {
  const { canEdit } = useAuth();
  const { t, language } = useLanguage();
  const { siteId } = useCurrentSite();
  const toast = useToast();
  const qc = useQueryClient();
  const [providerForm, setProviderForm] = useState({ name: '', contactEmail: '' });
  const [circuitForm, setCircuitForm] = useState({
    name: '',
    providerId: '',
    circuitId: '',
    type: 'Internet',
    bandwidthMbps: '',
  });
  const [panelForm, setPanelForm] = useState({ name: '', portsCount: '24' });
  const [cableForm, setCableForm] = useState({
    label: '',
    circuitId: '',
    cableType: 'FIBER',
    aPortLabel: '',
    bPortLabel: '',
  });

  const providersQuery = useQuery({
    queryKey: ['dcim', 'providers'],
    queryFn: () => api.dcim.providers.list(),
  });
  const circuitsQuery = useQuery({
    queryKey: ['dcim', 'circuits', siteId],
    queryFn: () => api.dcim.circuits.list({ siteId }),
  });
  const panelsQuery = useQuery({
    queryKey: ['dcim', 'patch-panels', siteId],
    queryFn: () => api.dcim.patchPanels.list({ siteId }),
  });
  const cablesQuery = useQuery({
    queryKey: ['dcim', 'cables', siteId],
    queryFn: () => api.dcim.cables.list({ siteId }),
  });

  const providers = providersQuery.data?.providers ?? [];
  const circuits = circuitsQuery.data?.circuits ?? [];
  const panels = panelsQuery.data?.patchPanels ?? [];
  const cables = cablesQuery.data?.cables ?? [];

  const invalidate = () => qc.invalidateQueries({ queryKey: ['dcim'] });

  const createProvider = useMutation({
    mutationFn: () =>
      api.dcim.providers.create({
        name: providerForm.name.trim(),
        contactEmail: providerForm.contactEmail.trim() || null,
      }),
    onSuccess: () => {
      setProviderForm({ name: '', contactEmail: '' });
      invalidate();
      toast.success(language === 'fr' ? 'Opérateur créé' : 'Provider created');
    },
    onError: (err: any) =>
      toast.error(language === 'fr' ? 'Opérateur non créé' : 'Provider not created', err.message),
  });
  const createCircuit = useMutation({
    mutationFn: () =>
      api.dcim.circuits.create({
        name: circuitForm.name.trim(),
        providerId: circuitForm.providerId || null,
        circuitId: circuitForm.circuitId.trim() || null,
        type: circuitForm.type.trim() || null,
        bandwidthMbps: circuitForm.bandwidthMbps ? Number(circuitForm.bandwidthMbps) : null,
        siteId: siteId ?? null,
      }),
    onSuccess: () => {
      setCircuitForm({
        name: '',
        providerId: '',
        circuitId: '',
        type: 'Internet',
        bandwidthMbps: '',
      });
      invalidate();
      toast.success(language === 'fr' ? 'Circuit créé' : 'Circuit created');
    },
    onError: (err: any) =>
      toast.error(language === 'fr' ? 'Circuit non créé' : 'Circuit not created', err.message),
  });
  const createPanel = useMutation({
    mutationFn: () =>
      api.dcim.patchPanels.create({
        name: panelForm.name.trim(),
        portsCount: Number(panelForm.portsCount),
        siteId: siteId ?? null,
      }),
    onSuccess: () => {
      setPanelForm({ name: '', portsCount: '24' });
      invalidate();
      toast.success(language === 'fr' ? 'Patch panel créé' : 'Patch panel created');
    },
    onError: (err: any) =>
      toast.error(
        language === 'fr' ? 'Patch panel non créé' : 'Patch panel not created',
        err.message,
      ),
  });
  const createCable = useMutation({
    mutationFn: () =>
      api.dcim.cables.create({
        label: cableForm.label.trim(),
        circuitId: cableForm.circuitId || null,
        cableType: cableForm.cableType,
        aPortLabel: cableForm.aPortLabel.trim() || null,
        bPortLabel: cableForm.bPortLabel.trim() || null,
      }),
    onSuccess: () => {
      setCableForm({
        label: '',
        circuitId: '',
        cableType: 'FIBER',
        aPortLabel: '',
        bPortLabel: '',
      });
      invalidate();
      toast.success(language === 'fr' ? 'Câble créé' : 'Cable created');
    },
    onError: (err: any) =>
      toast.error(language === 'fr' ? 'Câble non créé' : 'Cable not created', err.message),
  });

  const removeProvider = useMutation({
    mutationFn: (id: string) => api.dcim.providers.remove(id),
    onSuccess: invalidate,
  });
  const removeCircuit = useMutation({
    mutationFn: (id: string) => api.dcim.circuits.remove(id),
    onSuccess: invalidate,
  });
  const removePanel = useMutation({
    mutationFn: (id: string) => api.dcim.patchPanels.remove(id),
    onSuccess: invalidate,
  });
  const removeCable = useMutation({
    mutationFn: (id: string) => api.dcim.cables.remove(id),
    onSuccess: invalidate,
  });

  return (
    <PageContainer>
      <PageHeader
        title="DCIM"
        description={
          language === 'fr'
            ? 'Circuits WAN, opérateurs, patch panels et câblage physique.'
            : 'WAN circuits, providers, patch panels and physical cabling.'
        }
      />

      <div className="px-6 pt-5">
        <Tabs defaultValue="circuits">
          <TabsList>
            <TabsTrigger value="circuits">
              <RadioTower className="h-4 w-4" /> Circuits
            </TabsTrigger>
            <TabsTrigger value="providers">
              <Factory className="h-4 w-4" /> {language === 'fr' ? 'Opérateurs' : 'Providers'}
            </TabsTrigger>
            <TabsTrigger value="panels">
              <PanelTop className="h-4 w-4" /> Patch panels
            </TabsTrigger>
            <TabsTrigger value="cables">
              <CableIcon className="h-4 w-4" /> {language === 'fr' ? 'Câbles' : 'Cables'}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="circuits">
            {canEdit && (
              <Card className="mb-4 p-4">
                <div className="grid gap-3 md:grid-cols-[1fr_180px_160px_150px_140px_auto]">
                  <Field label="Nom">
                    <Input
                      value={circuitForm.name}
                      onChange={(e) => setCircuitForm({ ...circuitForm, name: e.target.value })}
                      placeholder="Fibre Paris primaire"
                    />
                  </Field>
                  <Field label={language === 'fr' ? 'Opérateur' : 'Provider'}>
                    <Select
                      value={circuitForm.providerId}
                      onChange={(e) =>
                        setCircuitForm({ ...circuitForm, providerId: e.target.value })
                      }
                    >
                      <option value="">{language === 'fr' ? 'Aucun' : 'None'}</option>
                      {providers.map((provider) => (
                        <option key={provider.id} value={provider.id}>
                          {provider.name}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label={language === 'fr' ? 'Référence' : 'Reference'}>
                    <Input
                      value={circuitForm.circuitId}
                      onChange={(e) =>
                        setCircuitForm({ ...circuitForm, circuitId: e.target.value })
                      }
                      placeholder="CID-12345"
                    />
                  </Field>
                  <Field label={t.ui.type}>
                    <Input
                      value={circuitForm.type}
                      onChange={(e) => setCircuitForm({ ...circuitForm, type: e.target.value })}
                    />
                  </Field>
                  <Field label="Mbps">
                    <Input
                      value={circuitForm.bandwidthMbps}
                      onChange={(e) =>
                        setCircuitForm({ ...circuitForm, bandwidthMbps: e.target.value })
                      }
                      placeholder="1000"
                    />
                  </Field>
                  <div className="flex items-end">
                    <Button
                      onClick={() => createCircuit.mutate()}
                      disabled={!circuitForm.name.trim()}
                    >
                      <Plus className="h-4 w-4" /> {t.ui.create}
                    </Button>
                  </div>
                </div>
              </Card>
            )}
            {circuitsQuery.isLoading ? (
              <FullLoading />
            ) : circuits.length ? (
              <Card className="divide-y overflow-hidden">
                {circuits.map((circuit) => (
                  <Row
                    key={circuit.id}
                    title={circuit.name}
                    subtitle={`${circuit.provider?.name ?? 'Sans opérateur'}${circuit.circuitId ? ` · ${circuit.circuitId}` : ''}${circuit.bandwidthMbps ? ` · ${circuit.bandwidthMbps} Mbps` : ''}`}
                    badge={circuit.status}
                    onRemove={canEdit ? () => removeCircuit.mutate(circuit.id) : undefined}
                  />
                ))}
              </Card>
            ) : (
              <EmptyState
                icon={RadioTower}
                title={language === 'fr' ? 'Aucun circuit' : 'No circuits'}
                description={
                  language === 'fr'
                    ? 'Documentez vos liens WAN, Internet, MPLS, VPN ou dark fiber.'
                    : 'Document your WAN, Internet, MPLS, VPN or dark fiber links.'
                }
              />
            )}
          </TabsContent>

          <TabsContent value="providers">
            {canEdit && (
              <Card className="mb-4 p-4">
                <div className="grid gap-3 md:grid-cols-[1fr_1fr_auto]">
                  <Field label="Nom">
                    <Input
                      value={providerForm.name}
                      onChange={(e) => setProviderForm({ ...providerForm, name: e.target.value })}
                      placeholder="Orange Business, Colt…"
                    />
                  </Field>
                  <Field label={language === 'fr' ? 'Email support' : 'Support email'}>
                    <Input
                      value={providerForm.contactEmail}
                      onChange={(e) =>
                        setProviderForm({ ...providerForm, contactEmail: e.target.value })
                      }
                    />
                  </Field>
                  <div className="flex items-end">
                    <Button
                      onClick={() => createProvider.mutate()}
                      disabled={!providerForm.name.trim()}
                    >
                      <Plus className="h-4 w-4" /> {t.ui.create}
                    </Button>
                  </div>
                </div>
              </Card>
            )}
            {providersQuery.isLoading ? (
              <FullLoading />
            ) : providers.length ? (
              <Card className="divide-y overflow-hidden">
                {providers.map((provider) => (
                  <Row
                    key={provider.id}
                    title={provider.name}
                    subtitle={`${provider.contactEmail ?? 'Aucun contact'} · ${provider._count?.circuits ?? 0} circuit(s)`}
                    onRemove={canEdit ? () => removeProvider.mutate(provider.id) : undefined}
                  />
                ))}
              </Card>
            ) : (
              <EmptyState
                icon={Factory}
                title={language === 'fr' ? 'Aucun opérateur' : 'No providers'}
                description={
                  language === 'fr'
                    ? 'Ajoutez les fournisseurs de liens, télécoms et contrats WAN.'
                    : 'Add link providers, telecom providers and WAN contracts.'
                }
              />
            )}
          </TabsContent>

          <TabsContent value="panels">
            {canEdit && (
              <Card className="mb-4 p-4">
                <div className="grid gap-3 md:grid-cols-[1fr_140px_auto]">
                  <Field label="Nom">
                    <Input
                      value={panelForm.name}
                      onChange={(e) => setPanelForm({ ...panelForm, name: e.target.value })}
                      placeholder="PP-A01"
                    />
                  </Field>
                  <Field label="Ports">
                    <Input
                      value={panelForm.portsCount}
                      onChange={(e) => setPanelForm({ ...panelForm, portsCount: e.target.value })}
                    />
                  </Field>
                  <div className="flex items-end">
                    <Button onClick={() => createPanel.mutate()} disabled={!panelForm.name.trim()}>
                      <Plus className="h-4 w-4" /> {t.ui.create}
                    </Button>
                  </div>
                </div>
              </Card>
            )}
            {panelsQuery.isLoading ? (
              <FullLoading />
            ) : panels.length ? (
              <Card className="divide-y overflow-hidden">
                {panels.map((panel) => (
                  <Row
                    key={panel.id}
                    title={panel.name}
                    subtitle={`${panel.portsCount} ports${panel.rack ? ` · ${panel.rack.name}` : ''}${panel.site ? ` · ${panel.site.name}` : ''}`}
                    onRemove={canEdit ? () => removePanel.mutate(panel.id) : undefined}
                  />
                ))}
              </Card>
            ) : (
              <EmptyState
                icon={PanelTop}
                title={language === 'fr' ? 'Aucun patch panel' : 'No patch panels'}
                description={
                  language === 'fr'
                    ? 'Documentez les panneaux de brassage et leurs ports physiques.'
                    : 'Document patch panels and their physical ports.'
                }
              />
            )}
          </TabsContent>

          <TabsContent value="cables">
            {canEdit && (
              <Card className="mb-4 p-4">
                <div className="grid gap-3 md:grid-cols-[1fr_180px_140px_1fr_1fr_auto]">
                  <Field label="Libellé">
                    <Input
                      value={cableForm.label}
                      onChange={(e) => setCableForm({ ...cableForm, label: e.target.value })}
                      placeholder="FO-PAR-A-001"
                    />
                  </Field>
                  <Field label="Circuit">
                    <Select
                      value={cableForm.circuitId}
                      onChange={(e) => setCableForm({ ...cableForm, circuitId: e.target.value })}
                    >
                      <option value="">{language === 'fr' ? 'Aucun' : 'None'}</option>
                      {circuits.map((circuit) => (
                        <option key={circuit.id} value={circuit.id}>
                          {circuit.name}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="Type">
                    <Input
                      value={cableForm.cableType}
                      onChange={(e) => setCableForm({ ...cableForm, cableType: e.target.value })}
                    />
                  </Field>
                  <Field label="Terminaison A">
                    <Input
                      value={cableForm.aPortLabel}
                      onChange={(e) => setCableForm({ ...cableForm, aPortLabel: e.target.value })}
                    />
                  </Field>
                  <Field label="Terminaison B">
                    <Input
                      value={cableForm.bPortLabel}
                      onChange={(e) => setCableForm({ ...cableForm, bPortLabel: e.target.value })}
                    />
                  </Field>
                  <div className="flex items-end">
                    <Button onClick={() => createCable.mutate()} disabled={!cableForm.label.trim()}>
                      <Plus className="h-4 w-4" /> {t.ui.create}
                    </Button>
                  </div>
                </div>
              </Card>
            )}
            {cablesQuery.isLoading ? (
              <FullLoading />
            ) : cables.length ? (
              <Card className="divide-y overflow-hidden">
                {cables.map((cable) => (
                  <Row
                    key={cable.id}
                    title={cable.label}
                    subtitle={`${cable.cableType} · ${cable.aDevice?.name ?? cable.aPatchPanel?.name ?? cable.aPortLabel ?? 'A ?'} → ${cable.bDevice?.name ?? cable.bPatchPanel?.name ?? cable.bPortLabel ?? 'B ?'}`}
                    badge={cable.status}
                    onRemove={canEdit ? () => removeCable.mutate(cable.id) : undefined}
                  />
                ))}
              </Card>
            ) : (
              <EmptyState
                icon={CableIcon}
                title={language === 'fr' ? 'Aucun câble' : 'No cables'}
                description={
                  language === 'fr'
                    ? 'Créez les liaisons physiques entre équipements, patch panels et circuits.'
                    : 'Create physical links between devices, patch panels and circuits.'
                }
              />
            )}
          </TabsContent>
        </Tabs>
      </div>
    </PageContainer>
  );
}

function Row({
  title,
  subtitle,
  badge,
  onRemove,
}: {
  title: string;
  subtitle: string;
  badge?: string;
  onRemove?: () => void;
}) {
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{title}</p>
        <p className="truncate text-xs text-muted-foreground">{subtitle}</p>
      </div>
      {badge && <Badge variant="outline">{badge}</Badge>}
      {onRemove && (
        <Button variant="ghost" size="icon-sm" onClick={onRemove} title="Remove">
          <Trash2 className="h-4 w-4" />
        </Button>
      )}
    </div>
  );
}
