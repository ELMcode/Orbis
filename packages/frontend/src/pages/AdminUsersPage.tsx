import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Users, Plus, Trash2, ShieldCheck, Pencil, MapPin, LockKeyhole } from 'lucide-react';
import { api } from '@/lib/api';
import { useToast } from '@/hooks/useToast';
import { useAuth } from '@/hooks/useAuth';
import type { Member, Role } from '@/types';
import { PageContainer, PageHeader } from '@/components/layout/PageHeader';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
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
import { formatDate, initials, cn } from '@/lib/utils';
import { useLanguage } from '@/hooks/useLanguage';

const ROLE_LABELS: Record<Role, string> = {
  ADMIN: 'Administrateur',
  EDITOR: 'Editeur',
  VIEWER: 'Lecteur',
};

const ROLE_VARIANTS = { ADMIN: 'default', EDITOR: 'success', VIEWER: 'muted' } as const;

const MODULE_PERMISSIONS = [
  {
    value: 'inventory:write',
    label: 'Inventaire',
    description: 'Sites, equipements, ports et medias',
  },
  {
    value: 'topology:write',
    label: 'Schemas',
    description: 'Creation et modification des schemas',
  },
  { value: 'ipam:write', label: 'IPAM', description: 'VRF, VLAN, prefixes et adresses' },
  { value: 'dcim:write', label: 'DCIM', description: 'Baies, circuits, cables, operateurs' },
  { value: 'discovery:write', label: 'Decouverte', description: 'Imports, scans et collectors' },
  {
    value: 'source-of-truth:write',
    label: 'Referentiel',
    description: 'Contrats, dependances, champs, tags',
  },
  {
    value: 'monitoring:write',
    label: 'Monitoring',
    description: 'Incidents, maintenances et acquittements',
  },
  { value: 'reports:write', label: 'Rapports', description: 'Planifications et tests d envoi' },
  { value: 'alerts:admin', label: 'Alertes', description: 'Canaux sortants et politique alertes' },
  { value: 'security:admin', label: 'Securite', description: 'Politique risques et exports audit' },
  {
    value: 'integrations:admin',
    label: 'Integrations',
    description: 'API publique, webhooks et SSO',
  },
  { value: 'billing:admin', label: 'Facturation', description: 'Plan, portail et checkout' },
  { value: 'users:admin', label: 'Utilisateurs', description: 'Membres, roles et perimetres' },
] as const;

type MemberForm = {
  email: string;
  role: Role;
  status: Member['status'];
  permissions: string[];
};

