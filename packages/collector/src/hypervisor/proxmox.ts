/**
 * Proxmox VE discovery for Orbis.
 *
 * Uses the Proxmox REST API (no SDK required).
 *
 * Environment variables:
 *   PROXMOX_HOST          — host[:port] of the Proxmox API (required)
 *   PROXMOX_USER          — realm user, default `root@pam`
 *   PROXMOX_TOKEN_NAME    — API token name (preferred auth)
 *   PROXMOX_TOKEN_SECRET  — API token secret
 *   PROXMOX_PASSWORD      — password auth (used only when no API token)
 *   PROXMOX_VERIFY_TLS    — `false` (default) to accept self-signed certs
 *
 * Returns [] (with a warning) when PROXMOX_HOST is missing or auth fails.
 */
import { httpRequest, normalizeBaseUrl } from './http.js';

export type DiscoveredVirtualHost = {
  address: string;
  name: string;
  resourceId: string;
  provider: 'VIRTUAL';
  platform: 'proxmox';
  metadata: {
    node: string;
    vmid: string;
    type: string;
    status: string;
  };
};

type ProxmoxResource = {
  node?: string;
  id?: string;
  name?: string;
  type?: string;
  vmid?: number;
  status?: string;
  netin?: number;
  netout?: number;
};

type ProxmoxApiResponse<T> = { data?: T };

type ProxmoxInterfaceEntry = {
  'ip-addresses'?: { 'ip-address'?: string; 'ip-address-type'?: string }[];
};

function env(name: string): string | undefined {
  const value = process.env[name];
  return value && value.trim() ? value.trim() : undefined;
}

function authHeaders(config: Required<Pick<ProxmoxConfig, 'user' | 'tokenName' | 'tokenSecret'>> & { useToken: boolean }, ticket: string | null): Record<string, string> {
  if (config.useToken) {
    return { Authorization: `PVEAPIToken=${config.user}!${config.tokenName}=${config.tokenSecret}` };
  }
  return ticket ? { Cookie: `PVEAuthCookie=${ticket}` } : {};
}

type ProxmoxConfig = {
  host: string;
  user: string;
  tokenName: string;
  tokenSecret: string;
  password: string;
  verifyTls: boolean;
  useToken: boolean;
};

function loadConfig(): ProxmoxConfig | null {
  const host = env('PROXMOX_HOST');
  if (!host) return null;
  const user = env('PROXMOX_USER') ?? 'root@pam';
  const tokenName = env('PROXMOX_TOKEN_NAME') ?? '';
  const tokenSecret = env('PROXMOX_TOKEN_SECRET') ?? '';
  const password = env('PROXMOX_PASSWORD') ?? '';
  const useToken = Boolean(tokenName && tokenSecret);
  if (!useToken && !password) {
    console.warn('[collector][proxmox] PROXMOX_HOST set but no API token or password provided, skipping Proxmox discovery');
    return null;
  }
  const verifyTls = env('PROXMOX_VERIFY_TLS')?.toLowerCase() !== 'false';
  return { host, user, tokenName, tokenSecret, password, verifyTls, useToken };
}

async function login(config: ProxmoxConfig): Promise<string | null> {
  if (config.useToken) return null;
  const base = normalizeBaseUrl(config.host, 8006);
  const response = await httpRequest<{ data: string | null }>(
    `${base}/api2/json/access/ticket`,
    'POST',
    `username=${encodeURIComponent(config.user)}&password=${encodeURIComponent(config.password)}`,
    { insecureTls: !config.verifyTls, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
  );
  return response?.data ?? null;
}

async function fetchInterfaces(
  config: ProxmoxConfig,
  ticket: string | null,
  node: string,
  type: string,
  vmid: number,
): Promise<string | null> {
  const base = normalizeBaseUrl(config.host, 8006);
  const endpoint = type === 'lxc' ? 'interfaces' : 'agent/network-get-interfaces';
  try {
    const response = await httpRequest<ProxmoxApiResponse<ProxmoxInterfaceEntry[] | { result?: ProxmoxInterfaceEntry[] }>>(
      `${base}/api2/json/nodes/${node}/${type}/${vmid}/${endpoint}`,
      'GET',
      undefined,
      { insecureTls: !config.verifyTls, headers: authHeaders({ user: config.user, tokenName: config.tokenName, tokenSecret: config.tokenSecret, useToken: config.useToken }, ticket) },
    );
    const data = response?.data;
    const entries: ProxmoxInterfaceEntry[] = Array.isArray(data)
      ? data
      : Array.isArray((data as { result?: ProxmoxInterfaceEntry[] } | null)?.result)
        ? (data as { result?: ProxmoxInterfaceEntry[] }).result ?? []
        : [];
    for (const entry of entries) {
      for (const ip of entry['ip-addresses'] ?? []) {
        if (ip['ip-address-type'] === 'ipv4' && ip['ip-address']) return ip['ip-address'];
      }
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Discover VMs/containers across all Proxmox nodes. Returns an empty array
 * (with a warning) when unconfigured or unreachable.
 */
export async function discoverProxmox(): Promise<DiscoveredVirtualHost[]> {
  const config = loadConfig();
  if (!config) return [];

  const base = normalizeBaseUrl(config.host, 8006);
  try {
    const ticket = await login(config);
    const response = await httpRequest<ProxmoxApiResponse<ProxmoxResource[]>>(
      `${base}/api2/json/cluster/resources?type=vm`,
      'GET',
      undefined,
      { insecureTls: !config.verifyTls, headers: authHeaders({ user: config.user, tokenName: config.tokenName, tokenSecret: config.tokenSecret, useToken: config.useToken }, ticket) },
    );
    const resources = response?.data ?? [];
    const hosts: DiscoveredVirtualHost[] = [];
    for (const resource of resources) {
      if (!resource || (resource.type !== 'qemu' && resource.type !== 'lxc')) continue;
      const vmid = String(resource.vmid ?? resource.id ?? '');
      const node = resource.node ?? '';
      const name = resource.name ?? vmid;
      let address = await fetchInterfaces(config, ticket, node, resource.type!, Number(resource.vmid));
      if (!address) continue;
      hosts.push({
        address,
        name,
        resourceId: resource.id ?? vmid,
        provider: 'VIRTUAL',
        platform: 'proxmox',
        metadata: { node, vmid, type: resource.type ?? 'qemu', status: resource.status ?? 'unknown' },
      });
    }
    console.log(`[collector][proxmox] discovered ${hosts.length} Proxmox guest(s)`);
    return hosts;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[collector][proxmox] discovery failed: ${message}`);
    return [];
  }
}
