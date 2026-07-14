/**
 * Local Hyper-V discovery for the Windows collector.
 *
 * The collector intentionally uses the native Hyper-V PowerShell module: it
 * runs on the Hyper-V host, does not expose a remote-management password, and
 * respects the privileges of the Windows service account. It is a no-op on
 * non-Windows hosts or when the Hyper-V role/module is absent.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export type DiscoveredHyperVHost = {
  address: string;
  name: string;
  resourceId: string;
  provider: 'VIRTUAL';
  platform: 'hyperv';
  metadata: {
    state: string;
    host: string | null;
    macAddress: string | null;
  };
};

type HyperVRow = {
  id?: string;
  name?: string;
  state?: string;
  host?: string;
  macAddress?: string;
  ipAddresses?: string[];
};

const script = [
  "$ErrorActionPreference = 'Stop'",
  "if (-not (Get-Module -ListAvailable -Name Hyper-V)) { exit 0 }",
  'Get-VM | ForEach-Object {',
  '  $vm = $_',
  '  $nic = Get-VMNetworkAdapter -VMName $vm.Name -ErrorAction SilentlyContinue | Select-Object -First 1',
  '  [PSCustomObject]@{',
  '    id = $vm.Id.Guid; name = $vm.Name; state = $vm.State.ToString();',
  '    host = $env:COMPUTERNAME; macAddress = $nic.MacAddress;',
  "    ipAddresses = @($nic.IPAddresses | Where-Object { $_ -match '^\\d{1,3}(\\.\\d{1,3}){3}$' })",
  '  }',
  '} | ConvertTo-Json -Compress -Depth 3',
].join('; ');

export async function discoverHyperV(): Promise<DiscoveredHyperVHost[]> {
  if (process.platform !== 'win32') return [];
  try {
    const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
      timeout: 30_000,
      windowsHide: true,
      maxBuffer: 2 * 1024 * 1024,
    });
    if (!stdout.trim()) return [];
    const parsed = JSON.parse(stdout) as HyperVRow | HyperVRow[];
    const rows = Array.isArray(parsed) ? parsed : [parsed];
    const hosts = rows.flatMap((row) => {
      const address = row.ipAddresses?.find((ip) => !ip.startsWith('169.254.'));
      if (!address || !row.id || !row.name) return [];
      return [{
        address,
        name: row.name,
        resourceId: row.id,
        provider: 'VIRTUAL' as const,
        platform: 'hyperv' as const,
        metadata: { state: row.state ?? 'Unknown', host: row.host ?? null, macAddress: row.macAddress ?? null },
      }];
    });
    console.log(`[collector][hyperv] discovered ${hosts.length} Hyper-V guest(s)`);
    return hosts;
  } catch (error) {
    console.warn(`[collector][hyperv] discovery failed: ${error instanceof Error ? error.message : String(error)}`);
    return [];
  }
}
