import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Ruler, Plus, Trash2, ChevronRight } from 'lucide-react';
import { api } from '@/lib/api';
import { useToast } from '@/hooks/useToast';
import { useAuth } from '@/hooks/useAuth';
import { useCurrentSite } from '@/hooks/useCurrentSite';
import { localized, useLanguage } from '@/hooks/useLanguage';
import { PageContainer, PageHeader } from '@/components/layout/PageHeader';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Field } from '@/components/ui/Label';
import { Select } from '@/components/ui/Select';
import { EmptyState } from '@/components/ui/Empty';
import { FullLoading } from '@/components/ui/Loading';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/Dialog';
import { DEVICE_STATUSES, DEVICE_TYPES } from '@/lib/devices';
import { cn } from '@/lib/utils';
import type { DeviceStatus, DeviceType, Rack } from '@/types';

export default function RackViewPage() {
  const { t, language } = useLanguage();
  const { id } = useParams();
  const navigate = useNavigate();
  const { canEdit } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const { siteId } = useCurrentSite();
  const [selectedRack, setSelectedRack] = useState<string | null>(id ?? null);
  const [creatingRack, setCreatingRack] = useState(false);
  const [rackForm, setRackForm] = useState({
    name: '',
    siteId: siteId ?? '',
    totalUnits: 42,
    description: '',
  });

  const { data: listData } = useQuery({
    queryKey: ['racks', siteId],
    queryFn: () => api.racks.list(siteId),
  });

  const { data: sitesData } = useQuery({
    queryKey: ['sites'],
    queryFn: () => api.sites.list(),
  });

  // Automatically select the first rack when no ID is provided.
  const effectiveRackId = selectedRack ?? listData?.racks[0]?.id ?? null;

  const { data: rackData, isLoading } = useQuery({
    queryKey: ['rack', effectiveRackId],
    queryFn: () => api.racks.get(effectiveRackId!),
    enabled: !!effectiveRackId,
  });
  const rack = rackData?.rack;

  const [adding, setAdding] = useState(false);
  const [slotForm, setSlotForm] = useState({ deviceId: '', startUnit: 1, units: 1 });

  const { data: devicesData } = useQuery({
    queryKey: ['devices-for-rack', rack?.siteId],
    queryFn: () => api.devices.list({ siteId: rack?.siteId ?? undefined }),
    enabled: adding,
  });

  const createRack = useMutation({
    mutationFn: () =>
      api.racks.create({
        name: rackForm.name.trim(),
        siteId: rackForm.siteId,
        totalUnits: Number(rackForm.totalUnits),
        description: rackForm.description.trim() || null,
      }),
    onSuccess: ({ rack: created }) => {
      qc.invalidateQueries({ queryKey: ['racks'] });
      setSelectedRack(created.id);
      navigate(`/racks/${created.id}`);
      setCreatingRack(false);
      setRackForm({ name: '', siteId: siteId ?? '', totalUnits: 42, description: '' });
      toast.success(localized(language, 'Baie créée', 'Rack created'));
    },
    onError: (e: any) => toast.error(localized(language, 'Échec', 'Failed'), e.message),
  });

  const addSlot = useMutation({
    mutationFn: () => api.racks.addSlot(effectiveRackId!, slotForm),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['rack', effectiveRackId] });
      setAdding(false);
      setSlotForm({ deviceId: '', startUnit: 1, units: 1 });
      toast.success(localized(language, 'Équipement placé en baie', 'Device placed in rack'));
    },
    onError: (e: any) => toast.error(localized(language, 'Échec', 'Failed'), e.message),
  });

  const removeSlot = useMutation({
    mutationFn: (slotId: string) => api.racks.removeSlot(slotId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['rack', effectiveRackId] });
      toast.success(localized(language, 'Retiré de la baie', 'Removed from rack'));
    },
  });

  const units = rack ? Array.from({ length: rack.totalUnits }, (_, i) => rack.totalUnits - i) : [];

  // Map slots by occupied rack unit.
  type SlotEntry = { slot: NonNullable<Rack['slots']>[number]; isStart: boolean; span: number };
  const slotMap = new Map<number, SlotEntry>();
  rack?.slots?.forEach((slot) => {
    for (let u = 0; u < slot.units; u++) {
      slotMap.set(slot.startUnit + u, { slot, isStart: u === 0, span: slot.units });
    }
  });

  const availableDevices = (devicesData?.devices ?? []).filter(
    (d) => !rack?.slots?.some((s) => s.deviceId === d.id),
  );

  return (
    <PageContainer>
      <PageHeader
        title={t.nav.racks}
        description="Visualisation physique de vos baies (rack elevation)"
        actions={
          <div className="flex items-center gap-2">
            <Select
              value={effectiveRackId ?? ''}
              onChange={(e) => {
                const value = e.target.value;
                setSelectedRack(value || null);
                if (value) navigate(`/racks/${value}`);
              }}
              className="w-56"
            >
              <option value="">{t.ui.select}</option>
              {listData?.racks.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </Select>
            {canEdit && (
              <Button
                onClick={() => {
                  setRackForm((current) => ({ ...current, siteId: siteId ?? current.siteId }));
                  setCreatingRack(true);
                }}
              >
                <Plus className="h-4 w-4" /> {localized(language, 'Créer une baie', 'Create rack')}
              </Button>
            )}
          </div>
        }
      />

      <div className="mt-6 px-6">
        {!effectiveRackId ? (
          <EmptyState
            icon={Ruler}
            title={localized(language, 'Aucune baie', 'No racks')}
            description={localized(
              language,
              "Créez une baie depuis un site pour visualiser l'organisation physique de vos équipements.",
              'Create a rack from a site to visualize the physical organization of your devices.',
            )}
            action={
              canEdit ? (
                <Button
                  onClick={() => {
                    setRackForm((current) => ({ ...current, siteId: siteId ?? current.siteId }));
                    setCreatingRack(true);
                  }}
                >
                  <Plus className="h-4 w-4" />{' '}
                  {localized(language, 'Créer une baie', 'Create rack')}
                </Button>
              ) : undefined
            }
          />
        ) : isLoading || !rack ? (
          <FullLoading />
        ) : (
          <div className="grid gap-6 lg:grid-cols-[auto_1fr]">
            {/* ─── Rack visualization ───────────────────── */}
            <Card className="overflow-hidden">
              <div className="flex flex-col items-start justify-between gap-3 border-b p-4 sm:flex-row sm:items-center">
                <div className="min-w-0">
                  <h3 className="truncate font-semibold">{rack.name}</h3>
                  <p className="truncate text-xs text-muted-foreground">
                    {rack.totalUnits}U{rack.site ? ` · ${rack.site.name}` : ''}
                  </p>
                </div>
                {canEdit && (
                  <Button
                    size="sm"
                    onClick={() => setAdding(true)}
                    className="w-full shrink-0 sm:w-auto"
                  >
                    <Plus className="h-3.5 w-3.5" />{' '}
                    {localized(language, 'Placer un équipement', 'Place a device')}
                  </Button>
                )}
              </div>
              <div className="p-4">
                <div className="overflow-hidden rounded-lg border" style={{ width: 280 }}>
                  {/* Rack header */}
                  <div className="flex h-8 items-center justify-center border-b bg-muted text-xs font-medium text-muted-foreground">
                    ▲ {rack.name}
                  </div>
                  {units.map((u) => {
                    const entry = slotMap.get(u);
                    if (entry && entry.isStart) {
                      const meta = DEVICE_TYPES[entry.slot.device.type as DeviceType];
                      const statusMeta = DEVICE_STATUSES[entry.slot.device.status as DeviceStatus];
                      const Icon = meta.icon;
                      const isCompact = entry.span === 1;
                      return (
                        <div
                          key={u}
                          className="group relative flex overflow-hidden border-b"
                          style={{ height: Math.max(entry.span * 24, 24) }}
                        >
                          {/* Rack unit number */}
                          <div className="flex w-7 shrink-0 items-center justify-center border-r bg-muted/50 text-[10px] tabular-nums text-muted-foreground">
                            {u}
                          </div>
                          <div
                            className={cn(
                              'flex min-w-0 flex-1 items-center gap-1.5 px-2 transition-colors hover:bg-accent',
                              !isCompact && 'gap-2',
                            )}
                            style={{ borderLeft: `3px solid ${meta.color}` }}
                          >
                            <Icon
                              className={cn('shrink-0', isCompact ? 'h-3 w-3' : 'h-4 w-4')}
                              style={{ color: meta.color }}
                            />
                            <div className="min-w-0 flex-1">
                              <p
                                className={cn(
                                  'truncate font-medium leading-none',
                                  isCompact ? 'text-[11px]' : 'text-xs',
                                )}
                              >
                                {entry.slot.device.name}
                              </p>
                              {!isCompact && (
                                <p className="mt-0.5 truncate text-[10px] leading-none text-muted-foreground">
                                  {entry.span}U · {meta.label}
                                </p>
                              )}
                            </div>
                            <span
                              className={cn(
                                'shrink-0 rounded-full',
                                isCompact ? 'h-1.5 w-1.5' : 'h-2 w-2',
                                statusMeta.dot,
                              )}
                            />
                            {canEdit && (
                              <button
                                onClick={() => removeSlot.mutate(entry.slot.id)}
                                className="shrink-0 text-muted-foreground opacity-0 hover:text-destructive group-hover:opacity-100"
                                title="Retirer de la baie"
                              >
                                <Trash2 className="h-3 w-3" />
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    }
                    if (entry && !entry.isStart) {
                      return null; // déjà rendu par le slot de départ
                    }
                    // U vide
                    return (
                      <div key={u} className="flex h-6 border-b">
                        <div className="flex w-7 items-center justify-center border-r bg-muted/50 text-[10px] tabular-nums text-muted-foreground">
                          {u}
                        </div>
                        <div className="flex-1 bg-muted/10" />
                      </div>
                    );
                  })}
                  <div className="flex h-8 items-center justify-center border-t bg-muted text-xs font-medium text-muted-foreground">
                    ▼
                  </div>
                </div>
              </div>
            </Card>

            {/* ─── Inventaire ─────────────────────────── */}
            <Card>
              <div className="border-b p-4">
                <h3 className="font-semibold">
                  {language === 'fr' ? 'Inventaire de la baie' : 'Rack inventory'}
                </h3>
                <p className="text-xs text-muted-foreground">
                  {rack.slots?.length ?? 0}{' '}
                  {localized(language, 'équipement(s) installé(s)', 'installed device(s)')}
                </p>
              </div>
              {rack.slots && rack.slots.length > 0 ? (
                <div className="divide-y">
                  {[...rack.slots]
                    .sort((a, b) => b.startUnit - a.startUnit)
                    .map((slot) => {
                      const meta = DEVICE_TYPES[slot.device.type as DeviceType];
                      const statusMeta = DEVICE_STATUSES[slot.device.status as DeviceStatus];
                      const Icon = meta.icon;
                      return (
                        <button
                          key={slot.id}
                          onClick={() => navigate(`/devices/${slot.deviceId}`)}
                          className="group flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-accent"
                        >
                          <div
                            className="flex h-9 w-9 items-center justify-center rounded-md"
                            style={{ backgroundColor: `${meta.color}1a`, color: meta.color }}
                          >
                            <Icon className="h-4 w-4" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium">{slot.device.name}</p>
                            <p className="text-xs text-muted-foreground">
                              U{slot.startUnit}–U{slot.startUnit + slot.units - 1} ({slot.units}U) ·{' '}
                              {meta.label}
                            </p>
                          </div>
                          <span
                            className={cn('h-2 w-2 rounded-full', statusMeta.dot)}
                            title={statusMeta.label}
                          />
                          <ChevronRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100" />
                        </button>
                      );
                    })}
                </div>
              ) : (
                <p className="py-10 text-center text-sm text-muted-foreground">
                  {language === 'fr' ? 'Baie vide.' : 'Empty rack.'}
                </p>
              )}
            </Card>
          </div>
        )}
      </div>

      {/* ─── Create rack dialog ───────────────────────── */}
      <Dialog open={creatingRack} onOpenChange={setCreatingRack}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{language === 'fr' ? 'Créer une baie' : 'Create a rack'}</DialogTitle>
            <DialogDescription>
              {localized(
                language,
                'Ajoutez une baie physique à un site, puis placez-y les équipements installés.',
                'Add a physical rack to a site, then place installed devices in it.',
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Field label="Nom">
              <Input
                value={rackForm.name}
                onChange={(e) => setRackForm({ ...rackForm, name: e.target.value })}
                placeholder="PAR-DC1-R03 - Network"
              />
            </Field>
            <Field label="Site">
              <Select
                value={rackForm.siteId}
                onChange={(e) => setRackForm({ ...rackForm, siteId: e.target.value })}
              >
                <option value="">— Choisir un site —</option>
                {flattenSites(sitesData?.sites ?? []).map(({ site, depth }) => (
                  <option key={site.id} value={site.id}>
                    {`${'\u00A0'.repeat(depth * 3)}${depth > 0 ? '↳ ' : ''}${site.name}`}
                  </option>
                ))}
              </Select>
            </Field>
            <Field
              label="Hauteur"
              hint="42U est le standard datacenter. 24U/18U conviennent aux armoires locales."
            >
              <Select
                value={rackForm.totalUnits}
                onChange={(e) => setRackForm({ ...rackForm, totalUnits: Number(e.target.value) })}
              >
                {[12, 18, 24, 27, 32, 42, 45, 48].map((n) => (
                  <option key={n} value={n}>
                    {n}U
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Description" hint="Optionnel">
              <Input
                value={rackForm.description}
                onChange={(e) => setRackForm({ ...rackForm, description: e.target.value })}
                placeholder={localized(
                  language,
                  'Baie réseau, opérateur, compute...',
                  'Network, carrier or compute rack...',
                )}
              />
            </Field>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreatingRack(false)}>
              {t.ui.cancel}
            </Button>
            <Button
              onClick={() => createRack.mutate()}
              disabled={!rackForm.name.trim() || !rackForm.siteId || createRack.isPending}
            >
              {t.ui.create}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ─── Place device dialog ──────────────────────── */}
      <Dialog open={adding} onOpenChange={setAdding}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {language === 'fr' ? 'Placer un équipement en baie' : 'Place a device in the rack'}
            </DialogTitle>
            <DialogDescription>
              {localized(
                language,
                'Sélectionnez un équipement et sa position dans la baie',
                'Select a device and its position in rack',
              )}{' '}
              {rack?.name}.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Field label={t.ui.device}>
              <Select
                value={slotForm.deviceId}
                onChange={(e) => setSlotForm({ ...slotForm, deviceId: e.target.value })}
              >
                <option value="">— Choisir —</option>
                {availableDevices.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </Select>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field
                label={localized(language, 'Position (U de départ)', 'Position (starting U)')}
                hint={localized(language, 'Numéro en partant du bas', 'Numbered from the bottom')}
              >
                <Input
                  type="number"
                  min={1}
                  max={rack?.totalUnits}
                  value={slotForm.startUnit}
                  onChange={(e) => setSlotForm({ ...slotForm, startUnit: Number(e.target.value) })}
                />
              </Field>
              <Field label="Hauteur (en U)">
                <Select
                  value={slotForm.units}
                  onChange={(e) => setSlotForm({ ...slotForm, units: Number(e.target.value) })}
                >
                  {[1, 2, 3, 4, 5, 6].map((n) => (
                    <option key={n} value={n}>
                      {n}U
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAdding(false)}>
              {t.ui.cancel}
            </Button>
            <Button
              onClick={() => addSlot.mutate()}
              disabled={!slotForm.deviceId || addSlot.isPending}
            >
              Placer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageContainer>
  );
}

function flattenSites(sites: any[], depth = 0): { site: any; depth: number }[] {
  return sites.flatMap((site) => [
    { site, depth },
    ...flattenSites(site.children ?? [], depth + 1),
  ]);
}