export default function AdminUsersPage() {
  const { t, language } = useLanguage();
  const toast = useToast();
  const qc = useQueryClient();
  const { user: currentUser } = useAuth();
  const [editing, setEditing] = useState<Member | null>(null);
  const [inviting, setInviting] = useState(false);
  const [form, setForm] = useState<MemberForm>({
    email: '',
    role: 'VIEWER',
    status: 'ACTIVE',
    permissions: [],
  });
  const [scopesMember, setScopesMember] = useState<Member | null>(null);
  const [selectedScopes, setSelectedScopes] = useState<Set<string>>(new Set());

  const { data, isLoading } = useQuery({
    queryKey: ['members'],
    queryFn: () => api.users.list(),
  });

  const members = data?.members ?? [];

  const { data: sitesData } = useQuery({
    queryKey: ['sites'],
    queryFn: () => api.sites.list(),
    enabled: !!scopesMember,
  });

  const openScopes = async (member: Member) => {
    setScopesMember(member);
    const { siteIds } = await api.users.getSites(member.id);
    setSelectedScopes(new Set(siteIds));
  };

  const saveScopes = useMutation({
    mutationFn: () => api.users.setSites(scopesMember!.id, [...selectedScopes]),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['members'] });
      toast.success(language === 'fr' ? 'Périmètre mis à jour' : 'Scope updated');
      setScopesMember(null);
    },
    onError: (e: any) => toast.error(t.ui.failure, e.message),
  });

  const saveMutation = useMutation({
    mutationFn: () => {
      if (editing) {
        return api.users.update(editing.id, {
          role: form.role,
          status: form.status,
          permissions: form.role === 'ADMIN' ? [] : form.permissions,
        });
      }
      return api.users.invite({
        email: form.email,
        role: form.role,
        permissions: form.role === 'ADMIN' ? [] : form.permissions,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['members'] });
      setEditing(null);
      setInviting(false);
      setForm({ email: '', role: 'VIEWER', status: 'ACTIVE', permissions: [] });
      toast.success(
        editing
          ? language === 'fr'
            ? 'Membre mis à jour'
            : 'Member updated'
          : language === 'fr'
            ? 'Invitation créée'
            : 'Invitation created',
      );
    },
    onError: (e: any) => toast.error(t.ui.failure, e.message),
  });

  const removeMutation = useMutation({
    mutationFn: (id: string) => api.users.remove(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['members'] });
      toast.success(language === 'fr' ? 'Membre retiré' : 'Member removed');
    },
    onError: (e: any) => toast.error(t.ui.failure, e.message),
  });

  const openEdit = (member: Member) => {
    setEditing(member);
    setForm({
      email: member.email,
      role: member.role,
      status: member.status,
      permissions: member.permissions ?? [],
    });
  };

  const openInvite = () => {
    setInviting(true);
    setForm({ email: '', role: 'VIEWER', status: 'ACTIVE', permissions: [] });
  };

  const togglePermission = (permission: string) => {
    setForm((current) => ({
      ...current,
      permissions: current.permissions.includes(permission)
        ? current.permissions.filter((item) => item !== permission)
        : [...current.permissions, permission],
    }));
  };

  const dialogOpen = !!editing || inviting;

  return (
    <PageContainer>
      <PageHeader
        title={t.nav.users}
        description={`${members.length} ${language === 'fr' ? `membre${members.length > 1 ? 's' : ''}` : `member${members.length > 1 ? 's' : ''}`}`}
        actions={
          <Button onClick={openInvite}>
            <Plus className="h-4 w-4" />{' '}
            {language === 'fr' ? 'Inviter un membre' : 'Invite a member'}
          </Button>
        }
      />

      <div className="mt-6 px-6">
        {isLoading ? (
          <FullLoading />
        ) : members.length > 0 ? (
          <Card className="overflow-hidden">
            <div className="divide-y">
              {members.map((member) => (
                <div key={member.id} className="group flex items-center gap-4 px-4 py-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 text-xs font-semibold text-white">
                    {initials(member.name)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="truncate font-medium">{member.name}</p>
                      {member.userId === currentUser?.id && (
                        <Badge variant="outline">{language === 'fr' ? 'Vous' : 'You'}</Badge>
                      )}
                      {member.status !== 'ACTIVE' && (
                        <Badge variant="warning">{language === 'fr' ? 'Invité' : 'Invited'}</Badge>
                      )}
                      {member.active === false && (
                        <Badge variant="danger">
                          {language === 'fr' ? 'Compte désactivé' : 'Account disabled'}
                        </Badge>
                      )}
                    </div>
                    <p className="truncate text-xs text-muted-foreground">{member.email}</p>
                  </div>
                  <Badge variant={ROLE_VARIANTS[member.role]}>
                    {member.role === 'ADMIN' && <ShieldCheck className="h-3 w-3" />}
                    {language === 'fr'
                      ? ROLE_LABELS[member.role]
                      : { ADMIN: 'Administrator', EDITOR: 'Editor', VIEWER: 'Viewer' }[member.role]}
                  </Badge>
                  {member.permissions.length > 0 && (
                    <Badge variant="outline">
                      <LockKeyhole className="h-3 w-3" />
                      {member.permissions.length} permission
                      {member.permissions.length > 1 ? 's' : ''}
                    </Badge>
                  )}
                  <span className="hidden text-xs text-muted-foreground sm:inline">
                    {language === 'fr' ? 'Depuis le' : 'Since'}{' '}
                    {formatDate(member.joinedAt, language)}
                  </span>
                  <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => openScopes(member)}
                      title={language === 'fr' ? 'Périmètre de sites' : 'Site scope'}
                    >
                      <MapPin className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => openEdit(member)}
                      title={t.ui.edit}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    {member.userId !== currentUser?.id && (
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => {
                          if (
                            confirm(
                              language === 'fr'
                                ? `Retirer ${member.name} de cette organisation ?`
                                : `Remove ${member.name} from this organization?`,
                            )
                          ) {
                            removeMutation.mutate(member.id);
                          }
                        }}
                        className="text-muted-foreground hover:text-destructive"
                        title={t.ui.remove}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </Card>
        ) : (
          <EmptyState icon={Users} title={language === 'fr' ? 'Aucun membre' : 'No members'} />
        )}
      </div>

      <Dialog
        open={dialogOpen}
        onOpenChange={(open) => {
          if (!open) {
            setEditing(null);
            setInviting(false);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editing
                ? language === 'fr'
                  ? 'Modifier le membre'
                  : 'Edit member'
                : language === 'fr'
                  ? 'Inviter un membre'
                  : 'Invite member'}
            </DialogTitle>
            <DialogDescription>
              {editing
                ? 'Le role et le statut sont propres a l organisation active.'
                : 'Si le compte existe deja, il sera ajoute directement a cette organisation.'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Field label="Email">
              <Input
                type="email"
                value={form.email}
                disabled={!!editing}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Role">
                <Select
                  value={form.role}
                  onChange={(e) => setForm({ ...form, role: e.target.value as Role })}
                >
                  <option value="VIEWER">Lecteur</option>
                  <option value="EDITOR">Editeur</option>
                  <option value="ADMIN">Administrateur</option>
                </Select>
              </Field>
              {editing && (
                <Field label={language === 'fr' ? 'Statut' : 'Status'}>
                  <Select
                    value={form.status}
                    onChange={(e) =>
                      setForm({ ...form, status: e.target.value as Member['status'] })
                    }
                  >
                    <option value="ACTIVE">Actif</option>
                    <option value="INVITED">Invite</option>
                  </Select>
                </Field>
              )}
            </div>
            <Field label="Permissions par module">
              <div className="rounded-lg border p-3">
                <p className="text-xs text-muted-foreground">
                  Sans permission explicite, le role garde son comportement standard. Avec des
                  permissions, un membre non-admin est limite aux modules selectionnes.
                </p>
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  {MODULE_PERMISSIONS.map((permission) => {
                    const checked = form.permissions.includes(permission.value);
                    return (
                      <button
                        key={permission.value}
                        type="button"
                        onClick={() => togglePermission(permission.value)}
                        disabled={form.role === 'ADMIN'}
                        className={cn(
                          'rounded-md border p-3 text-left transition-colors',
                          checked
                            ? 'border-primary bg-primary/10 text-primary'
                            : 'border-input hover:bg-accent',
                          form.role === 'ADMIN' && 'cursor-not-allowed opacity-60',
                        )}
                      >
                        <span className="block text-sm font-medium">{permission.label}</span>
                        <span className="mt-0.5 block text-xs text-muted-foreground">
                          {permission.description}
                        </span>
                      </button>
                    );
                  })}
                </div>
                {form.role === 'ADMIN' && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Un administrateur a toujours acces a tous les modules.
                  </p>
                )}
              </div>
            </Field>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setEditing(null);
                setInviting(false);
              }}
            >
              {language === 'fr' ? 'Annuler' : 'Cancel'}
            </Button>
            <Button
              onClick={() => saveMutation.mutate()}
              disabled={saveMutation.isPending || (!editing && !form.email)}
            >
              {editing
                ? language === 'fr'
                  ? 'Enregistrer'
                  : 'Save'
                : language === 'fr'
                  ? 'Inviter'
                  : 'Invite'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!scopesMember} onOpenChange={(open) => !open && setScopesMember(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Perimetre de {scopesMember?.name}</DialogTitle>
            <DialogDescription>
              Selectionnez les sites accessibles. Un acces a un site donne aussi acces a ses
              sous-sites.
              {scopesMember?.role === 'ADMIN' && (
                <span className="mt-1 block text-status-warning">
                  Un admin sans site selectionne garde l'acces a tous les sites.
                </span>
              )}
            </DialogDescription>
          </DialogHeader>

          <div className="max-h-80 space-y-1 overflow-y-auto rounded-lg border p-2">
            {sitesData?.sites.map((site) => {
              const checked = selectedScopes.has(site.id);
              return (
                <label
                  key={site.id}
                  className={cn(
                    'flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-accent',
                    checked && 'bg-primary/5',
                  )}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(e) => {
                      setSelectedScopes((prev) => {
                        const next = new Set(prev);
                        if (e.target.checked) next.add(site.id);
                        else next.delete(site.id);
                        return next;
                      });
                    }}
                    className="h-4 w-4 rounded border-input accent-primary"
                  />
                  <MapPin className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="flex-1 truncate">{site.name}</span>
                  {site.location && (
                    <span className="truncate text-xs text-muted-foreground">{site.location}</span>
                  )}
                </label>
              );
            })}
            {sitesData?.sites.length === 0 && (
              <p className="py-6 text-center text-xs text-muted-foreground">
                {language === 'fr' ? 'Aucun site disponible' : 'No sites available'}
              </p>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setScopesMember(null)}>
              {language === 'fr' ? 'Annuler' : 'Cancel'}
            </Button>
            <Button onClick={() => saveScopes.mutate()} disabled={saveScopes.isPending}>
              {language === 'fr' ? 'Enregistrer' : 'Save'} ({selectedScopes.size})
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageContainer>
  );
}
