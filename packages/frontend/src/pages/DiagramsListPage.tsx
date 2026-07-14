import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Network, Plus, MoreVertical, Trash2, Pencil, ArrowRight } from 'lucide-react';
import { api } from '@/lib/api';
import { useToast } from '@/hooks/useToast';
import { useAuth } from '@/hooks/useAuth';
import { useCurrentSite } from '@/hooks/useCurrentSite';
import { PageContainer, PageHeader } from '@/components/layout/PageHeader';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Field } from '@/components/ui/Label';
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
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/Dropdown';
import { formatDate } from '@/lib/utils';
import { useLanguage } from '@/hooks/useLanguage';

const DIAGRAM_TEMPLATES = [
  { id: 'blank', name: 'Canvas vide', nodes: [], edges: [] },
  {
    id: 'lan',
    name: 'Réseau PME',
    nodes: [
      {
        id: 'tpl-internet',
        type: 'device',
        position: { x: 0, y: 80 },
        data: { label: 'Internet', deviceType: 'INTERNET', status: 'UNKNOWN' },
      },
      {
        id: 'tpl-fw',
        type: 'device',
        position: { x: 220, y: 80 },
        data: { label: 'Pare-feu', deviceType: 'FIREWALL', status: 'UNKNOWN' },
      },
      {
        id: 'tpl-core',
        type: 'device',
        position: { x: 440, y: 80 },
        data: { label: 'Switch coeur', deviceType: 'SWITCH', status: 'UNKNOWN' },
      },
      {
        id: 'tpl-ap',
        type: 'device',
        position: { x: 660, y: 0 },
        data: { label: 'Wi-Fi', deviceType: 'ACCESS_POINT', status: 'UNKNOWN' },
      },
      {
        id: 'tpl-server',
        type: 'device',
        position: { x: 660, y: 160 },
        data: { label: 'Serveurs', deviceType: 'SERVER', status: 'UNKNOWN' },
      },
    ],
    edges: [
      {
        id: 'tpl-e1',
        source: 'tpl-internet',
        target: 'tpl-fw',
        type: 'cable',
        data: { cableType: 'ETHERNET', speed: '1G', label: 'WAN' },
      },
      {
        id: 'tpl-e2',
        source: 'tpl-fw',
        target: 'tpl-core',
        type: 'cable',
        data: { cableType: 'ETHERNET', speed: '10G', label: 'LAN' },
      },
      {
        id: 'tpl-e3',
        source: 'tpl-core',
        target: 'tpl-ap',
        type: 'cable',
        data: { cableType: 'ETHERNET', speed: '1G', vlan: 'Wi-Fi' },
      },
      {
        id: 'tpl-e4',
        source: 'tpl-core',
        target: 'tpl-server',
        type: 'cable',
        data: { cableType: 'SFP_PLUS', speed: '10G' },
      },
    ],
  },
  {
    id: 'hybrid',
    name: 'Hybride cloud',
    nodes: [
      {
        id: 'tpl-user',
        type: 'device',
        position: { x: 0, y: 120 },
        data: { label: 'Sites utilisateurs', deviceType: 'WORKSTATION', status: 'UNKNOWN' },
      },
      {
        id: 'tpl-fw',
        type: 'device',
        position: { x: 240, y: 120 },
        data: { label: 'Pare-feu SD-WAN', deviceType: 'FIREWALL', status: 'UNKNOWN' },
      },
      {
        id: 'tpl-cloud',
        type: 'device',
        position: { x: 500, y: 40 },
        data: { label: 'Cloud', deviceType: 'CLOUD', status: 'UNKNOWN' },
      },
      {
        id: 'tpl-dc',
        type: 'device',
        position: { x: 500, y: 200 },
        data: { label: 'Datacenter', deviceType: 'SERVER', status: 'UNKNOWN' },
      },
      {
        id: 'tpl-lb',
        type: 'device',
        position: { x: 760, y: 40 },
        data: { label: 'Load balancer', deviceType: 'LOAD_BALANCER', status: 'UNKNOWN' },
      },
      {
        id: 'tpl-vm',
        type: 'device',
        position: { x: 760, y: 200 },
        data: { label: 'Cluster VM', deviceType: 'HYPERVISOR', status: 'UNKNOWN' },
      },
    ],
    edges: [
      {
        id: 'tpl-e1',
        source: 'tpl-user',
        target: 'tpl-fw',
        type: 'cable',
        data: { cableType: 'ETHERNET', speed: '1G' },
      },
      {
        id: 'tpl-e2',
        source: 'tpl-fw',
        target: 'tpl-cloud',
        type: 'cable',
        data: { cableType: 'ETHERNET', speed: '1G', label: 'VPN' },
      },
      {
        id: 'tpl-e3',
        source: 'tpl-fw',
        target: 'tpl-dc',
        type: 'cable',
        data: { cableType: 'FIBER', speed: '10G', label: 'MPLS' },
      },
      {
        id: 'tpl-e4',
        source: 'tpl-cloud',
        target: 'tpl-lb',
        type: 'cable',
        data: { cableType: 'ETHERNET', speed: '10G' },
      },
      {
        id: 'tpl-e5',
        source: 'tpl-dc',
        target: 'tpl-vm',
        type: 'cable',
        data: { cableType: 'SFP_PLUS', speed: '10G' },
      },
    ],
  },
] as const;

