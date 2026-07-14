/**
 * AWS EC2 discovery for Orbis.
 *
 * Environment variables:
 *   AWS_ACCESS_KEY_ID          — access key id (or rely on the SDK default chain)
 *   AWS_SECRET_ACCESS_KEY      — secret access key (or rely on the SDK default chain)
 *   AWS_SESSION_TOKEN          — optional temporary session token
 *   AWS_REGION                 — default region to scan
 *   AWS_DEFAULT_REGION         — fallback default region
 *   AWS_REGIONS                — optional comma-separated list of extra regions to scan
 *
 * If no credentials are configured the SDK default credential provider chain is
 * still used (env, shared config, ECS/EKS, IMDS…). Discovery only returns []
 * (with a warning) when the SDK cannot authenticate or the call fails.
 */
import { EC2Client, DescribeInstancesCommand, type Instance } from '@aws-sdk/client-ec2';

export type DiscoveredCloudHost = {
  address: string;
  publicIp?: string | null;
  name?: string | null;
  resourceId: string;
  provider: 'AWS';
  platform: 'ec2';
  metadata: {
    instanceType?: string | null;
    state?: string | null;
    vpcId?: string | null;
    subnetId?: string | null;
    region?: string | null;
    tags?: Record<string, string>;
  };
};

function env(name: string): string | undefined {
  const value = process.env[name];
  return value && value.trim() ? value.trim() : undefined;
}

function resolveRegions(): string[] {
  const primary = env('AWS_REGION') ?? env('AWS_DEFAULT_REGION');
  const extra = (env('AWS_REGIONS') ?? '')
    .split(',')
    .map((region) => region.trim())
    .filter(Boolean);
  const regions = [...new Set([primary, ...extra].filter((r): r is string => Boolean(r)))];
  return regions;
}

function instanceName(instance: Instance): string | null {
  const nameTag = instance.Tags?.find((tag) => tag.Key === 'Name');
  return nameTag?.Value || null;
}

function tagsToRecord(instance: Instance): Record<string, string> | undefined {
  if (!instance.Tags || instance.Tags.length === 0) return undefined;
  const record: Record<string, string> = {};
  for (const tag of instance.Tags) {
    if (tag.Key && tag.Value !== undefined) record[tag.Key] = tag.Value;
  }
  return Object.keys(record).length ? record : undefined;
}

async function discoverRegion(region: string): Promise<DiscoveredCloudHost[]> {
  const client = new EC2Client({ region });
  try {
    const hosts: DiscoveredCloudHost[] = [];
    let nextToken: string | undefined;
    do {
      const response = await client.send(
        new DescribeInstancesCommand({ NextToken: nextToken }),
      );
      for (const reservation of response.Reservations ?? []) {
        for (const instance of reservation.Instances ?? []) {
          const privateIp = instance.PrivateIpAddress ?? null;
          const publicIp = instance.PublicIpAddress ?? null;
          const address = privateIp || publicIp;
          if (!address) continue;
          hosts.push({
            address,
            publicIp: publicIp ?? null,
            name: instanceName(instance),
            resourceId: instance.InstanceId ?? address,
            provider: 'AWS',
            platform: 'ec2',
            metadata: {
              instanceType: instance.InstanceType ?? null,
              state: instance.State?.Name ?? null,
              vpcId: instance.VpcId ?? null,
              subnetId: instance.SubnetId ?? null,
              region,
              tags: tagsToRecord(instance),
            },
          });
        }
      }
      nextToken = response.NextToken;
    } while (nextToken);
    return hosts;
  } finally {
    client.destroy();
  }
}

/**
 * Discover running EC2 instances. Returns an empty array (and logs a warning)
 * when credentials are missing or the AWS API cannot be reached.
 */
export async function discoverAwsEc2(): Promise<DiscoveredCloudHost[]> {
  const regions = resolveRegions();
  if (regions.length === 0) {
    console.warn('[collector][aws] no AWS region configured (set AWS_REGION), skipping EC2 discovery');
    return [];
  }
  const hasExplicitCreds = env('AWS_ACCESS_KEY_ID') && env('AWS_SECRET_ACCESS_KEY');
  if (!hasExplicitCreds) {
    console.warn('[collector][aws] no explicit AWS credentials; relying on SDK default credential chain');
  }
  try {
    const results = await Promise.allSettled(regions.map(discoverRegion));
    const hosts: DiscoveredCloudHost[] = [];
    let firstError: string | null = null;
    for (const result of results) {
      if (result.status === 'fulfilled') {
        hosts.push(...result.value);
      } else if (firstError === null) {
        firstError = result.reason instanceof Error ? result.reason.message : String(result.reason);
      }
    }
    if (hosts.length === 0 && firstError) {
      console.warn(`[collector][aws] EC2 discovery failed: ${firstError}`);
    }
    console.log(`[collector][aws] discovered ${hosts.length} EC2 instance(s) across ${regions.length} region(s)`);
    return hosts;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[collector][aws] EC2 discovery failed: ${message}`);
    return [];
  }
}
