import type {
  AlertSettings,
  AuthMeResponse,
  Device,
  Diagram,
  DiagramComment,
  DiscoveryCollector,
  DiscoveryEvent,
  DiscoveryEventSeverity,
  DiscoveryEventType,
  DiscoveryFormat,
  DiscoveryImportResult,
  Cable,
  Circuit,
  EntityComment,
  EntityCommentTarget,
  IpAddress,
  IpAddressStatus,
  IpPrefix,
  Member,
  Organization,
  PatchPanel,
  Provider,
  Rack,
  ReportFormat,
  ReportFrequency,
  ReportSchedule,
  ReportType,
  Role,
  SecurityPolicy,
  SecuritySummary,
  Site,
  AuditLog,
  User,
  Vlan,
  Vrf,
  PublicApiKey,
  PublicApiScope,
  WebhookDelivery,
  WebhookEndpoint,
  AvailabilitySummary,
  Incident,
  IncidentStatus,
  MaintenanceWindow,
  MonitoringPolicy,
  ApplicationDependency,
  ApplicationDependencyType,
  AssetContract,
  AssetContractStatus,
  AssetContractType,
  Criticality,
  CustomFieldDefinition,
  CustomFieldTarget,
  SavedView,
  SavedViewTarget,
  TagDefinition,
} from '@/types';

const ORG_KEY = 'orbis_org';
const LEGACY_ORG_KEY = 'orbis_org';
let accessToken: string | null = null;

export const storage = {
  getAccess: () => accessToken,
  setAccess: (token: string) => {
    accessToken = token;
  },
  getOrg: () => localStorage.getItem(ORG_KEY) ?? localStorage.getItem(LEGACY_ORG_KEY),
  setOrg: (id: string) => localStorage.setItem(ORG_KEY, id),
  clear: () => {
    accessToken = null;
    localStorage.removeItem(ORG_KEY);
    localStorage.removeItem(LEGACY_ORG_KEY);
  },
};

/**
 * Build an authenticated URL for an uploaded image or attachment.
 * Uploads are no longer served statically; they go through /api/media/file.
 */
export function mediaUrl(path: string | null | undefined): string {
  if (!path) return '';
  return `/api/media/file/${path}`;
}

export async function fetchMediaBlobUrl(path: string): Promise<string> {
  const mediaPath = mediaUrl(path);
  const headers: Record<string, string> = {};
  const token = storage.getAccess();
  const orgId = storage.getOrg();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (orgId) headers['x-organization-id'] = orgId;

  let res = await fetch(mediaPath, { headers });
  if (res.status === 401) {
    if (!isRefreshing) {
      isRefreshing = true;
      refreshPromise = refreshTokens().finally(() => {
        isRefreshing = false;
      });
    }
    const refreshed = await refreshPromise!;
    if (refreshed) {
      const newToken = storage.getAccess();
      if (newToken) headers.Authorization = `Bearer ${newToken}`;
      res = await fetch(mediaPath, { headers });
    }
  }

  if (!res.ok) {
    throw new ApiError(res.status, `Erreur ${res.status}`);
  }

  const blob = await res.blob();
  return URL.createObjectURL(blob);
}