export default function DiagramsListPage() {
  const { canEdit } = useAuth();
  const { t, language } = useLanguage();
  const toast = useToast();
  const qc = useQueryClient();
  const { siteId } = useCurrentSite();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [templateId, setTemplateId] = useState('blank');

  const { data, isLoading } = useQuery({
    queryKey: ['diagrams', siteId],
    queryFn: () => api.diagrams.list(siteId),
  });

  const createMutation = useMutation({
    mutationFn: () => {
      const template = DIAGRAM_TEMPLATES.find((t) => t.id === templateId) ?? DIAGRAM_TEMPLATES[0];
      return api.diagrams.create({
        name: name.trim() || (language === 'fr' ? 'Nouveau schéma' : 'New diagram'),
        siteId: siteId ?? null,
        nodes: template.nodes.map((node) => ({
          ...node,
          position: { ...node.position },
          data: { ...node.data },
        })),
        edges: template.edges.map((edge) => ({ ...edge, data: { ...edge.data } })),
      });
    },
    onSuccess: ({ diagram }) => {
      qc.invalidateQueries({ queryKey: ['diagrams'] });
      setCreating(false);
      setName('');
      setTemplateId('blank');
      toast.success(language === 'fr' ? 'Schéma créé' : 'Diagram created');
      window.location.href = `/diagrams/${diagram.id}`;
    },
    onError: (e: any) =>
      toast.error(language === 'fr' ? 'Création échouée' : 'Creation failed', e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.diagrams.remove(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['diagrams'] });
      toast.success(language === 'fr' ? 'Schéma supprimé' : 'Diagram deleted');
    },
  });

  return (
    <PageContainer>
      <PageHeader
        title={t.nav.diagrams}
        description={
          language === 'fr'
            ? 'Cartographiez et documentez votre infrastructure'
            : 'Map and document your infrastructure'
        }
        actions={
          canEdit && (
            <Button onClick={() => setCreating(true)}>
              <Plus className="h-4 w-4" /> {t.ui.createNew}{' '}
              {language === 'fr' ? 'schéma' : 'diagram'}
            </Button>
          )
        }
      />

      <div className="mt-6 px-6">
        {isLoading ? (
          <FullLoading />
        ) : data && data.diagrams.length > 0 ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {data.diagrams.map((d) => (
              <Card
                key={d.id}
                className="group relative overflow-hidden transition-all hover:shadow-md hover:border-primary/30"
              >
                <Link to={`/diagrams/${d.id}`} className="block">
                  {/* Visual preview (mini-grid) */}
                  <div className="relative flex h-32 items-center justify-center overflow-hidden border-b bg-gradient-to-br from-muted/40 to-muted/10">
                    <div
                      className="absolute inset-0 opacity-[0.05]"
                      style={{
                        backgroundImage:
                          'linear-gradient(currentColor 1px, transparent 1px), linear-gradient(90deg, currentColor 1px, transparent 1px)',
                        backgroundSize: '24px 24px',
                      }}
                    />
                    <Network className="h-12 w-12 text-muted-foreground/40 transition-transform group-hover:scale-110" />
                  </div>
                  <div className="p-4">
                    <h3 className="truncate font-semibold">{d.name}</h3>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {language === 'fr' ? 'Modifié le' : 'Updated'}{' '}
                      {formatDate(d.updatedAt, language)}
                    </p>
                    {d.site && <p className="mt-1 text-xs text-muted-foreground">{d.site.name}</p>}
                  </div>
                </Link>
                {canEdit && (
                  <div className="absolute right-2 top-2 opacity-0 transition-opacity group-hover:opacity-100">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="secondary"
                          size="icon-sm"
                          className="bg-card/90 backdrop-blur"
                        >
                          <MoreVertical className="h-3.5 w-3.5" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent>
                        <DropdownMenuItem
                          onSelect={() => {
                            const n = prompt('Nouveau nom', d.name);
                            if (n)
                              api.diagrams
                                .update(d.id, { name: n })
                                .then(() => qc.invalidateQueries({ queryKey: ['diagrams'] }));
                          }}
                        >
                          <Pencil className="h-4 w-4" /> {language === 'fr' ? 'Renommer' : 'Rename'}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onSelect={() => {
                            if (
                              confirm(
                                language === 'fr'
                                  ? 'Supprimer ce schéma ?'
                                  : 'Delete this diagram?',
                              )
                            )
                              deleteMutation.mutate(d.id);
                          }}
                        >
                          <Trash2 className="h-4 w-4" /> {t.ui.delete}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                )}
              </Card>
            ))}
          </div>
        ) : (
          <EmptyState
            icon={Network}
            title={language === 'fr' ? 'Aucun schéma' : 'No diagrams'}
            description={
              language === 'fr'
                ? "Créez votre premier schéma d'infrastructure pour commencer à cartographier votre réseau."
                : 'Create your first infrastructure diagram to start mapping your network.'
            }
            action={
              canEdit && (
                <Button onClick={() => setCreating(true)}>
                  <Plus className="h-4 w-4" /> {t.ui.create}{' '}
                  {language === 'fr' ? 'un schéma' : 'a diagram'}
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
              {t.ui.createNew} {language === 'fr' ? 'schéma' : 'diagram'}
            </DialogTitle>
            <DialogDescription>
              {language === 'fr'
                ? 'Donnez un nom et choisissez un point de départ.'
                : 'Name it and choose a starting point.'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Field label={`${t.ui.name} ${language === 'fr' ? 'du schéma' : 'of the diagram'}`}>
              <Input
                autoFocus
                placeholder={
                  language === 'fr'
                    ? 'Ex : Réseau production — Site Paris'
                    : 'E.g. Production network — Paris site'
                }
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && createMutation.mutate()}
              />
            </Field>
            <Field label="Template">
              <Select value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
                {DIAGRAM_TEMPLATES.map((template) => (
                  <option key={template.id} value={template.id}>
                    {template.name}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreating(false)}>
              {t.ui.cancel}
            </Button>
            <Button onClick={() => createMutation.mutate()} disabled={createMutation.isPending}>
              {t.ui.create} <ArrowRight className="h-4 w-4" />
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageContainer>
  );
}
