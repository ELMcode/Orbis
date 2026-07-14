import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  MapPin,
  Plus,
  Building2,
  Server,
  Network,
  Trash2,
  ChevronRight,
  ChevronDown,
  Globe2,
} from 'lucide-react';
import { api } from '@/lib/api';
import { useToast } from '@/hooks/useToast';
import { useAuth } from '@/hooks/useAuth';
import { useSiteScope } from '@/stores/siteScopeStore';
import { PageContainer, PageHeader } from '@/components/layout/PageHeader';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input, Textarea } from '@/components/ui/Input';
import { Field } from '@/components/ui/Label';
import { Select } from '@/components/ui/Select';
import { Badge } from '@/components/ui/Badge';
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
import { cn } from '@/lib/utils';
import type { Site } from '@/types';
import { useLanguage } from '@/hooks/useLanguage';

export default function SitesPage() {
  const { canEdit } = useAuth();
  const { t, language } = useLanguage();
  const toast = useToast();
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: '', description: '', location: '', parentId: '' });
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const currentSiteId = useSiteScope((s) => s.currentSiteId);

  const { data, isLoading } = useQuery({
    queryKey: ['sites'],
    queryFn: () => api.sites.list(),
  });

  const sites = data?.sites ?? [];

  // Build the site tree.
  const tree = useMemo(() => {
    const byId = new Map(sites.map((s) => [s.id, { ...s, children: [] as Site[] }]));
    const roots: Site[] = [];
    for (const node of byId.values()) {
      if (node.parentId && byId.has(node.parentId)) {
        byId.get(node.parentId)!.children!.push(node);
      } else {
        roots.push(node);
      }
    }
    return roots;
  }, [sites]);

  const toggle = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const createMutation = useMutation({
    mutationFn: () =>
      api.sites.create({
        name: form.name.trim(),
        description: form.description || null,
        location: form.location || null,
        parentId: form.parentId || null,
      }),
    onSuccess: ({ site }) => {
      qc.invalidateQueries({ queryKey: ['sites'] });
      // Expand the parent so the new site is visible.
      if (site.parentId) setExpanded((prev) => new Set(prev).add(site.parentId!));
      setCreating(false);
      setForm({ name: '', description: '', location: '', parentId: '' });
      toast.success(`${t.ui.site} ${t.ui.created}`);
    },
    onError: (e: any) => toast.error(`${t.ui.site} ${t.ui.failure.toLowerCase()}`, e.message),
  });

  const openCreate = () => {
    setForm((prev) => ({ ...prev, parentId: currentSiteId ?? '' }));
    setCreating(true);
  };

  const removeMutation = useMutation({
    mutationFn: (id: string) => api.sites.remove(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sites'] });
      toast.success(`${t.ui.site} ${t.ui.deleted}`);
    },
  });

  return (
    <PageContainer>
      <PageHeader
        title={t.nav.sites}
        description={`${sites.length} ${t.nav.sites.toLowerCase()} — ${language === 'fr' ? 'organisés en arborescence' : 'organized as a hierarchy'}`}
        actions={
          canEdit && (
            <Button onClick={openCreate}>
              <Plus className="h-4 w-4" /> {t.ui.createNew} {t.ui.site.toLowerCase()}
            </Button>
          )
        }
      />

      <div className="mt-6 px-6">
        {isLoading ? (
          <FullLoading />
        ) : sites.length > 0 ? (
          <Card className="overflow-hidden">
            <div className="divide-y">
              {tree.map((site) => (
                <SiteTreeRow
                  key={site.id}
                  site={site}
                  depth={0}
                  expanded={expanded}
                  onToggle={toggle}
                  canEdit={canEdit}
                  onDelete={(id, name) => {
                    if (
                      confirm(
                        language === 'fr'
                          ? `Supprimer "${name}" et tout son contenu ?`
                          : `Delete "${name}" and all its contents?`,
                      )
                    )
                      removeMutation.mutate(id);
                  }}
                />
              ))}
            </div>
          </Card>
        ) : (
          <EmptyState
            icon={MapPin}
            title={language === 'fr' ? 'Aucun site' : 'No sites'}
            description={
              language === 'fr'
                ? 'Créez un site racine (par exemple un pays ou un datacenter) pour commencer à organiser votre infrastructure.'
                : 'Create a root site, such as a country or data center, to start organizing your infrastructure.'
            }
            action={
              canEdit && (
                <Button onClick={openCreate}>
                  <Plus className="h-4 w-4" /> {t.ui.create} {t.ui.site.toLowerCase()}
                </Button>
              )
            }
          />
        )}
      </div>

      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {t.ui.createNew} {t.ui.site.toLowerCase()}
            </DialogTitle>
            <DialogDescription>
              {language === 'fr'
                ? 'Un site peut être un pays, une ville, un datacenter, un bâtiment ou une salle. Organisez-les en arborescence.'
                : 'A site can be a country, city, data center, building, or room. Organize them as a hierarchy.'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Field label={`${t.ui.name} ${t.ui.site.toLowerCase()}`}>
              <Input
                autoFocus
                placeholder="Ex : France, Datacenter Paris, Salle A…"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </Field>
            <Field
              label={language === 'fr' ? 'Site parent (optionnel)' : 'Parent site (optional)'}
              hint={
                language === 'fr'
                  ? 'Laisser vide pour créer un site racine (ex : un pays)'
                  : 'Leave empty to create a root site (for example, a country)'
              }
            >
              <Select
                value={form.parentId}
                onChange={(e) => setForm({ ...form, parentId: e.target.value })}
              >
                <option value="">{language === 'fr' ? '— Racine —' : '— Root —'}</option>
                {sites.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={language === 'fr' ? 'Emplacement (optionnel)' : 'Location (optional)'}>
              <Input
                placeholder="Ville, adresse…"
                value={form.location}
                onChange={(e) => setForm({ ...form, location: e.target.value })}
              />
            </Field>
            <Field label={language === 'fr' ? 'Description (optionnel)' : 'Description (optional)'}>
              <Textarea
                rows={2}
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
              />
            </Field>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreating(false)}>
              {t.ui.cancel}
            </Button>
            <Button
              onClick={() => createMutation.mutate()}
              disabled={!form.name.trim() || createMutation.isPending}
            >
              {t.ui.create}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageContainer>
  );
}