export async function downloadMedia(path: string, filename?: string): Promise<void> {
  const url = await fetchMediaBlobUrl(path);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename ?? '';
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export async function downloadAuthenticated(path: string, filename: string): Promise<void> {
  const headers: Record<string, string> = {};
  const token = storage.getAccess();
  const orgId = storage.getOrg();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (orgId) headers['x-organization-id'] = orgId;
  const res = await fetch(path, { headers });
  if (!res.ok) throw new ApiError(res.status, `Téléchargement impossible (${res.status})`);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

let isRefreshing = false;
let refreshPromise: Promise<boolean> | null = null;

async function refreshTokens(): Promise<boolean> {
  try {
    const res = await fetch('/api/auth/refresh', {
      method: 'POST',
      credentials: 'same-origin',
    });
    if (!res.ok) {
      storage.clear();
      return false;
    }
    const data = await res.json();
    storage.setAccess(data.accessToken);
    return true;
  } catch {
    storage.clear();
    return false;
  }
}

async function request<T = unknown>(path: string, options: RequestInit = {}): Promise<T> {
  const token = storage.getAccess();
  const orgId = storage.getOrg();
  const headers: Record<string, string> = {
    ...(options.body && !(options.body instanceof FormData)
      ? { 'Content-Type': 'application/json' }
      : {}),
    ...((options.headers as Record<string, string>) ?? {}),
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  // Multi-tenant context header, except for /auth/* and /health routes.
  if (orgId && !path.includes('/auth/') && !path.includes('/health')) {
    headers['x-organization-id'] = orgId;
  }

  let res = await fetch(path, { ...options, headers, credentials: 'same-origin' });

  // On 401, refresh once and retry the request once.
  if (res.status === 401 && !path.includes('/auth/')) {
    if (!isRefreshing) {
      isRefreshing = true;
      refreshPromise = refreshTokens().finally(() => {
        isRefreshing = false;
      });
    }
    const refreshed = await refreshPromise!;
    if (refreshed) {
      const newToken = storage.getAccess();
      if (newToken) headers.Authorization = `Bearer ${newToken}`;
      res = await fetch(path, { ...options, headers, credentials: 'same-origin' });
    }
  }

  if (!res.ok) {
    let message = `Erreur ${res.status}`;
    let details: unknown;
    try {
      const body = await res.json();
      message = body.message ?? message;
      details = body.details;
    } catch {
      // ignore
    }
    throw new ApiError(res.status, message, details);
  }

  if (res.status === 204) return undefined as T;
  const ct = res.headers.get('content-type') ?? '';
  if (ct.includes('application/json')) return (await res.json()) as T;
  return (await res.text()) as unknown as T;
}

export const api = {
  // ─── Auth ────────────────────────────────────────────────
  auth: {
    login: (email: string, password: string) =>
      request<{ user: User; organizations: Organization[]; accessToken: string }>(
        '/api/auth/login',
        {
          method: 'POST',
          body: JSON.stringify({ email, password }),
        },
      ),
    register: (name: string, email: string, password: string) =>
      request<{ user: User; organizations: Organization[]; accessToken: string }>(
        '/api/auth/register',
        {
          method: 'POST',
          body: JSON.stringify({ name, email, password }),
        },
      ),
    forgotPassword: (email: string) =>
      request<{ success: boolean }>('/api/auth/password/forgot', {
        method: 'POST',
        body: JSON.stringify({ email }),
      }),
    resetPassword: (token: string, password: string) =>
      request<{ success: boolean }>('/api/auth/password/reset', {
        method: 'POST',
        body: JSON.stringify({ token, password }),
      }),
    me: () => request<AuthMeResponse>('/api/auth/me'),
    refresh: () => refreshTokens(),
    logout: () => request('/api/auth/logout', { method: 'POST' }),
    requestOrganizationDeletion: (id: string, confirmation: string) =>
      request<{ scheduledDeletionAt: string; graceDays?: number }>(
        `/api/auth/organizations/${id}`,
        { method: 'DELETE', body: JSON.stringify({ confirmation }) },
      ),
    cancelOrganizationDeletion: (id: string) =>
      request<{ success: boolean }>(`/api/auth/organizations/${id}/cancel-deletion`, {
        method: 'POST',
      }),
  },

  sso: {
    config: () =>
      request<{
        configured: boolean;
        clientConfigured: boolean;
        callbackConfigured: boolean;
        redirectUri: string;
        providers: Array<'GoogleOAuth' | 'MicrosoftOAuth' | 'OktaSAML' | 'authkit'>;
      }>('/api/sso/config'),
    start: (data: {
      provider?: 'GoogleOAuth' | 'MicrosoftOAuth' | 'OktaSAML' | 'authkit';
      organization?: string;
    }) =>
      request<{ url: string }>('/api/sso/workos/start', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
  },

  // ─── Users (admin) ───────────────────────────────────────
  users: {
    list: () => request<{ members: Member[] }>('/api/users'),
    mentionable: () =>
      request<{ members: Array<Pick<Member, 'id' | 'name' | 'email' | 'avatarUrl'>> }>(
        '/api/users/mentionable',
      ),
    invite: (data: { email: string; role: Role; permissions?: string[] }) =>
      request<{ membership?: Member; invitation?: unknown }>('/api/users/invite', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    update: (
      id: string,
      data: { role?: Role; status?: Member['status']; permissions?: string[] },
    ) =>
      request<{ membership: Member }>(`/api/users/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      }),
    remove: (id: string) => request(`/api/users/${id}`, { method: 'DELETE' }),
    getSites: (id: string) =>
      request<{ sites: Site[]; siteIds: string[] }>(`/api/users/${id}/sites`),
    setSites: (id: string, siteIds: string[]) =>
      request<{ success: boolean; siteIds: string[] }>(`/api/users/${id}/sites`, {
        method: 'PUT',
        body: JSON.stringify({ siteIds }),
      }),
  },

  billing: {
    status: () =>
      request<{
        organization: Organization & { stripeCustomerId?: string | null };
        configured: boolean;
        quotas: Record<string, number | null>;
        usage: Record<string, number>;
      }>('/api/billing/status'),
    checkout: () => request<{ url: string }>('/api/billing/checkout', { method: 'POST' }),
    portal: () => request<{ url: string }>('/api/billing/portal', { method: 'POST' }),
  },

  integrations: {
    catalog: () =>
      request<{
        publicApi: { baseUrl: string; docs: string; openapi: string; scopes: PublicApiScope[] };
        webhooks: { events: string[]; signatureHeader: string };
      }>('/api/integrations/catalog'),
    apiKeys: () =>
      request<{ keys: PublicApiKey[]; scopes: PublicApiScope[] }>('/api/integrations/api-keys'),
    createApiKey: (data: { name: string; scopes?: PublicApiScope[]; expiresAt?: string | null }) =>
      request<{ key: PublicApiKey; token: string }>('/api/integrations/api-keys', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    revokeApiKey: (id: string) =>
      request<{ key: PublicApiKey }>(`/api/integrations/api-keys/${id}/revoke`, { method: 'POST' }),
    webhooks: () =>
      request<{ endpoints: WebhookEndpoint[]; events: string[] }>('/api/integrations/webhooks'),
    createWebhook: (data: { name: string; url: string; events?: string[] }) =>
      request<{ endpoint: WebhookEndpoint; secret: string }>('/api/integrations/webhooks', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    updateWebhook: (
      id: string,
      data: Partial<Pick<WebhookEndpoint, 'name' | 'url' | 'events' | 'status'>>,
    ) =>
      request<{ endpoint: WebhookEndpoint }>(`/api/integrations/webhooks/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      }),
    removeWebhook: (id: string) =>
      request(`/api/integrations/webhooks/${id}`, { method: 'DELETE' }),
    testWebhook: (id: string) =>
      request<{ delivery: { id: string; status: 'SENT' | 'FAILED' } }>(
        `/api/integrations/webhooks/${id}/test`,
        { method: 'POST' },
      ),
    webhookDeliveries: (id: string) =>
      request<{ deliveries: WebhookDelivery[] }>(`/api/integrations/webhooks/${id}/deliveries`),
  },

  // ─── Sites ───────────────────────────────────────────────
  sites: {
    list: () => request<{ sites: Site[] }>('/api/sites'),
    get: (id: string) => request<{ site: Site }>(`/api/sites/${id}`),
    create: (data: Partial<Site>) =>
      request<{ site: Site }>('/api/sites', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: string, data: Partial<Site>) =>
      request<{ site: Site }>(`/api/sites/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
    remove: (id: string) => request(`/api/sites/${id}`, { method: 'DELETE' }),
  },

  // ─── Diagrams ────────────────────────────────────────────
  diagrams: {
    list: (siteId?: string) =>
      request<{ diagrams: Diagram[] }>('/api/diagrams' + (siteId ? `?siteId=${siteId}` : '')),
    get: (id: string) => request<{ diagram: Diagram }>(`/api/diagrams/${id}`),
    create: (data: Partial<Diagram>) =>
      request<{ diagram: Diagram }>('/api/diagrams', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    update: (id: string, data: Partial<Diagram> & { expectedVersion?: number }) =>
      request<{ diagram: Diagram }>(`/api/diagrams/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),
    remove: (id: string) => request(`/api/diagrams/${id}`, { method: 'DELETE' }),
    history: (id: string) => request<{ history: any[] }>(`/api/diagrams/${id}/history`),
    restore: (id: string, versionId: string) =>
      request<{ diagram: Diagram }>(`/api/diagrams/${id}/restore/${versionId}`, { method: 'POST' }),
    comments: {
      list: (id: string) => request<{ comments: DiagramComment[] }>(`/api/diagrams/${id}/comments`),
      create: (
        id: string,
        data: Pick<DiagramComment, 'body'> & { x?: number | null; y?: number | null },
      ) =>
        request<{ comment: DiagramComment }>(`/api/diagrams/${id}/comments`, {
          method: 'POST',
          body: JSON.stringify(data),
        }),
      update: (
        id: string,
        commentId: string,
        data: Partial<Pick<DiagramComment, 'body' | 'resolved'>>,
      ) =>
        request<{ comment: DiagramComment }>(`/api/diagrams/${id}/comments/${commentId}`, {
          method: 'PATCH',
          body: JSON.stringify(data),
        }),
      remove: (id: string, commentId: string) =>
        request(`/api/diagrams/${id}/comments/${commentId}`, { method: 'DELETE' }),
    },
  },

  // ─── Devices ─────────────────────────────────────────────
  devices: {
    list: (params?: { siteId?: string; type?: string; status?: string; search?: string }) => {
      const q = new URLSearchParams();
      if (params?.siteId) q.set('siteId', params.siteId);
      if (params?.type) q.set('type', params.type);
      if (params?.status) q.set('status', params.status);
      if (params?.search) q.set('search', params.search);
      const qs = q.toString();
      return request<{ devices: Device[] }>(`/api/devices${qs ? `?${qs}` : ''}`);
    },
    get: (id: string) => request<{ device: Device }>(`/api/devices/${id}`),
    create: (data: Partial<Device>) =>
      request<{ device: Device }>('/api/devices', { method: 'POST', body: JSON.stringify(data) }),
    import: (file: File) => {
      const fd = new FormData();
      fd.append('file', file);
      return request<{
        created: number;
        skipped: number;
        errors: Array<{ row: number; message: string }>;
      }>('/api/devices/import', {
        method: 'POST',
        body: fd,
      });
    },
    update: (id: string, data: Partial<Device>) =>
      request<{ device: Device }>(`/api/devices/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),
    remove: (id: string) => request(`/api/devices/${id}`, { method: 'DELETE' }),
    stats: (siteId?: string) =>
      request<{
        total: number;
        byType: { type: string; _count: number }[];
        byStatus: { status: string; _count: number }[];
        sitesCount: number;
        diagramsCount: number;
        warnings: Pick<Device, 'id' | 'name' | 'type' | 'status' | 'siteId'>[];
      }>('/api/devices/stats/overview' + (siteId ? `?siteId=${siteId}` : '')),
  },

  sourceOfTruth: {
    dependencies: {
      list: (params?: {
        search?: string;
        type?: ApplicationDependencyType;
        criticality?: Criticality;
      }) => {
        const q = new URLSearchParams();
        if (params?.search) q.set('search', params.search);
        if (params?.type) q.set('type', params.type);
        if (params?.criticality) q.set('criticality', params.criticality);
        const qs = q.toString();
        return request<{ dependencies: ApplicationDependency[] }>(
          `/api/source-of-truth/dependencies${qs ? `?${qs}` : ''}`,
        );
      },
      create: (data: Partial<ApplicationDependency>) =>
        request<{ dependency: ApplicationDependency }>('/api/source-of-truth/dependencies', {
          method: 'POST',
          body: JSON.stringify(data),
        }),
      update: (id: string, data: Partial<ApplicationDependency>) =>
        request<{ dependency: ApplicationDependency }>(`/api/source-of-truth/dependencies/${id}`, {
          method: 'PATCH',
          body: JSON.stringify(data),
        }),
      remove: (id: string) =>
        request(`/api/source-of-truth/dependencies/${id}`, { method: 'DELETE' }),
    },
    contracts: {
      list: (params?: {
        search?: string;
        type?: AssetContractType;
        status?: AssetContractStatus;
      }) => {
        const q = new URLSearchParams();
        if (params?.search) q.set('search', params.search);
        if (params?.type) q.set('type', params.type);
        if (params?.status) q.set('status', params.status);
        const qs = q.toString();
        return request<{ contracts: AssetContract[] }>(
          `/api/source-of-truth/contracts${qs ? `?${qs}` : ''}`,
        );
      },
      create: (data: Partial<AssetContract>) =>
        request<{ contract: AssetContract }>('/api/source-of-truth/contracts', {
          method: 'POST',
          body: JSON.stringify(data),
        }),
      update: (id: string, data: Partial<AssetContract>) =>
        request<{ contract: AssetContract }>(`/api/source-of-truth/contracts/${id}`, {
          method: 'PATCH',
          body: JSON.stringify(data),
        }),
      remove: (id: string) => request(`/api/source-of-truth/contracts/${id}`, { method: 'DELETE' }),
    },
    customFields: {
      list: (target?: CustomFieldTarget) =>
        request<{ fields: CustomFieldDefinition[] }>(
          `/api/source-of-truth/custom-fields${target ? `?target=${target}` : ''}`,
        ),
      create: (data: Partial<CustomFieldDefinition>) =>
        request<{ field: CustomFieldDefinition }>('/api/source-of-truth/custom-fields', {
          method: 'POST',
          body: JSON.stringify(data),
        }),
      update: (id: string, data: Partial<CustomFieldDefinition>) =>
        request<{ field: CustomFieldDefinition }>(`/api/source-of-truth/custom-fields/${id}`, {
          method: 'PATCH',
          body: JSON.stringify(data),
        }),
      remove: (id: string) =>
        request(`/api/source-of-truth/custom-fields/${id}`, { method: 'DELETE' }),
    },
    tags: {
      list: () => request<{ tags: TagDefinition[] }>('/api/source-of-truth/tags'),
      create: (data: Partial<TagDefinition>) =>
        request<{ tag: TagDefinition }>('/api/source-of-truth/tags', {
          method: 'POST',
          body: JSON.stringify(data),
        }),
      update: (id: string, data: Partial<TagDefinition>) =>
        request<{ tag: TagDefinition }>(`/api/source-of-truth/tags/${id}`, {
          method: 'PATCH',
          body: JSON.stringify(data),
        }),
      remove: (id: string) => request(`/api/source-of-truth/tags/${id}`, { method: 'DELETE' }),
    },
    savedViews: {
      list: (target?: SavedViewTarget) =>
        request<{ views: SavedView[] }>(
          `/api/source-of-truth/saved-views${target ? `?target=${target}` : ''}`,
        ),
      create: (data: Partial<SavedView>) =>
        request<{ view: SavedView }>('/api/source-of-truth/saved-views', {
          method: 'POST',
          body: JSON.stringify(data),
        }),
      update: (id: string, data: Partial<SavedView>) =>
        request<{ view: SavedView }>(`/api/source-of-truth/saved-views/${id}`, {
          method: 'PATCH',
          body: JSON.stringify(data),
        }),
      remove: (id: string) =>
        request(`/api/source-of-truth/saved-views/${id}`, { method: 'DELETE' }),
    },
  },

  comments: {
    list: (targetType: EntityCommentTarget, targetId: string) => {
      const q = new URLSearchParams({ targetType, targetId });
      return request<{ comments: EntityComment[] }>(`/api/comments?${q}`);
    },
    create: (data: { targetType: EntityCommentTarget; targetId: string; body: string }) =>
      request<{ comment: EntityComment }>('/api/comments', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    update: (id: string, data: Partial<Pick<EntityComment, 'body' | 'resolved'>>) =>
      request<{ comment: EntityComment }>(`/api/comments/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      }),
    remove: (id: string) => request(`/api/comments/${id}`, { method: 'DELETE' }),
  },

  notifications: {
    list: () =>
      request<{
        notifications: Array<{
          id: string;
          type: string;
          title: string;
          body?: string | null;
          target?: string | null;
          targetId?: string | null;
          readAt?: string | null;
          createdAt: string;
        }>;
        unread: number;
      }>('/api/notifications'),
    markRead: (id: string) => request(`/api/notifications/${id}/read`, { method: 'POST' }),
    markAllRead: () => request('/api/notifications/read-all', { method: 'POST' }),
  },

  integrationCredentials: {
    list: () =>
      request<{
        credentials: Array<{
          id: string;
          name: string;
          provider: string;
          metadata?: Record<string, string>;
          updatedAt: string;
        }>;
        configured: boolean;
      }>('/api/integrations/credentials'),
    create: (data: {
      name: string;
      provider: string;
      secret: Record<string, string>;
      metadata?: Record<string, string>;
    }) => request('/api/integrations/credentials', { method: 'POST', body: JSON.stringify(data) }),
    remove: (id: string) => request(`/api/integrations/credentials/${id}`, { method: 'DELETE' }),
  },

  // ─── Ports ───────────────────────────────────────────────
  ports: {
    listByDevice: (deviceId: string) =>
      request<{ ports: Device['ports'] }>(`/api/devices/${deviceId}/ports`),
    create: (deviceId: string, data: any) =>
      request(`/api/devices/${deviceId}/ports`, { method: 'POST', body: JSON.stringify(data) }),
    update: (portId: string, data: any) =>
      request(`/api/ports/${portId}`, { method: 'PATCH', body: JSON.stringify(data) }),
    remove: (portId: string) => request(`/api/ports/${portId}`, { method: 'DELETE' }),
  },

  // ─── Images & attachments ────────────────────────────────
  media: {
    uploadImage: (deviceId: string, file: File) => {
      const fd = new FormData();
      fd.append('file', file);
      return request<{ image: any }>(`/api/devices/${deviceId}/images`, {
        method: 'POST',
        body: fd,
      });
    },
    updateImage: (imageId: string, data: any) =>
      request(`/api/images/${imageId}`, { method: 'PATCH', body: JSON.stringify(data) }),
    removeImage: (imageId: string) => request(`/api/images/${imageId}`, { method: 'DELETE' }),
    uploadAttachment: (deviceId: string, file: File) => {
      const fd = new FormData();
      fd.append('file', file);
      return request<{ attachment: any }>(`/api/devices/${deviceId}/attachments`, {
        method: 'POST',
        body: fd,
      });
    },
    removeAttachment: (id: string) => request(`/api/attachments/${id}`, { method: 'DELETE' }),
  },

  // ─── Racks ───────────────────────────────────────────────
  racks: {
    list: (siteId?: string) =>
      request<{ racks: Rack[] }>('/api/racks' + (siteId ? `?siteId=${siteId}` : '')),
    get: (id: string) => request<{ rack: Rack }>(`/api/racks/${id}`),
    create: (data: Partial<Rack>) =>
      request<{ rack: Rack }>('/api/racks', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: string, data: Partial<Rack>) =>
      request<{ rack: Rack }>(`/api/racks/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
    remove: (id: string) => request(`/api/racks/${id}`, { method: 'DELETE' }),
    addSlot: (rackId: string, data: { deviceId: string; startUnit: number; units: number }) =>
      request(`/api/racks/${rackId}/slots`, { method: 'POST', body: JSON.stringify(data) }),
    removeSlot: (slotId: string) => request(`/api/racks/slots/${slotId}`, { method: 'DELETE' }),
  },

  // ─── IPAM / VLAN ────────────────────────────────────────
  ipam: {
    vrfs: {
      list: (siteId?: string) =>
        request<{ vrfs: Vrf[] }>('/api/ipam/vrfs' + (siteId ? `?siteId=${siteId}` : '')),
      create: (data: Partial<Vrf>) =>
        request<{ vrf: Vrf }>('/api/ipam/vrfs', { method: 'POST', body: JSON.stringify(data) }),
      update: (id: string, data: Partial<Vrf>) =>
        request<{ vrf: Vrf }>(`/api/ipam/vrfs/${id}`, {
          method: 'PATCH',
          body: JSON.stringify(data),
        }),
      remove: (id: string) => request(`/api/ipam/vrfs/${id}`, { method: 'DELETE' }),
    },
    vlans: {
      list: (siteId?: string) =>
        request<{ vlans: Vlan[] }>('/api/ipam/vlans' + (siteId ? `?siteId=${siteId}` : '')),
      create: (data: Partial<Vlan>) =>
        request<{ vlan: Vlan }>('/api/ipam/vlans', { method: 'POST', body: JSON.stringify(data) }),
      update: (id: string, data: Partial<Vlan>) =>
        request<{ vlan: Vlan }>(`/api/ipam/vlans/${id}`, {
          method: 'PATCH',
          body: JSON.stringify(data),
        }),
      remove: (id: string) => request(`/api/ipam/vlans/${id}`, { method: 'DELETE' }),
    },
    prefixes: {
      list: (params?: { siteId?: string; vlanId?: string; vrfId?: string }) => {
        const q = new URLSearchParams();
        if (params?.siteId) q.set('siteId', params.siteId);
        if (params?.vlanId) q.set('vlanId', params.vlanId);
        if (params?.vrfId) q.set('vrfId', params.vrfId);
        const qs = q.toString();
        return request<{ prefixes: IpPrefix[] }>(`/api/ipam/prefixes${qs ? `?${qs}` : ''}`);
      },
      create: (data: Partial<IpPrefix>) =>
        request<{ prefix: IpPrefix }>('/api/ipam/prefixes', {
          method: 'POST',
          body: JSON.stringify(data),
        }),
      update: (id: string, data: Partial<IpPrefix>) =>
        request<{ prefix: IpPrefix }>(`/api/ipam/prefixes/${id}`, {
          method: 'PATCH',
          body: JSON.stringify(data),
        }),
      remove: (id: string) => request(`/api/ipam/prefixes/${id}`, { method: 'DELETE' }),
    },
    addresses: {
      list: (params?: {
        siteId?: string;
        prefixId?: string;
        status?: IpAddressStatus;
        search?: string;
      }) => {
        const q = new URLSearchParams();
        if (params?.siteId) q.set('siteId', params.siteId);
        if (params?.prefixId) q.set('prefixId', params.prefixId);
        if (params?.status) q.set('status', params.status);
        if (params?.search) q.set('search', params.search);
        const qs = q.toString();
        return request<{ addresses: IpAddress[] }>(`/api/ipam/addresses${qs ? `?${qs}` : ''}`);
      },
      create: (data: Partial<IpAddress>) =>
        request<{ address: IpAddress }>('/api/ipam/addresses', {
          method: 'POST',
          body: JSON.stringify(data),
        }),
      update: (id: string, data: Partial<IpAddress>) =>
        request<{ address: IpAddress }>(`/api/ipam/addresses/${id}`, {
          method: 'PATCH',
          body: JSON.stringify(data),
        }),
      remove: (id: string) => request(`/api/ipam/addresses/${id}`, { method: 'DELETE' }),
    },
  },

  dcim: {
    providers: {
      list: () => request<{ providers: Provider[] }>('/api/dcim/providers'),
      create: (data: Partial<Provider>) =>
        request<{ provider: Provider }>('/api/dcim/providers', {
          method: 'POST',
          body: JSON.stringify(data),
        }),
      update: (id: string, data: Partial<Provider>) =>
        request<{ provider: Provider }>(`/api/dcim/providers/${id}`, {
          method: 'PATCH',
          body: JSON.stringify(data),
        }),
      remove: (id: string) => request(`/api/dcim/providers/${id}`, { method: 'DELETE' }),
    },
    circuits: {
      list: (params?: { siteId?: string; providerId?: string; status?: string }) => {
        const q = new URLSearchParams();
        if (params?.siteId) q.set('siteId', params.siteId);
        if (params?.providerId) q.set('providerId', params.providerId);
        if (params?.status) q.set('status', params.status);
        const qs = q.toString();
        return request<{ circuits: Circuit[] }>(`/api/dcim/circuits${qs ? `?${qs}` : ''}`);
      },
      create: (data: Partial<Circuit>) =>
        request<{ circuit: Circuit }>('/api/dcim/circuits', {
          method: 'POST',
          body: JSON.stringify(data),
        }),
      update: (id: string, data: Partial<Circuit>) =>
        request<{ circuit: Circuit }>(`/api/dcim/circuits/${id}`, {
          method: 'PATCH',
          body: JSON.stringify(data),
        }),
      remove: (id: string) => request(`/api/dcim/circuits/${id}`, { method: 'DELETE' }),
    },
    patchPanels: {
      list: (params?: { siteId?: string; rackId?: string }) => {
        const q = new URLSearchParams();
        if (params?.siteId) q.set('siteId', params.siteId);
        if (params?.rackId) q.set('rackId', params.rackId);
        const qs = q.toString();
        return request<{ patchPanels: PatchPanel[] }>(
          `/api/dcim/patch-panels${qs ? `?${qs}` : ''}`,
        );
      },
      create: (data: Partial<PatchPanel>) =>
        request<{ patchPanel: PatchPanel }>('/api/dcim/patch-panels', {
          method: 'POST',
          body: JSON.stringify(data),
        }),
      update: (id: string, data: Partial<PatchPanel>) =>
        request<{ patchPanel: PatchPanel }>(`/api/dcim/patch-panels/${id}`, {
          method: 'PATCH',
          body: JSON.stringify(data),
        }),
      remove: (id: string) => request(`/api/dcim/patch-panels/${id}`, { method: 'DELETE' }),
    },
    cables: {
      list: (params?: { siteId?: string }) => {
        const q = new URLSearchParams();
        if (params?.siteId) q.set('siteId', params.siteId);
        const qs = q.toString();
        return request<{ cables: Cable[] }>(`/api/dcim/cables${qs ? `?${qs}` : ''}`);
      },
      create: (data: Partial<Cable>) =>
        request<{ cable: Cable }>('/api/dcim/cables', {
          method: 'POST',
          body: JSON.stringify(data),
        }),
      update: (id: string, data: Partial<Cable>) =>
        request<{ cable: Cable }>(`/api/dcim/cables/${id}`, {
          method: 'PATCH',
          body: JSON.stringify(data),
        }),
      remove: (id: string) => request(`/api/dcim/cables/${id}`, { method: 'DELETE' }),
    },
  },

  discovery: {
    import: (data: {
      format: DiscoveryFormat;
      content: string;
      siteId?: string | null;
      diagramId?: string | null;
      diagramName?: string | null;
      localDevice?: string | null;
      applyMode?: 'APPLY' | 'PROPOSE';
    }) =>
      request<DiscoveryImportResult & { proposal?: { id: string }; pendingApproval?: boolean }>(
        '/api/discovery/import',
        {
          method: 'POST',
          body: JSON.stringify(data),
        },
      ),
    scan: (data: {
      cidr: string;
      ports?: number[];
      timeoutMs?: number;
      siteId?: string | null;
      diagramId?: string | null;
      diagramName?: string | null;
    }) =>
      request<DiscoveryImportResult>('/api/discovery/scan', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    proposals: () => request<{ proposals: any[] }>('/api/discovery/proposals?status=PENDING'),
    reviewProposal: (id: string, decision: 'APPROVE' | 'REJECT', note?: string) =>
      request(`/api/discovery/proposals/${id}/review`, {
        method: 'POST',
        body: JSON.stringify({ decision, note }),
      }),
  },

  collectors: {
    list: (params?: { siteId?: string }) => {
      const q = new URLSearchParams();
      if (params?.siteId) q.set('siteId', params.siteId);
      const qs = q.toString();
      return request<{ collectors: DiscoveryCollector[] }>(`/api/collectors${qs ? `?${qs}` : ''}`);
    },
    create: (data: {
      name: string;
      siteId?: string | null;
      defaultCidrs?: string[];
      defaultPorts?: number[];
      autoDiagram?: boolean;
      role?: DiscoveryCollector['role'];
      priority?: number;
      failoverAfterMinutes?: number;
      tokenRotationDays?: number | null;
      tokenExpiresAt?: string | null;
      notes?: string | null;
    }) =>
      request<{ collector: DiscoveryCollector; token: string }>('/api/collectors', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    update: (
      id: string,
      data: Partial<
        Pick<
          DiscoveryCollector,
          | 'name'
          | 'siteId'
          | 'defaultCidrs'
          | 'defaultPorts'
          | 'autoDiagram'
          | 'status'
          | 'role'
          | 'priority'
          | 'failoverAfterMinutes'
          | 'tokenRotationDays'
          | 'tokenExpiresAt'
          | 'notes'
        >
      >,
    ) =>
      request<{ collector: DiscoveryCollector }>(`/api/collectors/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      }),
    rotateToken: (
      id: string,
      data?: { tokenRotationDays?: number | null; tokenExpiresAt?: string | null },
    ) =>
      request<{ collector: DiscoveryCollector; token: string }>(
        `/api/collectors/${id}/rotate-token`,
        {
          method: 'POST',
          body: JSON.stringify(data ?? {}),
        },
      ),
    revoke: (id: string) => request(`/api/collectors/${id}`, { method: 'DELETE' }),
    downloads: () =>
      request<{
        version: string;
        files: Array<{
          platform: string;
          label: string;
          file: string;
          size: number;
          updatedAt: string;
        }>;
      }>('/api/collectors/downloads'),
  },

  alerts: {
    list: (params?: {
      status?: 'open' | 'acknowledged' | 'all';
      severity?: DiscoveryEventSeverity;
      type?: DiscoveryEventType;
      siteId?: string;
      limit?: number;
    }) => {
      const q = new URLSearchParams();
      if (params?.status) q.set('status', params.status);
      if (params?.severity) q.set('severity', params.severity);
      if (params?.type) q.set('type', params.type);
      if (params?.siteId) q.set('siteId', params.siteId);
      if (params?.limit) q.set('limit', String(params.limit));
      const qs = q.toString();
      return request<{
        alerts: DiscoveryEvent[];
        counts: { open: number; critical: number; warning: number; info: number };
      }>(`/api/alerts${qs ? `?${qs}` : ''}`);
    },
    settings: () => request<{ settings: AlertSettings }>('/api/alerts/settings'),
    updateSettings: (
      data: Pick<
        AlertSettings,
        | 'emailEnabled'
        | 'emailRecipients'
        | 'webhookEnabled'
        | 'webhookUrl'
        | 'slackEnabled'
        | 'slackWebhookUrl'
        | 'teamsEnabled'
        | 'teamsWebhookUrl'
        | 'minSeverity'
        | 'eventTypes'
        | 'includeResolvedInfo'
      >,
    ) =>
      request<{ settings: AlertSettings }>('/api/alerts/settings', {
        method: 'PUT',
        body: JSON.stringify(data),
      }),
    acknowledge: (id: string) =>
      request<{ alert: DiscoveryEvent }>(`/api/alerts/${id}/acknowledge`, { method: 'POST' }),
  },

  monitoring: {
    policy: () => request<{ policy: MonitoringPolicy }>('/api/monitoring/policy'),
    updatePolicy: (
      data: Pick<
        MonitoringPolicy,
        | 'availabilityTargetPct'
        | 'latencyWarningMs'
        | 'latencyCriticalMs'
        | 'latencyAlertsEnabled'
        | 'measurementRetentionDays'
        | 'incidentAutoResolve'
      >,
    ) =>
      request<{ policy: MonitoringPolicy }>('/api/monitoring/policy', {
        method: 'PUT',
        body: JSON.stringify(data),
      }),
    availability: (params?: { siteId?: string; deviceId?: string; days?: number }) => {
      const q = new URLSearchParams();
      if (params?.siteId) q.set('siteId', params.siteId);
      if (params?.deviceId) q.set('deviceId', params.deviceId);
      if (params?.days) q.set('days', String(params.days));
      const qs = q.toString();
      return request<{
        summary: AvailabilitySummary;
        devices: Array<{
          device: { id: string; name: string; type: string; ip?: string | null };
          site?: Pick<Site, 'id' | 'name'> | null;
          summary: AvailabilitySummary;
        }>;
        samples: Array<{
          id: string;
          status: string;
          latencyMs?: number | null;
          checkedAt: string;
        }>;
      }>(`/api/monitoring/availability${qs ? `?${qs}` : ''}`);
    },
    maintenance: () => request<{ windows: MaintenanceWindow[] }>('/api/monitoring/maintenance'),
    createMaintenance: (
      data: Pick<
        MaintenanceWindow,
        'title' | 'siteId' | 'deviceId' | 'startsAt' | 'endsAt' | 'notes'
      >,
    ) =>
      request<{ window: MaintenanceWindow }>('/api/monitoring/maintenance', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    removeMaintenance: (id: string) =>
      request(`/api/monitoring/maintenance/${id}`, { method: 'DELETE' }),
    incidents: (params?: {
      status?: IncidentStatus;
      severity?: DiscoveryEventSeverity;
      siteId?: string;
    }) => {
      const q = new URLSearchParams();
      if (params?.status) q.set('status', params.status);
      if (params?.severity) q.set('severity', params.severity);
      if (params?.siteId) q.set('siteId', params.siteId);
      const qs = q.toString();
      return request<{ incidents: Incident[] }>(`/api/monitoring/incidents${qs ? `?${qs}` : ''}`);
    },
    updateIncident: (id: string, data: { status: IncidentStatus; notes?: string | null }) =>
      request<{ incident: Incident }>(`/api/monitoring/incidents/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      }),
  },

  security: {
    summary: (params?: { siteId?: string }) => {
      const q = new URLSearchParams();
      if (params?.siteId) q.set('siteId', params.siteId);
      const qs = q.toString();
      return request<SecuritySummary>(`/api/security/summary${qs ? `?${qs}` : ''}`);
    },
    policy: () => request<{ policy: SecurityPolicy }>('/api/security/policy'),
    updatePolicy: (
      data: Partial<
        Pick<
          SecurityPolicy,
          | 'requireDeviceSite'
          | 'requireDeviceOwner'
          | 'riskyPorts'
          | 'criticalPorts'
          | 'weakSnmpCommunities'
          | 'firmwareUnknownDays'
          | 'warrantyWarningDays'
          | 'collectorTokenMaxAgeDays'
        >
      >,
    ) =>
      request<{ policy: SecurityPolicy }>('/api/security/policy', {
        method: 'PATCH',
        body: JSON.stringify(data),
      }),
    audit: (params?: { limit?: number; action?: string; target?: string }) => {
      const q = new URLSearchParams();
      if (params?.limit) q.set('limit', String(params.limit));
      if (params?.action) q.set('action', params.action);
      if (params?.target) q.set('target', params.target);
      const qs = q.toString();
      return request<{ logs: AuditLog[] }>(`/api/security/audit${qs ? `?${qs}` : ''}`);
    },
  },

  reports: {
    schedules: () => request<{ schedules: ReportSchedule[] }>('/api/reports/schedules'),
    createSchedule: (data: {
      name: string;
      type: ReportType;
      format: ReportFormat;
      frequency: ReportFrequency;
      recipients: string[];
      siteId?: string | null;
      active: boolean;
      timezone: string;
      scheduledHour: number;
      scheduledMinute: number;
      scheduledWeekday?: number | null;
      scheduledMonthDay?: number | null;
      startAt?: string | null;
    }) =>
      request<{ schedule: ReportSchedule }>('/api/reports/schedules', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    updateSchedule: (
      id: string,
      data: Partial<{
        name: string;
        type: ReportType;
        format: ReportFormat;
        frequency: ReportFrequency;
        recipients: string[];
        siteId: string | null;
        active: boolean;
        timezone: string;
        scheduledHour: number;
        scheduledMinute: number;
        scheduledWeekday: number | null;
        scheduledMonthDay: number | null;
        startAt: string | null;
      }>,
    ) =>
      request<{ schedule: ReportSchedule }>(`/api/reports/schedules/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      }),
    removeSchedule: (id: string) => request(`/api/reports/schedules/${id}`, { method: 'DELETE' }),
    testSchedule: (id: string) =>
      request<{ success: boolean; delivered: boolean; recipients: string[]; message: string }>(
        `/api/reports/schedules/${id}/test`,
        {
          method: 'POST',
          body: JSON.stringify({}),
        },
      ),
  },
};
