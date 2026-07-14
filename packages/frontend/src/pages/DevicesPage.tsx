import { useRef, useState, type ChangeEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { Download, HelpCircle, Server, Search, ChevronRight, Trash2, Upload } from 'lucide-react';
import { api } from '@/lib/api';
import { PageContainer, PageHeader } from '@/components/layout/PageHeader';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/Empty';
import { FullLoading } from '@/components/ui/Loading';
import {
  DEVICE_STATUSES,
  DEVICE_TYPES,
  DEVICE_STATUS_LIST,
  DEVICE_TYPE_LIST,
  deviceStatusLabel,
  deviceTypeLabel,
} from '@/lib/devices';
import { cn } from '@/lib/utils';
import { useCurrentSite } from '@/hooks/useCurrentSite';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/useToast';
import { Button } from '@/components/ui/Button';
import type { Device } from '@/types';
import { useLanguage } from '@/hooks/useLanguage';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/Dialog';

export default function DevicesPage() {
  const [searchParams] = useSearchParams();
  const [search, setSearch] = useState(searchParams.get('search') ?? '');
  const [typeF, setTypeF] = useState('');
  const [statusF, setStatusF] = useState('');
  const [importHelpOpen, setImportHelpOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Device | null>(null);
  const { siteId } = useCurrentSite();
  const { canEdit } = useAuth();
  const { t, language } = useLanguage();
  const toast = useToast();
  const qc = useQueryClient();
  const importInput = useRef<HTMLInputElement>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['devices', { search, type: typeF, status: statusF, siteId }],
    queryFn: () =>
      api.devices.list({
        search: search || undefined,
        type: typeF || undefined,
        status: statusF || undefined,
        siteId: siteId || undefined,
      }),
  });

  const devices = data?.devices ?? [];

  const importMutation = useMutation({
    mutationFn: (file: File) => api.devices.import(file),
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ['devices'] });
      qc.invalidateQueries({ queryKey: ['stats'] });
      toast.success(
        language === 'fr' ? 'Import terminé' : 'Import complete',
        language === 'fr'
          ? `${result.created} créé(s), ${result.skipped} ignoré(s)`
          : `${result.created} created, ${result.skipped} skipped`,
      );
    },
    onError: (err: any) =>
      toast.error(language === 'fr' ? 'Import impossible' : 'Import failed', err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.devices.remove(id),
    onSuccess: () => {
      setDeleteTarget(null);
      qc.invalidateQueries({ queryKey: ['devices'] });
      qc.invalidateQueries({ queryKey: ['stats'] });
      toast.success(language === 'fr' ? 'Équipement supprimé' : 'Device deleted');
    },
    onError: (err: any) =>
      toast.error(language === 'fr' ? 'Suppression impossible' : 'Delete failed', err.message),
  });

  const onImportFile = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) importMutation.mutate(file);
    e.target.value = '';
  };

  return (
    <PageContainer>
      <PageHeader
        title={t.nav.devices}
        description={`${devices.length} ${language === 'fr' ? `équipement${devices.length > 1 ? 's' : ''}` : `device${devices.length > 1 ? 's' : ''}`}`}
        actions={
          canEdit && (
            <>
              <input
                ref={importInput}
                type="file"
                accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                className="hidden"
                onChange={onImportFile}
              />
              <Button
                variant="outline"
                onClick={() => importInput.current?.click()}
                disabled={importMutation.isPending}
              >
                <Upload className="h-4 w-4" />
                {importMutation.isPending
                  ? language === 'fr'
                    ? 'Import…'
                    : 'Importing…'
                  : t.ui.import}
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => setImportHelpOpen(true)}
                title={t.ui.format}
              >
                <HelpCircle className="h-4 w-4" />
              </Button>
            </>
          )
        }
      />

      {/* ─── Filtres ─────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2 px-6 pt-4">
        <div className="relative max-w-xs flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder={
              language === 'fr'
                ? 'Rechercher (nom, IP, MAC, modèle…)'
                : 'Search (name, IP, MAC, model…)'
            }
            className="pl-9"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Select value={typeF} onChange={(e) => setTypeF(e.target.value)} className="w-44">
          <option value="">{t.ui.allTypes}</option>
          {DEVICE_TYPE_LIST.map((item) => (
            <option key={item.value} value={item.value}>
              {deviceTypeLabel(item.value, language)}
            </option>
          ))}
        </Select>
        <Select value={statusF} onChange={(e) => setStatusF(e.target.value)} className="w-44">
          <option value="">{t.ui.allStatuses}</option>
          {DEVICE_STATUS_LIST.map((item) => (
            <option key={item.value} value={item.value}>
              {deviceStatusLabel(item.value, language)}
            </option>
          ))}
        </Select>
        {(search || typeF || statusF) && (
          <button
            onClick={() => {
              setSearch('');
              setTypeF('');
              setStatusF('');
            }}
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            {language === 'fr' ? 'Réinitialiser' : 'Reset'}
          </button>
        )}
      </div>

      {/* ─── Liste ───────────────────────────────────── */}
      <div className="mt-4 px-6">
        {isLoading ? (
          <FullLoading />
        ) : devices.length > 0 ? (
          <Card className="overflow-hidden">
            <div className="divide-y">
              {devices.map((d) => {
                const typeMeta = DEVICE_TYPES[d.type];
                const statusMeta = DEVICE_STATUSES[d.status];
                return (
                  <div
                    key={d.id}
                    className="group flex items-center gap-4 px-4 py-3 transition-colors hover:bg-accent"
                  >
                    <Link
                      to={`/devices/${d.id}`}
                      className="flex min-w-0 flex-1 items-center gap-4"
                    >
                      <div
                        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg"
                        style={{ backgroundColor: `${typeMeta.color}1a`, color: typeMeta.color }}
                      >
                        <typeMeta.icon className="h-5 w-5" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <p className="truncate font-medium">{d.name}</p>
                          <span
                            className={cn('h-1.5 w-1.5 shrink-0 rounded-full', statusMeta.dot)}
                          />
                        </div>
                        <p className="truncate text-xs text-muted-foreground">
                          {deviceTypeLabel(d.type, language)}
                          {d.brand ? ` · ${d.brand}` : ''}
                          {d.model ? ` ${d.model}` : ''}
                          {d.ip ? ` · ${d.ip}` : ''}
                        </p>
                      </div>
                    </Link>
                    <div className="hidden shrink-0 items-center gap-1.5 sm:flex">
                      {d.tags?.slice(0, 2).map((t) => (
                        <Badge key={t} variant="muted">
                          {t}
                        </Badge>
                      ))}
                    </div>
                    {d.site && (
                      <span className="hidden shrink-0 text-xs text-muted-foreground md:inline">
                        {d.site.name}
                      </span>
                    )}
                    {canEdit && (
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        title={`${t.ui.delete} ${t.ui.device.toLowerCase()}`}
                        onClick={() => setDeleteTarget(d)}
                      >
                        <Trash2 className="h-4 w-4 text-muted-foreground" />
                      </Button>
                    )}
                    <Link
                      to={`/devices/${d.id}`}
                      title={language === 'fr' ? "Ouvrir l'équipement" : 'Open device'}
                    >
                      <ChevronRight className="h-4 w-4 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                    </Link>
                  </div>
                );
              })}
            </div>
          </Card>
        ) : (
          <EmptyState
            icon={Server}
            title={
              search || typeF || statusF
                ? t.ui.noResults
                : language === 'fr'
                  ? 'Aucun équipement'
                  : 'No devices'
            }
            description={
              search || typeF || statusF
                ? language === 'fr'
                  ? 'Ajustez vos filtres pour trouver ce que vous cherchez.'
                  : 'Adjust your filters to find what you are looking for.'
                : language === 'fr'
                  ? 'Ajoutez des équipements depuis un schéma ou créez-en un directement.'
                  : 'Add devices from a diagram or create one directly.'
            }
          />
        )}
      </div>

      <Dialog open={importHelpOpen} onOpenChange={setImportHelpOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {language === 'fr' ? "Format d'import équipements" : 'Device import format'}
            </DialogTitle>
            <DialogDescription>
              {language === 'fr'
                ? 'Le fichier peut être en CSV ou XLSX. Seule la colonne name est obligatoire.'
                : 'The file can be CSV or XLSX. Only the name column is required.'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 text-sm">
            <div className="rounded-md border">
              <div className="grid grid-cols-[140px_1fr] border-b bg-muted px-3 py-2 text-xs font-medium text-muted-foreground">
                <span>{language === 'fr' ? 'Colonne' : 'Column'}</span>
                <span>{language === 'fr' ? 'Exemple' : 'Example'}</span>
              </div>
              {IMPORT_COLUMNS.map((column) => (
                <div
                  key={column.name}
                  className="grid grid-cols-[140px_1fr] border-b px-3 py-2 last:border-b-0"
                >
                  <span className="font-medium">{column.name}</span>
                  <span className="text-muted-foreground">{column.example}</span>
                </div>
              ))}
            </div>
            <pre className="overflow-x-auto rounded-md border bg-muted p-3 text-xs">
              {IMPORT_SAMPLE}
            </pre>
          </div>
          <DialogFooter className="flex-wrap justify-between">
            <Button variant="outline" onClick={downloadImportSample}>
              <Download className="h-4 w-4" /> Télécharger un exemple
            </Button>
            <Button onClick={() => setImportHelpOpen(false)}>{t.ui.close}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(deleteTarget)} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {language === 'fr' ? "Supprimer l'équipement" : 'Delete device'}
            </DialogTitle>
            <DialogDescription>
              {language === 'fr'
                ? `Cette action supprime ${deleteTarget?.name ?? "l'équipement"} de l'inventaire. Les liens, ports, pièces jointes et références associées seront détachés ou supprimés selon leur type.`
                : `This removes ${deleteTarget?.name ?? 'the device'} from the inventory. Links, ports, attachments and related references will be detached or removed according to their type.`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>
              {t.ui.cancel}
            </Button>
            <Button
              variant="destructive"
              disabled={!deleteTarget || deleteMutation.isPending}
              onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
            >
              <Trash2 className="h-4 w-4" /> {t.ui.delete}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageContainer>
  );
}

