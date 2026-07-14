import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import { useTheme } from '@/hooks/useTheme';
import { useToast } from '@/hooks/useToast';
import {
  Building2,
  Copy,
  CreditCard,
  ExternalLink,
  Github,
  KeyRound,
  Link2,
  LogOut,
  Moon,
  Palette,
  AlertTriangle,
  PlugZap,
  ShieldCheck,
  Sun,
  User,
  LockKeyhole,
} from 'lucide-react';
import { api } from '@/lib/api';
import { PageContainer, PageHeader } from '@/components/layout/PageHeader';
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Input } from '@/components/ui/Input';
import { cn, initials } from '@/lib/utils';
import type { PublicApiScope } from '@/types';
import { localized, useLanguage } from '@/hooks/useLanguage';

const ROLE_LABELS = { ADMIN: 'Administrateur', EDITOR: 'Éditeur', VIEWER: 'Lecteur' } as const;
const ROLE_VARIANTS = { ADMIN: 'default', EDITOR: 'success', VIEWER: 'muted' } as const;
const QUOTA_LABELS: Record<string, string> = {
  members: 'Utilisateurs',
  sites: 'Sites',
  devices: 'Équipements',
  diagrams: 'Schémas',
  collectors: 'Collectors',
  reportSchedules: 'Rapports planifiés',
  ipAddresses: 'Adresses IP',
};

