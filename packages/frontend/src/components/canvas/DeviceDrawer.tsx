import { useEffect, useState, useRef, type ChangeEvent } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  MapPin,
  Tag,
  DollarSign,
  Calendar,
  User,
  FileText,
  Upload,
  Trash2,
  Image as ImageIcon,
  Loader2,
  ExternalLink,
  Paperclip,
  Pencil,
  MessageSquare,
  X,
} from 'lucide-react';
import { api, downloadMedia, fetchMediaBlobUrl } from '@/lib/api';
import {
  DEVICE_STATUSES,
  DEVICE_TYPES,
  PORT_TYPES,
  deviceStatusLabel,
  deviceTypeLabel,
} from '@/lib/devices';
import type { Device } from '@/types';
import { Drawer } from '@/components/ui/Drawer';
import { Button } from '@/components/ui/Button';
import { Input, Textarea } from '@/components/ui/Input';
import { Field } from '@/components/ui/Label';
import { Select } from '@/components/ui/Select';
import { Badge } from '@/components/ui/Badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/Tabs';
import { useToast } from '@/hooks/useToast';
import { useAuth } from '@/hooks/useAuth';
import { DEVICE_STATUS_LIST, DEVICE_TYPE_LIST } from '@/lib/devices';
import { cn, formatBytes, formatDate } from '@/lib/utils';
import { EntityComments } from '@/components/comments/EntityComments';
import { useLanguage } from '@/hooks/useLanguage';

export function DeviceDrawer({
  deviceId,
  open,
  onClose,
}: {
  deviceId: string | null;
  open: boolean;
  onClose: () => void;
}) {
  const { canEdit } = useAuth();
  const { language } = useLanguage();
  const toast = useToast();
  const qc = useQueryClient();
  const imageInput = useRef<HTMLInputElement>(null);
  const attachInput = useRef<HTMLInputElement>(null);
  const [editing, setEditing] = useState(false);
  const [lightbox, setLightbox] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['device', deviceId],
    queryFn: () => api.devices.get(deviceId!),
    enabled: !!deviceId && open,
  });

  const device = data?.device;

  const updateMutation = useMutation({
    mutationFn: (patch: Partial<Device>) => api.devices.update(deviceId!, patch),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['device', deviceId] });
      qc.invalidateQueries({ queryKey: ['devices'] });
      qc.invalidateQueries({ queryKey: ['stats'] });
      toast.success(language === 'fr' ? 'Modifications enregistrées' : 'Changes saved');
    },
    onError: (e: any) =>
      toast.error(language === 'fr' ? "Échec de l'enregistrement" : 'Save failed', e.message),
  });

  const uploadImage = useMutation({
    mutationFn: (file: File) => api.media.uploadImage(deviceId!, file),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['device', deviceId] });
      toast.success(language === 'fr' ? 'Image ajoutée' : 'Image added');
    },
    onError: (e: any) =>
      toast.error(language === 'fr' ? 'Upload échoué' : 'Upload failed', e.message),
  });

  const uploadAttach = useMutation({
    mutationFn: (file: File) => api.media.uploadAttachment(deviceId!, file),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['device', deviceId] });
      toast.success(language === 'fr' ? 'Pièce jointe ajoutée' : 'Attachment added');
    },
    onError: (e: any) =>
      toast.error(language === 'fr' ? 'Upload échoué' : 'Upload failed', e.message),
  });

  const onImageFiles = (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    files.forEach((f) => uploadImage.mutate(f));
    e.target.value = '';
  };

  const onAttachFiles = (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    files.forEach((f) => uploadAttach.mutate(f));
    e.target.value = '';
  };

  return (
    <>
      <Drawer open={open} onClose={onClose} width="max-w-lg">
        {isLoading || !device ? (
          <div className="flex h-full items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <DeviceDrawerContent
            device={device}
            canEdit={canEdit}
            editing={editing}
            setEditing={setEditing}
            updateMutation={updateMutation}
            onImageFiles={onImageFiles}
            onAttachFiles={onAttachFiles}
            imageInput={imageInput}
            attachInput={attachInput}
            onLightbox={setLightbox}
            onClose={onClose}
          />
        )}
      </Drawer>

      {/* Lightbox */}
      {lightbox && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/85 p-8 animate-fade-in"
          onClick={() => setLightbox(null)}
        >
          <img src={lightbox} alt="" className="max-h-full max-w-full rounded-lg object-contain" />
          <button
            className="absolute right-4 top-4 flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20"
            onClick={() => setLightbox(null)}
          >
            <X className="h-5 w-5" />
          </button>
        </div>
      )}
    </>
  );
}

