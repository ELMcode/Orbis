import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Boxes, Hash, MessageSquare, Network, Plus, Search, Server, Trash2, X } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/hooks/useAuth';
import { useCurrentSite } from '@/hooks/useCurrentSite';
import { useToast } from '@/hooks/useToast';
import { localized, useLanguage } from '@/hooks/useLanguage';
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
import { EntityComments } from '@/components/comments/EntityComments';
import type { EntityCommentTarget, IpAddressStatus } from '@/types';

const ADDRESS_STATUSES: Array<{
  value: IpAddressStatus;
  label: string;
  variant: 'default' | 'success' | 'warning' | 'muted' | 'outline';
}> = [
  { value: 'ASSIGNED', label: 'Assigned', variant: 'success' },
  { value: 'RESERVED', label: 'Reserved', variant: 'warning' },
  { value: 'DHCP', label: 'DHCP', variant: 'default' },
  { value: 'DEPRECATED', label: 'Deprecated', variant: 'outline' },
  { value: 'UNKNOWN', label: 'Unknown', variant: 'muted' },
];
const ADDRESS_STATUS_LABELS_FR: Record<IpAddressStatus, string> = {
  ASSIGNED: 'Assignée',
  RESERVED: 'Réservée',
  DHCP: 'DHCP',
  DEPRECATED: 'Dépréciée',
  UNKNOWN: 'Inconnue',
};

const statusByValue = Object.fromEntries(ADDRESS_STATUSES.map((s) => [s.value, s]));

