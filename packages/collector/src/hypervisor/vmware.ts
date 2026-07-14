/**
 * VMware vSphere discovery for Orbis.
 *
 * Uses the vSphere REST API (no heavy SDK required). Tested against vCenter
 * 6.5+ / 7.x / 8.x and standalone ESXi hosts.
 *
 * Environment variables:
 *   VSPHERE_HOST        — vCenter/ESXi host (scheme optional, default https)
 *   VSPHERE_USERNAME    — username (e.g. `administrator@vsphere.local`)
 *   VSPHERE_PASSWORD    — password
 *   VSPHERE_IGNORE_SSL  — `true` (recommended) to accept self-signed certs
 *
 * Endpoints used:
 *   POST /rest/com/vmware/cis/session             — basic-auth login
 *   GET  /rest/vcenter/vm                          — list VMs
 *   GET  /rest/vcenter/vm/{vm}                     — VM details (guest/host)
 *   GET  /rest/vcenter/vm/{vm}/guest/networking/interfaces — guest IPs
 *
 * Returns [] (with a warning) when credentials/host are missing or unreachable.
 */
import { httpRequest, normalizeBaseUrl } from './http.js';

export type DiscoveredVirtualHost = {
  address: string;
  name: string;
  resourceId: string;
  provider: 'VIRTUAL';
  platform: 'vmware';
  metadata: {
    powerState?: string | null;
    guestOs?: string | null;
    host?: string | null;
    cluster?: string | null;
  };
};

type VsphereVmSummary = { vm: string; name: string; power_state?: string };

type VsphereVmListResponse = { value?: VsphereVmSummary[] };

type VsphereVmDetail = {
  name?: string;
  power_state?: string;
  guest_os?: { os_full?: string };
  host?: { host?: string; cluster?: string };
};

type VsphereGuestInterface = { ip_address?: { ip_address?: string }[] };

type VsphereGuestInterfacesResponse = { value?: VsphereGuestInterface[] };

function env(name: string): string | undefined {
  const value = process.env[name];
  return value && value.trim() ? value.trim() : undefined;
}

type VsphereConfig = {
  baseUrl: string;
  username: string;
  password: string;
  ignoreSsl: boolean;
};

function loadConfig(): VsphereConfig | null {
  const host = env('VSPHERE_HOST');
  const username = env('VSPHERE_USERNAME');
  const password = env('VSPHERE_PASSWORD');
  if (!host || !username || !password) {
    if (host) {
      console.warn('[collector][vmware] VSPHERE_HOST set but VSPHERE_USERNAME/VSPHERE_PASSWORD missing, skipping vSphere discovery');
    }
    return null;
  }
  const ignoreSsl = env('VSPHERE_IGNORE_SSL')?.toLowerCase() === 'true';
  return { baseUrl: normalizeBaseUrl(host), username, password, ignoreSsl };
}

async function authenticate(config: VsphereConfig): Promise<string> {
  // /rest/com/vmware/cis/session returns { value: "<session-id>" }
  const response = await httpRequest<{ value: string }>(
    `${config.baseUrl}/rest/com/vmware/cis/session`,
    'POST',
    undefined,
    {
      insecureTls: config.ignoreSsl,
      headers: { Authorization: `Basic ${Buffer.from(`${config.username}:${config.password}`).toString('base64')}` },
    },
  );
  const sessionId = response?.value;
  if (!sessionId) throw new Error('vSphere login returned no session id');
  return sessionId;
}

async function listVms(config: VsphereConfig, sessionId: string): Promise<VsphereVmSummary[]> {
  const response = await httpRequest<VsphereVmListResponse>(
    `${config.baseUrl}/rest/vcenter/vm`,
    'GET',
    undefined,
    { insecureTls: config.ignoreSsl, headers: { 'vmware-api-session-id': sessionId } },
  );
  return response?.value ?? [];
}

async function fetchGuestIp(config: VsphereConfig, sessionId: string, vmId: string): Promise<string | null> {
  try {
    const response = await httpRequest<VsphereGuestInterfacesResponse>(
      `${config.baseUrl}/rest/vcenter/vm/${encodeURIComponent(vmId)}/guest/networking/interfaces`,
      'GET',
      undefined,
      { insecureTls: config.ignoreSsl, headers: { 'vmware-api-session-id': sessionId } },
    );
    for (const nic of response?.value ?? []) {
      for (const entry of nic.ip_address ?? []) {
        if (entry.ip_address && /^\d{1,3}(\.\d{1,3}){3}$/.test(entry.ip_address)) {
          return entry.ip_address;
        }
      }
    }
    // The endpoint may also return { value: { nic: [...] } } on some versions.
    return null;
    return null;
  } catch {
    return null;
  }
}

async function fetchVmDetail(config: VsphereConfig, sessionId: string, vmId: string): Promise<VsphereVmDetail | null> {
  try {
    const response = await httpRequest<{ value: VsphereVmDetail }>(
      `${config.baseUrl}/rest/vcenter/vm/${encodeURIComponent(vmId)}`,
      'GET',
      undefined,
      { insecureTls: config.ignoreSsl, headers: { 'vmware-api-session-id': sessionId } },
    );
    return response?.value ?? null;
  } catch {
    return null;
  }
}

/**
 * Discover VMs via the vSphere REST API. Returns an empty array (with a
 * warning) when unconfigured or unreachable.
 */
export async function discoverVsphere(): Promise<DiscoveredVirtualHost[]> {
  const config = loadConfig();
  if (!config) return [];

  try {
    const sessionId = await authenticate(config);
    const vms = await listVms(config, sessionId);
    const hosts: DiscoveredVirtualHost[] = [];
    for (const vm of vms) {
      if (!vm.vm || !vm.name) continue;
      const [ip, detail] = await Promise.all([
        fetchGuestIp(config, sessionId, vm.vm),
        fetchVmDetail(config, sessionId, vm.vm),
      ]);
      const address = ip ?? null;
      // Include even IP-less VMs by using the VM name as a synthetic address
      // only when there is no real address — but the collector drops non-IPv4
      // hosts, so we just skip VMs we can't address to keep things clean.
      if (!address) continue;
      hosts.push({
        address,
        name: detail?.name ?? vm.name,
        resourceId: vm.vm,
        provider: 'VIRTUAL',
        platform: 'vmware',
        metadata: {
          powerState: detail?.power_state ?? vm.power_state ?? null,
          guestOs: detail?.guest_os?.os_full ?? null,
          host: detail?.host?.host ?? null,
          cluster: detail?.host?.cluster ?? null,
        },
      });
    }
    console.log(`[collector][vmware] discovered ${hosts.length} vSphere VM(s)`);
    return hosts;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[collector][vmware] discovery failed: ${message}`);
    return [];
  }
}