function DeviceDrawerContent({
  device,
  canEdit,
  editing,
  setEditing,
  updateMutation,
  onImageFiles,
  onAttachFiles,
  imageInput,
  attachInput,
  onLightbox,
  onClose,
}: {
  device: Device;
  canEdit: boolean;
  editing: boolean;
  setEditing: (v: boolean) => void;
  updateMutation: ReturnType<typeof useMutation<{ device: Device }, unknown, Partial<Device>>>;
  onImageFiles: (e: ChangeEvent<HTMLInputElement>) => void;
  onAttachFiles: (e: ChangeEvent<HTMLInputElement>) => void;
  imageInput: React.RefObject<HTMLInputElement>;
  attachInput: React.RefObject<HTMLInputElement>;
  onLightbox: (url: string) => void;
  onClose: () => void;
}) {
  const toast = useToast();
  const { t, language } = useLanguage();
  const qc = useQueryClient();
  const [form, setForm] = useState<Partial<Device>>(device);

  const typeMeta = DEVICE_TYPES[device.type];
  const statusMeta = DEVICE_STATUSES[device.status];

  const save = () => {
    updateMutation.mutate(form);
    setEditing(false);
  };

  const removeImage = async (id: string) => {
    if (!confirm(language === 'fr' ? 'Supprimer cette image ?' : 'Delete this image?')) return;
    await api.media.removeImage(id);
    qc.invalidateQueries({ queryKey: ['device', device.id] });
    toast.success(language === 'fr' ? 'Image supprimée' : 'Image deleted');
  };

  const removeAttach = async (id: string) => {
    if (!confirm(language === 'fr' ? 'Supprimer cette pièce jointe ?' : 'Delete this attachment?'))
      return;
    await api.media.removeAttachment(id);
    qc.invalidateQueries({ queryKey: ['device', device.id] });
    toast.success(language === 'fr' ? 'Pièce jointe supprimée' : 'Attachment deleted');
  };

  return (
    <div className="flex h-full flex-col">
      {/* ─── Header ──────────────────────────────────── */}
      <div className="border-b p-5 pr-12">
        <div className="flex items-start gap-3">
          <div
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl"
            style={{ backgroundColor: `${typeMeta.color}1a`, color: typeMeta.color }}
          >
            <typeMeta.icon className="h-6 w-6" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-lg font-bold">{device.name}</h2>
            <p className="text-sm text-muted-foreground">
              {deviceTypeLabel(device.type, language)}
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <Badge
                variant={
                  device.status === 'ONLINE'
                    ? 'success'
                    : device.status === 'OFFLINE'
                      ? 'danger'
                      : device.status === 'WARNING'
                        ? 'warning'
                        : 'muted'
                }
              >
                <span className={cn('h-1.5 w-1.5 rounded-full', statusMeta.dot)} />
                {deviceStatusLabel(device.status, language)}
              </Badge>
              {device.tags?.map((t) => (
                <Badge key={t} variant="outline" className="gap-1">
                  <Tag className="h-2.5 w-2.5" /> {t}
                </Badge>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ─── Corps ────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto">
        <Tabs defaultValue="photos" className="px-5 pt-4">
          <TabsList className="w-full">
            <TabsTrigger value="photos" className="flex-1">
              <ImageIcon /> {t.ui.photos}
            </TabsTrigger>
            <TabsTrigger value="info" className="flex-1">
              <FileText /> {t.ui.info}
            </TabsTrigger>
            <TabsTrigger value="ports" className="flex-1">
              <Paperclip /> Ports
            </TabsTrigger>
            <TabsTrigger value="files" className="flex-1">
              <FileText /> {t.ui.documents}
            </TabsTrigger>
            <TabsTrigger value="comments" className="flex-1">
              <MessageSquare /> {t.ui.comments}
            </TabsTrigger>
          </TabsList>

          {/* ─── Galerie d'images ───────────────────── */}
          <TabsContent value="photos">
            <div className="space-y-3">
              {canEdit && (
                <>
                  <input
                    ref={imageInput}
                    type="file"
                    accept="image/*"
                    multiple
                    className="hidden"
                    onChange={onImageFiles}
                  />
                  <button
                    onClick={() => imageInput.current?.click()}
                    className="flex w-full flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border p-6 text-muted-foreground transition-colors hover:border-primary/40 hover:bg-accent"
                  >
                    <Upload className="h-5 w-5" />
                    <span className="text-sm font-medium">
                      {language === 'fr'
                        ? 'Ajouter des photos ou schémas'
                        : 'Add photos or diagrams'}
                    </span>
                    <span className="text-xs">
                      {language === 'fr'
                        ? 'Glissez-déposez ou cliquez (PNG, JPG, WebP, SVG)'
                        : 'Drag and drop or click (PNG, JPG, WebP, SVG)'}
                    </span>
                  </button>
                </>
              )}

              {device.images?.length === 0 && (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  {language === 'fr'
                    ? "Aucune image. Ajoutez une photo de l'équipement ou un schéma technique."
                    : 'No images. Add a device photo or technical diagram.'}
                </p>
              )}

              <div className="grid grid-cols-2 gap-2">
                {device.images?.map((img) => (
                  <div
                    key={img.id}
                    className="group relative aspect-square overflow-hidden rounded-lg border bg-muted"
                  >
                    <AuthenticatedImage
                      path={img.path}
                      alt={img.caption ?? ''}
                      onOpen={onLightbox}
                    />
                    {canEdit && (
                      <button
                        onClick={() => removeImage(img.id)}
                        className="absolute right-1.5 top-1.5 flex h-7 w-7 items-center justify-center rounded-md bg-black/60 text-white opacity-0 transition-opacity hover:bg-destructive group-hover:opacity-100"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                    {img.caption && (
                      <p className="absolute inset-x-0 bottom-0 bg-black/60 p-1.5 text-[10px] text-white">
                        {img.caption}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </TabsContent>

          {/* ─── Informations ────────────────────────── */}
          <TabsContent value="info">
            {canEdit && (
              <div className="mb-3 flex justify-end">
                <Button
                  variant={editing ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => (editing ? save() : setEditing(true))}
                >
                  {editing ? (
                    t.ui.save
                  ) : (
                    <>
                      <Pencil className="h-3 w-3" /> {t.ui.edit}
                    </>
                  )}
                </Button>
              </div>
            )}

            {!editing ? (
              <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                <InfoRow label="Marque" value={device.brand} />
                <InfoRow label="Modèle" value={device.model} />
                <InfoRow label="N° de série" value={device.serial} mono />
                <InfoRow label={t.ui.ip} value={device.ip} mono />
                <InfoRow label="MAC" value={device.mac} mono />
                <InfoRow label="VLAN" value={device.vlan} mono />
                <InfoRow
                  label="Emplacement"
                  value={device.location}
                  icon={<MapPin className="h-3 w-3" />}
                />
                <InfoRow
                  label="Responsable"
                  value={device.owner}
                  icon={<User className="h-3 w-3" />}
                />
                <InfoRow
                  label="Achat"
                  value={formatDate(device.purchaseDate)}
                  icon={<Calendar className="h-3 w-3" />}
                />
                <InfoRow
                  label="Garantie"
                  value={formatDate(device.warrantyEnd)}
                  icon={<Calendar className="h-3 w-3" />}
                />
                <InfoRow
                  label="Coût"
                  value={device.cost ? `${device.cost} €` : undefined}
                  icon={<DollarSign className="h-3 w-3" />}
                />
                <InfoRow label={t.ui.site} value={device.site?.name} />
                <div className="col-span-2">
                  <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                    {t.ui.notes}
                  </dt>
                  <dd className="mt-1 whitespace-pre-wrap text-sm">{device.notes || '—'}</dd>
                </div>
              </dl>
            ) : (
              <EditForm form={form} setForm={setForm} />
            )}
          </TabsContent>

          {/* ─── Ports ───────────────────────────────── */}
          <TabsContent value="ports">
            {device.ports && device.ports.length > 0 ? (
              <div className="space-y-2">
                {device.ports.map((p) => {
                  const pt = PORT_TYPES[p.portType];
                  return (
                    <div
                      key={p.id}
                      className="flex items-center justify-between rounded-lg border p-3"
                    >
                      <div className="flex items-center gap-3">
                        <span
                          className="h-2.5 w-2.5 rounded-full"
                          style={{ backgroundColor: pt.color }}
                        />
                        <div>
                          <p className="text-sm font-medium">{p.label}</p>
                          <p className="text-xs text-muted-foreground">
                            {pt.label}
                            {p.speed ? ` · ${p.speed}` : ''}
                            {p.vlan ? ` · VLAN ${p.vlan}` : ''}
                          </p>
                        </div>
                      </div>
                      {p.connectedPortId && (
                        <Badge variant="success" className="gap-1">
                          {language === 'fr' ? 'Connecté' : 'Connected'}
                        </Badge>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="py-8 text-center text-sm text-muted-foreground">
                {language === 'fr'
                  ? 'Aucun port défini pour cet équipement.'
                  : 'No port is defined for this device.'}
              </p>
            )}
          </TabsContent>

          {/* ─── Documents ───────────────────────────── */}
          <TabsContent value="files">
            <div className="space-y-3">
              {canEdit && (
                <>
                  <input
                    ref={attachInput}
                    type="file"
                    multiple
                    className="hidden"
                    onChange={onAttachFiles}
                  />
                  <button
                    onClick={() => attachInput.current?.click()}
                    className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground transition-colors hover:border-primary/40 hover:bg-accent"
                  >
                    <Upload className="h-4 w-4" />{' '}
                    {language === 'fr'
                      ? 'Ajouter un document (PDF, doc…)'
                      : 'Add a document (PDF, doc…)'}
                  </button>
                </>
              )}
              {device.attachments && device.attachments.length > 0 ? (
                <div className="space-y-1.5">
                  {device.attachments.map((a) => (
                    <div
                      key={a.id}
                      className="group flex items-center gap-3 rounded-lg border p-3 transition-colors hover:bg-accent"
                    >
                      <button
                        type="button"
                        onClick={() =>
                          downloadMedia(a.path, a.filename).catch((e) =>
                            toast.error(
                              language === 'fr' ? 'Téléchargement impossible' : 'Download failed',
                              e.message,
                            ),
                          )
                        }
                        className="flex min-w-0 flex-1 items-center gap-3 text-left"
                      >
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-muted">
                          <FileText className="h-4 w-4 text-muted-foreground" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">{a.filename}</p>
                          <p className="text-xs text-muted-foreground">
                            {formatBytes(a.size)} · {formatDate(a.createdAt)}
                          </p>
                        </div>
                        <ExternalLink className="h-3.5 w-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                      </button>
                      {canEdit && (
                        <button
                          type="button"
                          onClick={() => removeAttach(a.id)}
                          className="text-muted-foreground hover:text-destructive"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  {language === 'fr' ? 'Aucun document attaché.' : 'No attachment.'}
                </p>
              )}
            </div>
          </TabsContent>

          <TabsContent value="comments">
            <EntityComments
              targetType="DEVICE"
              targetId={device.id}
              title={language === 'fr' ? "Notes d'exploitation" : 'Operational notes'}
            />
          </TabsContent>
        </Tabs>
      </div>

      <div className="border-t p-4">
        <Button variant="outline" className="w-full" onClick={onClose}>
          {t.ui.close}
        </Button>
      </div>
    </div>
  );
}

function AuthenticatedImage({
  path,
  alt,
  onOpen,
}: {
  path: string;
  alt: string;
  onOpen: (url: string) => void;
}) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    let objectUrl: string | null = null;

    fetchMediaBlobUrl(path)
      .then((nextUrl) => {
        objectUrl = nextUrl;
        if (active) setUrl(nextUrl);
        else URL.revokeObjectURL(nextUrl);
      })
      .catch(() => {
        if (active) setUrl(null);
      });

    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [path]);

  if (!url) {
    return (
      <div className="flex h-full w-full items-center justify-center text-muted-foreground">
        <ImageIcon className="h-5 w-5" />
      </div>
    );
  }

  return (
    <img
      src={url}
      alt={alt}
      className="h-full w-full cursor-pointer object-cover transition-transform group-hover:scale-105"
      onClick={() => onOpen(url)}
    />
  );
}

function InfoRow({
  label,
  value,
  mono,
  icon,
}: {
  label: string;
  value?: string | null;
  mono?: boolean;
  icon?: React.ReactNode;
}) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd
        className={cn('mt-0.5 flex items-center gap-1 text-sm', !value && 'text-muted-foreground')}
      >
        {icon}
        <span className={mono ? 'font-mono text-xs' : ''}>{value || '—'}</span>
      </dd>
    </div>
  );
}

function EditForm({
  form,
  setForm,
}: {
  form: Partial<Device>;
  setForm: (f: Partial<Device>) => void;
}) {
  const { t, language } = useLanguage();
  const set =
    (k: keyof Device) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
      setForm({ ...form, [k]: e.target.value || null });

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <Field label={t.ui.name}>
          <Input defaultValue={form.name} onChange={set('name')} />
        </Field>
        <Field label={t.ui.status}>
          <Select defaultValue={form.status} onChange={set('status')}>
            {DEVICE_STATUS_LIST.map((s) => (
              <option key={s.value} value={s.value}>
                {deviceStatusLabel(s.value, language)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t.ui.type}>
          <Select defaultValue={form.type} onChange={set('type')}>
            {DEVICE_TYPE_LIST.map((t) => (
              <option key={t.value} value={t.value}>
                {deviceTypeLabel(t.value, language)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t.ui.brand}>
          <Input defaultValue={form.brand ?? ''} onChange={set('brand')} />
        </Field>
        <Field label={t.ui.model}>
          <Input defaultValue={form.model ?? ''} onChange={set('model')} />
        </Field>
        <Field label={t.ui.serial}>
          <Input defaultValue={form.serial ?? ''} onChange={set('serial')} />
        </Field>
        <Field label={t.ui.ip}>
          <Input defaultValue={form.ip ?? ''} onChange={set('ip')} />
        </Field>
        <Field label={t.ui.mac}>
          <Input defaultValue={form.mac ?? ''} onChange={set('mac')} />
        </Field>
        <Field label={t.ui.vlan}>
          <Input defaultValue={form.vlan ?? ''} onChange={set('vlan')} />
        </Field>
        <Field label={language === 'fr' ? 'Emplacement' : 'Location'}>
          <Input defaultValue={form.location ?? ''} onChange={set('location')} />
        </Field>
        <Field label={language === 'fr' ? 'Responsable' : 'Owner'}>
          <Input defaultValue={form.owner ?? ''} onChange={set('owner')} />
        </Field>
        <Field label="Coût (€)">
          <Input
            type="number"
            defaultValue={form.cost ?? ''}
            onChange={(e) =>
              setForm({ ...form, cost: e.target.value ? Number(e.target.value) : null })
            }
          />
        </Field>
        <Field label={language === 'fr' ? "Date d'achat" : 'Purchase date'}>
          <Input
            type="date"
            defaultValue={form.purchaseDate?.slice(0, 10) ?? ''}
            onChange={(e) =>
              setForm({
                ...form,
                purchaseDate: e.target.value ? new Date(e.target.value).toISOString() : null,
              })
            }
          />
        </Field>
        <Field label={language === 'fr' ? 'Fin de garantie' : 'Warranty end'}>
          <Input
            type="date"
            defaultValue={form.warrantyEnd?.slice(0, 10) ?? ''}
            onChange={(e) =>
              setForm({
                ...form,
                warrantyEnd: e.target.value ? new Date(e.target.value).toISOString() : null,
              })
            }
          />
        </Field>
      </div>
      <Field label={t.ui.notes}>
        <Textarea rows={3} defaultValue={form.notes ?? ''} onChange={set('notes')} />
      </Field>
    </div>
  );
}