export default function IpamPage() {
  const { t, language } = useLanguage();
  const { canEdit } = useAuth();
  const { siteId } = useCurrentSite();
  const toast = useToast();
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [vrfForm, setVrfForm] = useState({ name: '', rd: '' });
  const [vlanForm, setVlanForm] = useState({ vlanId: '', name: '' });
  const [prefixForm, setPrefixForm] = useState({
    cidr: '',
    name: '',
    gateway: '',
    vlanId: '',
    vrfId: '',
  });
  const [addressForm, setAddressForm] = useState({
    address: '',
    dnsName: '',
    prefixId: '',
    status: 'UNKNOWN' as IpAddressStatus,
    reservedBy: '',
    reservationExpiresAt: '',
  });
  const [commentTarget, setCommentTarget] = useState<{
    type: EntityCommentTarget;
    id: string;
    label: string;
  } | null>(null);

  const vrfsQuery = useQuery({
    queryKey: ['ipam', 'vrfs', siteId],
    queryFn: () => api.ipam.vrfs.list(siteId),
  });
  const vlansQuery = useQuery({
    queryKey: ['ipam', 'vlans', siteId],
    queryFn: () => api.ipam.vlans.list(siteId),
  });
  const prefixesQuery = useQuery({
    queryKey: ['ipam', 'prefixes', siteId],
    queryFn: () => api.ipam.prefixes.list({ siteId }),
  });
  const addressesQuery = useQuery({
    queryKey: ['ipam', 'addresses', siteId, search],
    queryFn: () => api.ipam.addresses.list({ siteId, search: search || undefined }),
  });

  const vrfs = vrfsQuery.data?.vrfs ?? [];
  const vlans = vlansQuery.data?.vlans ?? [];
  const prefixes = prefixesQuery.data?.prefixes ?? [];
  const addresses = addressesQuery.data?.addresses ?? [];

  const invalidateIpam = () => {
    qc.invalidateQueries({ queryKey: ['ipam'] });
  };

  const createVrf = useMutation({
    mutationFn: () =>
      api.ipam.vrfs.create({
        name: vrfForm.name.trim(),
        rd: vrfForm.rd.trim() || null,
        siteId: siteId ?? null,
      }),
    onSuccess: () => {
      setVrfForm({ name: '', rd: '' });
      invalidateIpam();
      toast.success(language === 'fr' ? 'VRF créée' : 'VRF created');
    },
    onError: (err: any) =>
      toast.error(language === 'fr' ? 'VRF non créée' : 'VRF not created', err.message),
  });

  const createVlan = useMutation({
    mutationFn: () =>
      api.ipam.vlans.create({
        vlanId: Number(vlanForm.vlanId),
        name: vlanForm.name.trim(),
        siteId: siteId ?? null,
      }),
    onSuccess: () => {
      setVlanForm({ vlanId: '', name: '' });
      invalidateIpam();
      toast.success(language === 'fr' ? 'VLAN créé' : 'VLAN created');
    },
    onError: (err: any) =>
      toast.error(language === 'fr' ? 'VLAN non créé' : 'VLAN not created', err.message),
  });

  const createPrefix = useMutation({
    mutationFn: () =>
      api.ipam.prefixes.create({
        cidr: prefixForm.cidr.trim(),
        name: prefixForm.name.trim() || null,
        gateway: prefixForm.gateway.trim() || null,
        vlanId: prefixForm.vlanId || null,
        vrfId: prefixForm.vrfId || null,
        siteId: siteId ?? null,
      }),
    onSuccess: () => {
      setPrefixForm({ cidr: '', name: '', gateway: '', vlanId: '', vrfId: '' });
      invalidateIpam();
      toast.success(language === 'fr' ? 'Préfixe créé' : 'Prefix created');
    },
    onError: (err: any) =>
      toast.error(language === 'fr' ? 'Préfixe non créé' : 'Prefix not created', err.message),
  });

  const createAddress = useMutation({
    mutationFn: () =>
      api.ipam.addresses.create({
        address: addressForm.address.trim(),
        dnsName: addressForm.dnsName.trim() || null,
        prefixId: addressForm.prefixId || null,
        status: addressForm.status,
        reservedBy: addressForm.reservedBy.trim() || null,
        reservationExpiresAt: addressForm.reservationExpiresAt || null,
        siteId: siteId ?? null,
      }),
    onSuccess: () => {
      setAddressForm({
        address: '',
        dnsName: '',
        prefixId: '',
        status: 'UNKNOWN',
        reservedBy: '',
        reservationExpiresAt: '',
      });
      invalidateIpam();
      toast.success(language === 'fr' ? 'Adresse IP créée' : 'IP address created');
    },
    onError: (err: any) =>
      toast.error(language === 'fr' ? 'Adresse non créée' : 'Address not created', err.message),
  });

  const removeVlan = useMutation({
    mutationFn: (id: string) => api.ipam.vlans.remove(id),
    onSuccess: () => {
      invalidateIpam();
      toast.success('VLAN supprimé');
    },
    onError: (err: any) => toast.error('Suppression impossible', err.message),
  });

  const removeVrf = useMutation({
    mutationFn: (id: string) => api.ipam.vrfs.remove(id),
    onSuccess: () => {
      invalidateIpam();
      toast.success('VRF supprimée');
    },
    onError: (err: any) => toast.error('Suppression impossible', err.message),
  });

  const removePrefix = useMutation({
    mutationFn: (id: string) => api.ipam.prefixes.remove(id),
    onSuccess: () => {
      invalidateIpam();
      toast.success('Préfixe supprimé');
    },
    onError: (err: any) => toast.error('Suppression impossible', err.message),
  });

  const removeAddress = useMutation({
    mutationFn: (id: string) => api.ipam.addresses.remove(id),
    onSuccess: () => {
      invalidateIpam();
      toast.success('Adresse supprimée');
    },
    onError: (err: any) => toast.error('Suppression impossible', err.message),
  });

  return (
    <PageContainer>
      <PageHeader
        title="IPAM"
        description={
          language === 'fr'
            ? 'VLANs, préfixes et adresses IP documentés par périmètre'
            : 'VLANs, prefixes and IP addresses documented by scope'
        }
      />

      <div className="px-6 pt-5">
        <Tabs defaultValue="vlans">
          <TabsList>
            <TabsTrigger value="vrfs">
              <Boxes className="h-4 w-4" /> VRF
            </TabsTrigger>
            <TabsTrigger value="vlans">
              <Hash className="h-4 w-4" /> VLANs
            </TabsTrigger>
            <TabsTrigger value="prefixes">
              <Network className="h-4 w-4" /> {language === 'fr' ? 'Préfixes' : 'Prefixes'}
            </TabsTrigger>
            <TabsTrigger value="addresses">
              <Server className="h-4 w-4" /> {language === 'fr' ? 'Adresses' : 'Addresses'}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="vrfs">
            {canEdit && (
              <Card className="mb-4 p-4">
                <div className="grid gap-3 md:grid-cols-[1fr_180px_auto]">
                  <Field label="Nom">
                    <Input
                      value={vrfForm.name}
                      onChange={(e) => setVrfForm({ ...vrfForm, name: e.target.value })}
                      placeholder="PROD, GUEST, MPLS…"
                    />
                  </Field>
                  <Field label="Route distinguisher">
                    <Input
                      value={vrfForm.rd}
                      onChange={(e) => setVrfForm({ ...vrfForm, rd: e.target.value })}
                      placeholder="65000:10"
                    />
                  </Field>
                  <div className="flex items-end">
                    <Button
                      onClick={() => createVrf.mutate()}
                      disabled={!vrfForm.name.trim() || createVrf.isPending}
                    >
                      <Plus className="h-4 w-4" /> Ajouter
                    </Button>
                  </div>
                </div>
              </Card>
            )}
            {vrfsQuery.isLoading ? (
              <FullLoading />
            ) : vrfs.length ? (
              <Card className="overflow-hidden">
                <div className="divide-y">
                  {vrfs.map((vrf) => (
                    <div key={vrf.id} className="flex items-center gap-3 px-4 py-3">
                      <Badge variant="outline">{vrf.rd || 'VRF'}</Badge>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{vrf.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {vrf.site?.name ?? 'Global'} · {vrf._count?.prefixes ?? 0} préfixe(s)
                        </p>
                      </div>
                      {canEdit && (
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => removeVrf.mutate(vrf.id)}
                          title={t.ui.delete}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              </Card>
            ) : (
              <EmptyState
                icon={Boxes}
                title="Aucune VRF"
                description={localized(
                  language,
                  'Ajoutez les VRF pour séparer les tables de routage et les périmètres réseau.',
                  'Add VRFs to separate routing tables and network scopes.',
                )}
              />
            )}
          </TabsContent>

          <TabsContent value="vlans">
            {canEdit && (
              <Card className="mb-4 p-4">
                <div className="grid gap-3 md:grid-cols-[160px_1fr_auto]">
                  <Field label="ID VLAN">
                    <Input
                      value={vlanForm.vlanId}
                      onChange={(e) => setVlanForm({ ...vlanForm, vlanId: e.target.value })}
                      placeholder="10"
                    />
                  </Field>
                  <Field label="Nom">
                    <Input
                      value={vlanForm.name}
                      onChange={(e) => setVlanForm({ ...vlanForm, name: e.target.value })}
                      placeholder={localized(
                        language,
                        'Production, VoIP, Wi-Fi invité…',
                        'Production, VoIP, guest Wi-Fi…',
                      )}
                    />
                  </Field>
                  <div className="flex items-end">
                    <Button
                      onClick={() => createVlan.mutate()}
                      disabled={!vlanForm.vlanId || !vlanForm.name.trim() || createVlan.isPending}
                    >
                      <Plus className="h-4 w-4" /> Ajouter
                    </Button>
                  </div>
                </div>
              </Card>
            )}
            {vlansQuery.isLoading ? (
              <FullLoading />
            ) : vlans.length ? (
              <Card className="overflow-hidden">
                <div className="divide-y">
                  {vlans.map((vlan) => (
                    <div key={vlan.id} className="flex items-center gap-3 px-4 py-3">
                      <Badge variant="outline">VLAN {vlan.vlanId}</Badge>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{vlan.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {vlan.site?.name ?? 'Global'} · {vlan._count?.prefixes ?? 0} préfixe(s)
                        </p>
                      </div>
                      {canEdit && (
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => removeVlan.mutate(vlan.id)}
                          title={t.ui.delete}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              </Card>
            ) : (
              <EmptyState
                icon={Hash}
                title="Aucun VLAN"
                description={localized(
                  language,
                  'Ajoutez les VLANs utilisés par ce périmètre.',
                  'Add VLANs used by this scope.',
                )}
              />
            )}
          </TabsContent>

          <TabsContent value="prefixes">
            {canEdit && (
              <Card className="mb-4 p-4">
                <div className="grid gap-3 md:grid-cols-[1fr_1fr_160px_180px_180px_auto]">
                  <Field label="CIDR">
                    <Input
                      value={prefixForm.cidr}
                      onChange={(e) => setPrefixForm({ ...prefixForm, cidr: e.target.value })}
                      placeholder="192.168.10.0/24"
                    />
                  </Field>
                  <Field label="Nom">
                    <Input
                      value={prefixForm.name}
                      onChange={(e) => setPrefixForm({ ...prefixForm, name: e.target.value })}
                      placeholder="LAN production"
                    />
                  </Field>
                  <Field label="Passerelle">
                    <Input
                      value={prefixForm.gateway}
                      onChange={(e) => setPrefixForm({ ...prefixForm, gateway: e.target.value })}
                      placeholder=".1"
                    />
                  </Field>
                  <Field label="VLAN">
                    <Select
                      value={prefixForm.vlanId}
                      onChange={(e) => setPrefixForm({ ...prefixForm, vlanId: e.target.value })}
                    >
                      <option value="">Aucun</option>
                      {vlans.map((vlan) => (
                        <option key={vlan.id} value={vlan.id}>
                          VLAN {vlan.vlanId} · {vlan.name}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="VRF">
                    <Select
                      value={prefixForm.vrfId}
                      onChange={(e) => setPrefixForm({ ...prefixForm, vrfId: e.target.value })}
                    >
                      <option value="">Globale</option>
                      {vrfs.map((vrf) => (
                        <option key={vrf.id} value={vrf.id}>
                          {vrf.name}
                          {vrf.rd ? ` · ${vrf.rd}` : ''}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <div className="flex items-end">
                    <Button
                      onClick={() => createPrefix.mutate()}
                      disabled={!prefixForm.cidr.trim() || createPrefix.isPending}
                    >
                      <Plus className="h-4 w-4" /> Ajouter
                    </Button>
                  </div>
                </div>
              </Card>
            )}
            {prefixesQuery.isLoading ? (
              <FullLoading />
            ) : prefixes.length ? (
              <Card className="overflow-hidden">
                <div className="divide-y">
                  {prefixes.map((prefix) => (
                    <div key={prefix.id} className="flex items-center gap-3 px-4 py-3">
                      <Badge variant="default">{prefix.cidr}</Badge>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">
                          {prefix.name || 'Préfixe sans nom'}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {prefix.vlan
                            ? `VLAN ${prefix.vlan.vlanId} · ${prefix.vlan.name}`
                            : 'Sans VLAN'}
                          {prefix.vrf ? ` · VRF ${prefix.vrf.name}` : ''}
                          {prefix.gateway ? ` · GW ${prefix.gateway}` : ''}
                          {` · ${prefix._count?.addresses ?? 0} adresse(s)`}
                        </p>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          setCommentTarget({ type: 'IP_PREFIX', id: prefix.id, label: prefix.cidr })
                        }
                      >
                        <MessageSquare className="h-4 w-4" /> Notes
                      </Button>
                      {canEdit && (
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => removePrefix.mutate(prefix.id)}
                          title={t.ui.delete}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              </Card>
            ) : (
              <EmptyState
                icon={Network}
                title={localized(language, 'Aucun préfixe', 'No prefixes')}
                description="Documentez vos subnets, passerelles et rattachements VLAN."
              />
            )}
          </TabsContent>

          <TabsContent value="addresses">
            <div className="mb-4 flex flex-wrap items-end gap-3">
              <div className="relative max-w-xs flex-1">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  className="pl-9"
                  placeholder="Rechercher IP ou DNS…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
            </div>
            {canEdit && (
              <Card className="mb-4 p-4">
                <div className="grid gap-3 md:grid-cols-[1fr_1fr_180px_170px_1fr_170px_auto]">
                  <Field label="Adresse IP">
                    <Input
                      value={addressForm.address}
                      onChange={(e) => setAddressForm({ ...addressForm, address: e.target.value })}
                      placeholder="192.168.10.15"
                    />
                  </Field>
                  <Field label="DNS">
                    <Input
                      value={addressForm.dnsName}
                      onChange={(e) => setAddressForm({ ...addressForm, dnsName: e.target.value })}
                      placeholder="srv-app-01.local"
                    />
                  </Field>
                  <Field label="Préfixe">
                    <Select
                      value={addressForm.prefixId}
                      onChange={(e) => setAddressForm({ ...addressForm, prefixId: e.target.value })}
                    >
                      <option value="">Aucun</option>
                      {prefixes.map((prefix) => (
                        <option key={prefix.id} value={prefix.id}>
                          {prefix.cidr}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="Statut">
                    <Select
                      value={addressForm.status}
                      onChange={(e) =>
                        setAddressForm({
                          ...addressForm,
                          status: e.target.value as IpAddressStatus,
                        })
                      }
                    >
                      {ADDRESS_STATUSES.map((status) => (
                        <option key={status.value} value={status.value}>
                          {language === 'fr'
                            ? ADDRESS_STATUS_LABELS_FR[status.value]
                            : status.label}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="Réservée par">
                    <Input
                      value={addressForm.reservedBy}
                      onChange={(e) =>
                        setAddressForm({ ...addressForm, reservedBy: e.target.value })
                      }
                      placeholder={localized(language, 'Équipe, projet…', 'Team, project…')}
                    />
                  </Field>
                  <Field label="Expiration">
                    <Input
                      type="date"
                      value={addressForm.reservationExpiresAt}
                      onChange={(e) =>
                        setAddressForm({ ...addressForm, reservationExpiresAt: e.target.value })
                      }
                    />
                  </Field>
                  <div className="flex items-end">
                    <Button
                      onClick={() => createAddress.mutate()}
                      disabled={!addressForm.address.trim() || createAddress.isPending}
                    >
                      <Plus className="h-4 w-4" /> Ajouter
                    </Button>
                  </div>
                </div>
              </Card>
            )}
            {addressesQuery.isLoading ? (
              <FullLoading />
            ) : addresses.length ? (
              <Card className="overflow-hidden">
                <div className="divide-y">
                  {addresses.map((address) => {
                    const status = statusByValue[address.status] ?? statusByValue.UNKNOWN;
                    return (
                      <div key={address.id} className="flex items-center gap-3 px-4 py-3">
                        <code className="rounded bg-muted px-2 py-1 text-xs">
                          {address.address}
                        </code>
                        <Badge variant={status.variant}>
                          {language === 'fr'
                            ? ADDRESS_STATUS_LABELS_FR[status.value]
                            : status.label}
                        </Badge>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">
                            {address.dnsName || address.device?.name || 'Adresse non nommée'}
                          </p>
                          <p className="truncate text-xs text-muted-foreground">
                            {address.prefix?.cidr ?? 'Sans préfixe'}
                            {address.prefix?.vrf ? ` · VRF ${address.prefix.vrf.name}` : ''}
                            {address.device ? ` · ${address.device.name}` : ''}
                            {address.site ? ` · ${address.site.name}` : ''}
                            {address.reservedBy ? ` · réservé par ${address.reservedBy}` : ''}
                            {address.reservationExpiresAt
                              ? ` · expire ${new Date(address.reservationExpiresAt).toLocaleDateString('fr-FR')}`
                              : ''}
                          </p>
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() =>
                            setCommentTarget({
                              type: 'IP_ADDRESS',
                              id: address.id,
                              label: address.address,
                            })
                          }
                        >
                          <MessageSquare className="h-4 w-4" /> Notes
                        </Button>
                        {canEdit && (
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            onClick={() => removeAddress.mutate(address.id)}
                            title={t.ui.delete}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </Card>
            ) : (
              <EmptyState
                icon={Server}
                title="Aucune adresse IP"
                description={localized(
                  language,
                  'Ajoutez les réservations, adresses assignées et plages DHCP.',
                  'Add reservations, assigned addresses and DHCP ranges.',
                )}
              />
            )}
          </TabsContent>
        </Tabs>

        {commentTarget && (
          <Card className="mt-4 p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold">Notes IPAM</p>
                <p className="text-xs text-muted-foreground">{commentTarget.label}</p>
              </div>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => setCommentTarget(null)}
                title={t.ui.close}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
            <EntityComments
              targetType={commentTarget.type}
              targetId={commentTarget.id}
              title="Commentaires"
            />
          </Card>
        )}
      </div>
    </PageContainer>
  );
}