const IMPORT_COLUMNS = [
  { name: 'name', example: 'SW-BRU-CORE-01' },
  { name: 'type', example: 'SWITCH, ROUTER, FIREWALL, SERVER...' },
  { name: 'status', example: 'ONLINE, WARNING, OFFLINE, MAINTENANCE, UNKNOWN' },
  { name: 'site', example: 'Bruxelles DR' },
  { name: 'brand', example: 'Cisco' },
  { name: 'model', example: 'Catalyst 9300' },
  { name: 'serial', example: 'FOC1234567' },
  { name: 'ip', example: '10.20.0.10' },
  { name: 'mac', example: '00:11:22:33:44:55' },
  { name: 'owner', example: 'Infrastructure' },
  { name: 'location', example: 'Baie BRU-R01 U24' },
  { name: 'tags', example: 'core;production;lan' },
];

const IMPORT_SAMPLE = `name,type,status,site,brand,model,serial,ip,mac,owner,location,tags
SW-BRU-CORE-01,SWITCH,ONLINE,Bruxelles DR,Cisco,Catalyst 9300,FOC1234567,10.20.0.10,00:11:22:33:44:55,Infrastructure,Baie BRU-R01 U24,core;production;lan`;

function downloadImportSample() {
  const blob = new Blob([IMPORT_SAMPLE], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'modele-import-equipements.csv';
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