function IntegrationCredentialsCard() {
  const { language } = useLanguage();
  const toast = useToast();
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [provider, setProvider] = useState('AWS');
  const [secret, setSecret] = useState('');
  const query = useQuery({
    queryKey: ['integration-credentials'],
    queryFn: () => api.integrationCredentials.list(),
  });
  const create = useMutation({
    mutationFn: () =>
      api.integrationCredentials.create({ name: name.trim(), provider, secret: { value: secret } }),
    onSuccess: () => {
      setName('');
      setSecret('');
      qc.invalidateQueries({ queryKey: ['integration-credentials'] });
      toast.success(
        localized(language, 'Identifiant chiffré enregistré', 'Encrypted credential saved'),
      );
    },
    onError: (err: any) => toast.error('Enregistrement impossible', err.message),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.integrationCredentials.remove(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['integration-credentials'] }),
  });
  return (
    <Card className="lg:col-span-2">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <LockKeyhole className="h-4 w-4" />{' '}
          {localized(language, "Identifiants d'intégration", 'Integration credentials')}
        </CardTitle>
        <CardDescription>
          {localized(
            language,
            'Secrets cloud et hyperviseurs chiffrés, réservés aux administrateurs.',
            'Encrypted cloud and hypervisor secrets, restricted to administrators.',
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {!query.data?.configured && (
          <p className="rounded-md border border-warning/40 bg-warning/10 p-3 text-sm">
            {localized(
              language,
              'Le coffre n’est pas configuré : définissez `INTEGRATION_ENCRYPTION_KEY` avec une clé base64 de 32 octets avant tout enregistrement.',
              'The vault is not configured: set `INTEGRATION_ENCRYPTION_KEY` to a 32-byte base64 key before saving credentials.',
            )}
          </p>
        )}
        <div className="grid gap-2 md:grid-cols-3">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Nom de connexion"
          />
          <select
            className="rounded-md border bg-background px-3 text-sm"
            value={provider}
            onChange={(e) => setProvider(e.target.value)}
          >
            {['AWS', 'AZURE', 'GCP', 'VSPHERE', 'PROXMOX', 'HYPERV'].map((item) => (
              <option key={item}>{item}</option>
            ))}
          </select>
          <Input
            type="password"
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            placeholder="Secret ou jeton"
          />
        </div>
        <Button
          onClick={() => create.mutate()}
          disabled={!query.data?.configured || !name.trim() || !secret || create.isPending}
        >
          {localized(language, 'Enregistrer', 'Save')}
        </Button>
        {(query.data?.credentials ?? []).map((credential) => (
          <div
            key={credential.id}
            className="flex items-center justify-between border-t pt-2 text-sm"
          >
            <span>
              {credential.name} <Badge variant="outline">{credential.provider}</Badge>
            </span>
            <Button size="sm" variant="ghost" onClick={() => remove.mutate(credential.id)}>
              {localized(language, 'Supprimer', 'Delete')}
            </Button>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

export default function SettingsPage() {
  const { user, logout, activeOrganization, isAdmin } = useAuth();
  const { t, language } = useLanguage();
  const { theme, setTheme } = useTheme();
  const role = activeOrganization?.role ?? 'VIEWER';

  return (
    <PageContainer>
      <PageHeader
        title={t.settings}
        description={
          language === 'fr'
            ? "Compte, organisation et préférences de l'espace de travail."
            : 'Account, organization and workspace preferences.'
        }
      />

      <div className="mx-auto mt-6 grid w-full max-w-5xl gap-4 px-6 lg:grid-cols-2">
        {/* ─── Profile ────────────────────────────────── */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <User className="h-4 w-4" /> {language === 'fr' ? 'Profil' : 'Profile'}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-4">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 text-lg font-semibold text-white">
                {initials(user?.name ?? '?')}
              </div>
              <div>
                <p className="font-semibold">{user?.name}</p>
                <p className="text-sm text-muted-foreground">{user?.email}</p>
                <Badge variant={ROLE_VARIANTS[role]} className="mt-1">
                  {ROLE_LABELS[role]}
                </Badge>
                {activeOrganization && (
                  <p className="mt-1 text-xs text-muted-foreground">{activeOrganization.name}</p>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* ─── Organization ───────────────────────────── */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Building2 className="h-4 w-4" /> {t.organization}
            </CardTitle>
            <CardDescription>
              {language === 'fr'
                ? 'Contexte actif de travail et droits associés.'
                : 'Active workspace context and associated permissions.'}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex items-center justify-between gap-3">
              <span className="text-muted-foreground">
                {language === 'fr' ? 'Espace actif' : 'Active workspace'}
              </span>
              <span className="truncate font-medium">
                {activeOrganization?.name ?? 'Organisation'}
              </span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-muted-foreground">{language === 'fr' ? 'Rôle' : 'Role'}</span>
              <Badge variant={ROLE_VARIANTS[role]}>{ROLE_LABELS[role]}</Badge>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-muted-foreground">{language === 'fr' ? 'Plan' : 'Plan'}</span>
              <Badge variant="outline">{activeOrganization?.plan ?? 'FREE'}</Badge>
            </div>
          </CardContent>
        </Card>

        {/* ─── Apparence ─────────────────────────────── */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Palette className="h-4 w-4" /> {language === 'fr' ? 'Apparence' : 'Appearance'}
            </CardTitle>
            <CardDescription>
              {language === 'fr'
                ? "Mode d'affichage utilisé sur ce navigateur."
                : 'Display mode used in this browser.'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => setTheme('light')}
                className={cn(
                  'flex flex-col items-center gap-2 rounded-lg border-2 p-4 transition-all',
                  theme === 'light'
                    ? 'border-primary bg-primary/5'
                    : 'border-border hover:bg-accent',
                )}
              >
                <Sun className="h-6 w-6 text-amber-500" />
                <span className="text-sm font-medium">{language === 'fr' ? 'Clair' : 'Light'}</span>
              </button>
              <button
                onClick={() => setTheme('dark')}
                className={cn(
                  'flex flex-col items-center gap-2 rounded-lg border-2 p-4 transition-all',
                  theme === 'dark'
                    ? 'border-primary bg-primary/5'
                    : 'border-border hover:bg-accent',
                )}
              >
                <Moon className="h-6 w-6 text-indigo-400" />
                <span className="text-sm font-medium">{language === 'fr' ? 'Sombre' : 'Dark'}</span>
              </button>
            </div>
          </CardContent>
        </Card>

        {isAdmin && <BillingCard />}
        {isAdmin && <SsoCard />}
        {isAdmin && <IntegrationCredentialsCard />}
        {isAdmin && <IntegrationsCard />}
        {isAdmin && activeOrganization && (
          <OrganizationDeletionCard organization={activeOrganization} onLogout={logout} />
        )}

        {/* ─── Security ───────────────────────────────── */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4" /> {t.nav.security}
            </CardTitle>
            <CardDescription>
              {language === 'fr'
                ? 'Accès au compte et session courante.'
                : 'Account access and current session.'}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-lg border p-3">
              <div className="flex items-center gap-2 text-sm font-medium">
                <KeyRound className="h-4 w-4 text-muted-foreground" />
                {language === 'fr' ? 'Authentification' : 'Authentication'}
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                {language === 'fr'
                  ? 'La session est protégée par tokens courts et renouvellement contrôlé.'
                  : 'The session is protected by short-lived tokens and controlled renewal.'}
              </p>
            </div>
            <Button
              variant="destructive"
              onClick={() => {
                if (confirm(language === 'fr' ? 'Se déconnecter ?' : 'Sign out?')) logout();
              }}
            >
              <LogOut className="h-4 w-4" /> {t.logout}
            </Button>
          </CardContent>
        </Card>

        {/* ─── About ─────────────────────────────────── */}
        <Card>
          <CardHeader>
            <CardTitle>{language === 'fr' ? 'À propos' : 'About'}</CardTitle>
            <CardDescription>
              {language === 'fr'
                ? "Informations produit visibles par les utilisateurs de l'organisation."
                : 'Product information visible to organization users.'}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-muted-foreground">
            <div className="flex items-center justify-between">
              <span>{language === 'fr' ? 'Application' : 'Application'}</span>
              <span className="font-medium text-foreground">Orbis v1.0.0</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span>{language === 'fr' ? 'Éditeur' : 'Publisher'}</span>
              <a
                href="https://github.com/ELMcode"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 font-medium text-foreground hover:text-primary"
              >
                <Github className="h-4 w-4" />
                Dev by ELM
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            </div>
            <div className="rounded-lg border p-3">
              <p className="font-medium text-foreground">Orbis</p>
              <p className="mt-1">
                {language === 'fr'
                  ? 'Cartographie, inventaire, découverte réseau, IPAM, DCIM, alertes et reporting pour les équipes infrastructure.'
                  : 'Mapping, inventory, network discovery, IPAM, DCIM, alerts and reporting for infrastructure teams.'}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </PageContainer>
  );
}

function OrganizationDeletionCard({
  organization,
  onLogout,
}: {
  organization: { id: string; name: string };
  onLogout: () => Promise<void>;
}) {
  const { language } = useLanguage();
  const [confirmation, setConfirmation] = useState('');
  const { success, error } = useToast();
  const deletion = useMutation({
    mutationFn: () => api.auth.requestOrganizationDeletion(organization.id, confirmation),
    onSuccess: async (data) => {
      success(
        localized(language, 'Suppression planifiée', 'Deletion scheduled'),
        `${localized(language, 'Les données seront purgées le', 'Data will be purged on')} ${new Date(data.scheduledDeletionAt).toLocaleDateString(language === 'fr' ? 'fr-FR' : 'en-GB')}.`,
      );
      await onLogout();
    },
    onError: (err) =>
      error(
        localized(language, 'Suppression non planifiée', 'Deletion could not be scheduled'),
        err instanceof Error ? err.message : undefined,
      ),
  });

  return (
    <Card className="border-destructive/40">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-destructive">
          <AlertTriangle className="h-4 w-4" /> Zone sensible
        </CardTitle>
        <CardDescription>
          {localized(
            language,
            "La suppression est réversible pendant 30 jours, puis les données de l'organisation sont purgées.",
            'Deletion can be reversed for 30 days, after which organization data is purged.',
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Input
          value={confirmation}
          onChange={(event) => setConfirmation(event.target.value)}
          placeholder={`Saisir ${organization.name} pour confirmer`}
          aria-label="Confirmation du nom de l'organisation"
        />
        <Button
          variant="destructive"
          disabled={confirmation !== organization.name || deletion.isPending}
          onClick={() => deletion.mutate()}
        >
          <AlertTriangle className="h-4 w-4" /> Planifier la suppression
        </Button>
      </CardContent>
    </Card>
  );
}

function IntegrationsCard() {
  const { language } = useLanguage();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [apiKeyName, setApiKeyName] = useState('Intégration interne');
  const [apiScopes, setApiScopes] = useState<PublicApiScope[]>([
    'read:inventory',
    'read:ipam',
    'read:events',
  ]);
  const [createdToken, setCreatedToken] = useState<string | null>(null);
  const [webhookName, setWebhookName] = useState('ITSM');
  const [webhookUrl, setWebhookUrl] = useState('');
  const [webhookSecret, setWebhookSecret] = useState<string | null>(null);

  const catalog = useQuery({
    queryKey: ['integrations-catalog'],
    queryFn: () => api.integrations.catalog(),
  });
  const keys = useQuery({
    queryKey: ['integrations-api-keys'],
    queryFn: () => api.integrations.apiKeys(),
  });
  const webhooks = useQuery({
    queryKey: ['integrations-webhooks'],
    queryFn: () => api.integrations.webhooks(),
  });

  const createKey = useMutation({
    mutationFn: () => api.integrations.createApiKey({ name: apiKeyName, scopes: apiScopes }),
    onSuccess: (data) => {
      setCreatedToken(data.token);
      queryClient.invalidateQueries({ queryKey: ['integrations-api-keys'] });
      toast.success(
        localized(language, 'Clé API créée', 'API key created'),
        localized(
          language,
          'Copiez le token maintenant, il ne sera plus affiché.',
          'Copy the token now; it will not be shown again.',
        ),
      );
    },
    onError: (err: Error) => toast.error('Création impossible', err.message),
  });

  const revokeKey = useMutation({
    mutationFn: (id: string) => api.integrations.revokeApiKey(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['integrations-api-keys'] });
      toast.success(localized(language, 'Clé révoquée', 'Key revoked'));
    },
    onError: (err: Error) => toast.error('Révocation impossible', err.message),
  });

  const createWebhook = useMutation({
    mutationFn: () => api.integrations.createWebhook({ name: webhookName, url: webhookUrl }),
    onSuccess: (data) => {
      setWebhookSecret(data.secret);
      setWebhookUrl('');
      queryClient.invalidateQueries({ queryKey: ['integrations-webhooks'] });
      toast.success(
        localized(language, 'Webhook créé', 'Webhook created'),
        localized(
          language,
          'Copiez le secret de signature maintenant.',
          'Copy the signing secret now.',
        ),
      );
    },
    onError: (err: Error) => toast.error('Création webhook impossible', err.message),
  });

  const testWebhook = useMutation({
    mutationFn: (id: string) => api.integrations.testWebhook(id),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['integrations-webhooks'] });
      toast[data.delivery.status === 'SENT' ? 'success' : 'warning'](
        localized(language, 'Test webhook terminé', 'Webhook test completed'),
        `Statut : ${data.delivery.status}`,
      );
    },
    onError: (err: Error) => toast.error('Test impossible', err.message),
  });

  const toggleScope = (scope: PublicApiScope) => {
    setApiScopes((current) =>
      current.includes(scope) ? current.filter((item) => item !== scope) : [...current, scope],
    );
  };

  const copy = async (value: string) => {
    await navigator.clipboard.writeText(value);
    toast.success(localized(language, 'Copié', 'Copied'));
  };

  return (
    <Card className="lg:col-span-2">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <PlugZap className="h-4 w-4" /> {localized(language, 'Intégrations', 'Integrations')}
        </CardTitle>
        <CardDescription>
          {localized(
            language,
            'API publique versionnée, clés dédiées et webhooks sortants signés.',
            'Versioned public API, dedicated keys and signed outbound webhooks.',
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-4 rounded-lg border p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-semibold">API publique</p>
              <p className="text-sm text-muted-foreground">
                Inventaire, sites, IPAM et événements avec pagination.
              </p>
            </div>
            <a href="/api/docs" target="_blank" rel="noreferrer">
              <Button variant="outline" size="sm">
                <ExternalLink className="h-4 w-4" /> Docs
              </Button>
            </a>
          </div>
          <div className="rounded-md bg-muted p-3 text-xs">
            <code>{catalog.data?.publicApi.baseUrl ?? '/api/public/v1'}</code>
          </div>
          <div className="grid gap-2">
            <Input
              value={apiKeyName}
              onChange={(event) => setApiKeyName(event.target.value)}
              placeholder={localized(language, 'Nom de la clé', 'Key name')}
            />
            <div className="flex flex-wrap gap-2">
              {(keys.data?.scopes ?? ['read:inventory', 'read:ipam', 'read:events']).map(
                (scope) => (
                  <button
                    key={scope}
                    type="button"
                    onClick={() => toggleScope(scope)}
                    className={cn(
                      'rounded-md border px-2.5 py-1 text-xs font-medium',
                      apiScopes.includes(scope)
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-border text-muted-foreground hover:bg-accent',
                    )}
                  >
                    {scope}
                  </button>
                ),
              )}
            </div>
            <Button
              onClick={() => createKey.mutate()}
              disabled={!apiKeyName.trim() || apiScopes.length === 0 || createKey.isPending}
            >
              <KeyRound className="h-4 w-4" /> {localized(language, 'Créer une clé', 'Create key')}
            </Button>
          </div>
          {createdToken && (
            <div className="rounded-lg border border-status-warning/30 bg-status-warning/5 p-3">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Token à copier maintenant
              </p>
              <div className="mt-2 flex items-center gap-2">
                <code className="min-w-0 flex-1 truncate text-xs">{createdToken}</code>
                <Button size="icon" variant="outline" onClick={() => copy(createdToken)}>
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
          <div className="space-y-2">
            {(keys.data?.keys ?? []).map((key) => (
              <div
                key={key.id}
                className="flex items-center justify-between gap-3 rounded-md border p-2 text-sm"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium">{key.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {key.tokenPrefix}... · {key.scopes.join(', ')}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={key.status === 'ACTIVE' ? 'success' : 'muted'}>
                    {key.status}
                  </Badge>
                  {key.status === 'ACTIVE' && (
                    <Button size="sm" variant="outline" onClick={() => revokeKey.mutate(key.id)}>
                      {localized(language, 'Révoquer', 'Revoke')}
                    </Button>
                  )}
                </div>
              </div>
            ))}
            {!keys.isLoading && (keys.data?.keys.length ?? 0) === 0 && (
              <p className="rounded-md border p-3 text-sm text-muted-foreground">
                {localized(language, 'Aucune clé API créée.', 'No API keys created.')}
              </p>
            )}
          </div>
        </div>

        <div className="space-y-4 rounded-lg border p-4">
          <div>
            <p className="text-sm font-semibold">Webhooks sortants</p>
            <p className="text-sm text-muted-foreground">
              Notifications signées vers ITSM, SIEM, automatisation ou CMDB externe.
            </p>
          </div>
          <div className="grid gap-2">
            <Input
              value={webhookName}
              onChange={(event) => setWebhookName(event.target.value)}
              placeholder="Nom"
            />
            <Input
              value={webhookUrl}
              onChange={(event) => setWebhookUrl(event.target.value)}
              placeholder="https://example.com/orbis/webhook"
            />
            <Button
              onClick={() => createWebhook.mutate()}
              disabled={!webhookName.trim() || !webhookUrl.trim() || createWebhook.isPending}
            >
              <Link2 className="h-4 w-4" /> Ajouter un webhook
            </Button>
          </div>
          {webhookSecret && (
            <div className="rounded-lg border border-status-warning/30 bg-status-warning/5 p-3">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Secret de signature
              </p>
              <div className="mt-2 flex items-center gap-2">
                <code className="min-w-0 flex-1 truncate text-xs">{webhookSecret}</code>
                <Button size="icon" variant="outline" onClick={() => copy(webhookSecret)}>
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
          <div className="space-y-2">
            {(webhooks.data?.endpoints ?? []).map((endpoint) => (
              <div key={endpoint.id} className="rounded-md border p-2 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{endpoint.name}</p>
                    <p className="truncate text-xs text-muted-foreground">{endpoint.url}</p>
                  </div>
                  <Badge variant={endpoint.status === 'ACTIVE' ? 'success' : 'muted'}>
                    {endpoint.status}
                  </Badge>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => testWebhook.mutate(endpoint.id)}
                  >
                    Tester
                  </Button>
                  <span className="text-xs text-muted-foreground">
                    {endpoint.lastSuccessAt
                      ? `Dernier succès ${new Date(endpoint.lastSuccessAt).toLocaleString()}`
                      : 'Aucun succès'}
                  </span>
                  {endpoint.lastFailureAt && (
                    <span className="text-xs text-destructive">
                      Échec {new Date(endpoint.lastFailureAt).toLocaleString()}
                    </span>
                  )}
                </div>
              </div>
            ))}
            {!webhooks.isLoading && (webhooks.data?.endpoints.length ?? 0) === 0 && (
              <p className="rounded-md border p-3 text-sm text-muted-foreground">
                Aucun webhook configuré.
              </p>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function SsoCard() {
  const { language } = useLanguage();
  const { data, isLoading } = useQuery({
    queryKey: ['sso-config'],
    queryFn: () => api.sso.config(),
  });

  const startSso = async () => {
    const { url } = await api.sso.start({ provider: 'authkit' });
    window.location.href = url;
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Building2 className="h-4 w-4" /> SSO entreprise
        </CardTitle>
        <CardDescription>
          {localized(
            language,
            'Connexion centralisée via WorkOS/AuthKit.',
            'Centralized sign-in through WorkOS/AuthKit.',
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">{localized(language, 'État', 'Status')}</span>
          <Badge variant={data?.configured ? 'success' : 'warning'}>
            {data?.configured
              ? localized(language, 'Configuré', 'Configured')
              : isLoading
                ? localized(language, 'Vérification', 'Checking')
                : localized(language, 'À configurer', 'Needs configuration')}
          </Badge>
        </div>
        <div className="grid gap-2 text-sm">
          <div className="flex items-center justify-between gap-3">
            <span className="text-muted-foreground">Client ID</span>
            <Badge variant={data?.clientConfigured ? 'success' : 'muted'}>
              {data?.clientConfigured ? 'OK' : 'Manquant'}
            </Badge>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="text-muted-foreground">API key / callback</span>
            <Badge variant={data?.callbackConfigured ? 'success' : 'muted'}>
              {data?.callbackConfigured ? 'OK' : 'Manquant'}
            </Badge>
          </div>
        </div>
        {data?.redirectUri && (
          <div className="rounded-lg border p-3">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Redirect URI
            </p>
            <code className="mt-1 block break-all text-xs">{data.redirectUri}</code>
          </div>
        )}
        <Button onClick={startSso} disabled={!data?.configured}>
          Tester la connexion SSO
        </Button>
      </CardContent>
    </Card>
  );
}

function BillingCard() {
  const { data, isLoading } = useQuery({
    queryKey: ['billing-status'],
    queryFn: () => api.billing.status(),
  });

  const openCheckout = async () => {
    const { url } = await api.billing.checkout();
    window.location.href = url;
  };

  const openPortal = async () => {
    const { url } = await api.billing.portal();
    window.location.href = url;
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CreditCard className="h-4 w-4" /> Abonnement
        </CardTitle>
        <CardDescription>Plan et facturation de l'organisation active</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">Plan</span>
          <Badge variant="outline">{data?.organization?.plan ?? 'FREE'}</Badge>
        </div>
        {data?.quotas && data?.usage && (
          <div className="rounded-lg border p-3">
            <p className="mb-3 text-sm font-medium">Utilisation du plan</p>
            <div className="space-y-2">
              {Object.entries(QUOTA_LABELS).map(([key, label]) => {
                const used = data.usage[key] ?? 0;
                const limit = data.quotas[key] ?? null;
                const pct = limit ? Math.min(100, Math.round((used / limit) * 100)) : 0;
                return (
                  <div key={key}>
                    <div className="mb-1 flex items-center justify-between gap-3 text-xs">
                      <span className="text-muted-foreground">{label}</span>
                      <span className="font-medium">
                        {used} / {limit ?? 'illimité'}
                      </span>
                    </div>
                    {limit !== null && (
                      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full rounded-full bg-primary"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
        {!data?.configured && !isLoading && (
          <p className="text-sm text-muted-foreground">
            Stripe n'est pas encore configuré sur cette instance.
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <Button onClick={openCheckout} disabled={!data?.configured}>
            Passer au plan Pro
          </Button>
          <Button
            variant="outline"
            onClick={openPortal}
            disabled={!data?.configured || !data?.organization?.stripeCustomerId}
          >
            Portail client
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
