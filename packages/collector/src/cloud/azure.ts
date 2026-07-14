/**
 * Azure VM discovery for Orbis.
 *
 * Environment variables:
 *   AZURE_SUBSCRIPTION_ID   — subscription id to scan (required)
 *   AZURE_TENANT_ID         — AAD tenant id for the service principal (required)
 *   AZURE_CLIENT_ID         — service principal app id (required)
 *   AZURE_CLIENT_SECRET     — service principal secret (required)
 *
 * Uses ClientSecretCredential + ComputeManagementClient to enumerate VMs
 * across the subscription, and fetches network interfaces for private/public
 * IP details. Returns [] (with a warning) when credentials are missing.
 */
import {
  ComputeManagementClient,
  type NetworkInterfaceReference,
} from '@azure/arm-compute';
import {
  NetworkManagementClient,
  type NetworkInterface,
  type NetworkInterfaceIPConfiguration,
  type PublicIPAddress,
} from '@azure/arm-network';
import { ClientSecretCredential } from '@azure/identity';

export type DiscoveredCloudHost = {
  address: string;
  publicIp?: string | null;
  name?: string | null;
  resourceId: string;
  provider: 'AZURE';
  platform: 'azure-vm';
  metadata: {
    vmSize?: string | null;
    location?: string | null;
    resourceGroup?: string | null;
    powerState?: string | null;
    osType?: string | null;
  };
};

function env(name: string): string | undefined {
  const value = process.env[name];
  return value && value.trim() ? value.trim() : undefined;
}

function resourceGroupFromId(id: string): string | null {
  const match = id.match(/resourceGroups\/([^/]+)/i);
  return match ? match[1] : null;
}

function primaryNic(nics: NetworkInterfaceReference[] | undefined): NetworkInterfaceReference | undefined {
  return (
    (nics ?? []).find((nic) => nic.primary) ??
    (nics && nics.length > 0 ? nics[0] : undefined)
  );
}

async function fetchInterface(
  networkClient: NetworkManagementClient,
  nicRef: NetworkInterfaceReference,
): Promise<NetworkInterface | undefined> {
  const nicId = nicRef.id;
  if (!nicId) return undefined;
  const rg = resourceGroupFromId(nicId);
  const name = nicId.split('/').pop();
  if (!rg || !name) return undefined;
  try {
    return await networkClient.networkInterfaces.get(rg, name);
  } catch {
    return undefined;
  }
}

async function fetchPublicIp(
  networkClient: NetworkManagementClient,
  ipId: string | undefined,
): Promise<string | null> {
  if (!ipId) return null;
  const rg = resourceGroupFromId(ipId);
  const name = ipId.split('/').pop();
  if (!rg || !name) return null;
  try {
    const ip: PublicIPAddress = await networkClient.publicIPAddresses.get(rg, name);
    return ip.ipAddress ?? null;
  } catch {
    return null;
  }
}

/**
 * Discover Azure VMs in the configured subscription. Returns an empty array
 * (with a warning) when credentials are missing or the API cannot be reached.
 */
export async function discoverAzureVms(): Promise<DiscoveredCloudHost[]> {
  const subscriptionId = env('AZURE_SUBSCRIPTION_ID');
  const tenantId = env('AZURE_TENANT_ID');
  const clientId = env('AZURE_CLIENT_ID');
  const clientSecret = env('AZURE_CLIENT_SECRET');
  if (!subscriptionId || !tenantId || !clientId || !clientSecret) {
    console.warn(
      '[collector][azure] missing Azure credentials (set AZURE_SUBSCRIPTION_ID, AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET), skipping VM discovery',
    );
    return [];
  }

  const credential = new ClientSecretCredential(tenantId, clientId, clientSecret);
  const computeClient = new ComputeManagementClient(credential, subscriptionId);
  const networkClient = new NetworkManagementClient(credential, subscriptionId);

  try {
    const hosts: DiscoveredCloudHost[] = [];
    for await (const vm of computeClient.virtualMachines.listAll()) {
      const vmResourceId = vm.id ?? vm.name ?? '';
      const resourceGroup = resourceGroupFromId(vmResourceId);

      const nicRef = primaryNic(vm.networkProfile?.networkInterfaces);
      const networkInterface = nicRef ? await fetchInterface(networkClient, nicRef) : undefined;
      const ipConfigs: NetworkInterfaceIPConfiguration[] = networkInterface?.ipConfigurations ?? [];
      const primaryIpConfig = ipConfigs.find((config) => config.primary) ?? ipConfigs[0];
      const privateIp = primaryIpConfig?.privateIPAddress ?? null;
      const publicIp = await fetchPublicIp(networkClient, primaryIpConfig?.publicIPAddress?.id);

      const address = privateIp || publicIp;
      if (!address) continue;

      hosts.push({
        address,
        publicIp: publicIp ?? null,
        name: vm.name ?? null,
        resourceId: vmResourceId,
        provider: 'AZURE',
        platform: 'azure-vm',
        metadata: {
          vmSize: vm.hardwareProfile?.vmSize ?? null,
          location: vm.location ?? null,
          resourceGroup,
          powerState: vm.provisioningState ?? null,
          osType: vm.storageProfile?.osDisk?.osType ?? null,
        },
      });
    }
    console.log(`[collector][azure] discovered ${hosts.length} Azure VM(s)`);
    return hosts;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[collector][azure] VM discovery failed: ${message}`);
    return [];
  }
}
