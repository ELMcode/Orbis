/**
 * GCP Compute Engine discovery for Orbis.
 *
 * Environment variables:
 *   GOOGLE_APPLICATION_CREDENTIALS — path to a service account JSON key file.
 *   GCP_PROJECT_ID                 — project id to scan. If omitted, the
 *                                    project id is auto-detected from the
 *                                    service account JSON referenced by
 *                                    GOOGLE_APPLICATION_CREDENTIALS.
 *
 * Uses the @google-cloud/compute client's aggregatedList to enumerate
 * instances across every zone in the project. Returns [] (with a warning)
 * when no credentials/project are configured.
 */
import { readFile } from 'node:fs/promises';
import { InstancesClient } from '@google-cloud/compute';

export type DiscoveredCloudHost = {
  address: string;
  publicIp?: string | null;
  name?: string | null;
  resourceId: string;
  provider: 'GCP';
  platform: 'gce';
  metadata: {
    machineType?: string | null;
    zone?: string | null;
    status?: string | null;
    projectId?: string | null;
  };
};

function env(name: string): string | undefined {
  const value = process.env[name];
  return value && value.trim() ? value.trim() : undefined;
}

function lastSegment(value: string | null | undefined): string | null {
  if (!value) return null;
  return value.split('/').pop() || null;
}

function firstIpAddress(networkInterfaces: { accessConfigs?: { natIP?: string | null }[]; networkIP?: string | null }[] | undefined, nat: boolean): string | null {
  if (!networkInterfaces || networkInterfaces.length === 0) return null;
  for (const nic of networkInterfaces) {
    if (nat) {
      const natIp = nic.accessConfigs?.find((config) => config.natIP)?.natIP;
      if (natIp) return natIp;
    } else if (nic.networkIP) {
      return nic.networkIP;
    }
  }
  return null;
}

async function resolveProjectId(): Promise<string | null> {
  const explicit = env('GCP_PROJECT_ID');
  if (explicit) return explicit;
  const credsPath = env('GOOGLE_APPLICATION_CREDENTIALS');
  if (!credsPath) return null;
  try {
    const raw = JSON.parse(await readFile(credsPath, 'utf8'));
    if (typeof raw.project_id === 'string' && raw.project_id) return raw.project_id;
  } catch {
    // fall through — let the client surface the real error.
  }
  return null;
}

/**
 * Discover GCE instances across all zones in the project. Returns an empty
 * array (with a warning) when credentials/project are missing.
 */
export async function discoverGcpInstances(): Promise<DiscoveredCloudHost[]> {
  const projectId = await resolveProjectId();
  if (!projectId) {
    console.warn(
      '[collector][gcp] no GCP credentials/project configured (set GOOGLE_APPLICATION_CREDENTIALS and GCP_PROJECT_ID), skipping Compute Engine discovery',
    );
    return [];
  }

  const client = new InstancesClient({ projectId });
  try {
    const hosts: DiscoveredCloudHost[] = [];
    for await (const [zone, scopedList] of client.aggregatedListAsync({ project: projectId })) {
      for (const instance of scopedList.instances ?? []) {
        const interfaces = instance.networkInterfaces as
          | { accessConfigs?: { natIP?: string | null }[]; networkIP?: string | null }[]
          | undefined;
        const privateIp = firstIpAddress(interfaces, false);
        const publicIp = firstIpAddress(interfaces, true);
        const address = privateIp || publicIp;
        if (!address) continue;
        hosts.push({
          address,
          publicIp: publicIp ?? null,
          name: instance.name ?? null,
          resourceId: instance.selfLink ?? String(instance.id ?? instance.name ?? ''),
          provider: 'GCP',
          platform: 'gce',
          metadata: {
            machineType: lastSegment(instance.machineType),
            zone: lastSegment(zone) ?? lastSegment(instance.zone),
            status: instance.status ?? null,
            projectId,
          },
        });
      }
    }
    console.log(`[collector][gcp] discovered ${hosts.length} GCE instance(s)`);
    return hosts;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[collector][gcp] Compute Engine discovery failed: ${message}`);
    return [];
  } finally {
    await client.close().catch(() => undefined);
  }
}