function SiteTreeRow({
  site,
  depth,
  expanded,
  onToggle,
  canEdit,
  onDelete,
}: {
  site: Site;
  depth: number;
  expanded: Set<string>;
  onToggle: (id: string) => void;
  canEdit: boolean;
  onDelete: (id: string, name: string) => void;
}) {
  const hasChildren = (site.children?.length ?? 0) > 0;
  const isOpen = expanded.has(site.id);
  const isRoot = depth === 0;

  const { t, language } = useLanguage();
  return (
    <>
      <div
        className="group flex items-center gap-2 px-4 py-2.5 hover:bg-accent/50"
        style={{ paddingLeft: 16 + depth * 24 }}
      >
        {/* Expansion chevron */}
        <button
          onClick={() => hasChildren && onToggle(site.id)}
          className={cn(
            'flex h-5 w-5 shrink-0 items-center justify-center rounded',
            hasChildren ? 'hover:bg-accent' : 'opacity-0',
          )}
        >
          {hasChildren &&
            (isOpen ? (
              <ChevronDown className="h-3.5 w-3.5" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5" />
            ))}
        </button>

        {/* Icon */}
        <div
          className={cn(
            'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg',
            isRoot
              ? 'bg-gradient-to-br from-emerald-500 to-emerald-600 text-white'
              : 'bg-muted text-muted-foreground',
          )}
        >
          {isRoot ? <Globe2 className="h-4 w-4" /> : <Building2 className="h-4 w-4" />}
        </div>

        {/* Details */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate text-sm font-medium">{site.name}</p>
            {isRoot && (
              <Badge variant="outline" className="shrink-0">
                {language === 'fr' ? 'Racine' : 'Root'}
              </Badge>
            )}
          </div>
          {site.location && (
            <p className="flex items-center gap-1 truncate text-xs text-muted-foreground">
              <MapPin className="h-2.5 w-2.5" /> {site.location}
            </p>
          )}
        </div>

        {/* Counts */}
        <div className="hidden items-center gap-3 text-xs text-muted-foreground sm:flex">
          <span className="flex items-center gap-1" title={t.nav.diagrams}>
            <Network className="h-3 w-3" /> {site._count?.diagrams ?? 0}
          </span>
          <span className="flex items-center gap-1" title={t.ui.devices}>
            <Server className="h-3 w-3" /> {site._count?.devices ?? 0}
          </span>
          {hasChildren && (
            <span
              className="flex items-center gap-1"
              title={language === 'fr' ? 'Sous-sites' : 'Child sites'}
            >
              <Building2 className="h-3 w-3" /> {site._count?.children ?? 0}
            </span>
          )}
        </div>

        {canEdit && (
          <button
            onClick={() => onDelete(site.id, site.name)}
            className="text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
            title={t.ui.delete}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {/* Children */}
      {isOpen &&
        site.children?.map((child) => (
          <SiteTreeRow
            key={child.id}
            site={child}
            depth={depth + 1}
            expanded={expanded}
            onToggle={onToggle}
            canEdit={canEdit}
            onDelete={onDelete}
          />
        ))}
    </>
  );
}
