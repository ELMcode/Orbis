import { execFile } from 'node:child_process';
import { lookup, reverse } from 'node:dns/promises';
import { readFile, access } from 'node:fs/promises';
import path from 'node:path';
import { Socket } from 'node:net';
import { promisify } from 'node:util';
import * as snmp from 'net-snmp';
import { discoverAwsEc2 } from './cloud/aws.js';
import { discoverAzureVms } from './cloud/azure.js';
import { discoverGcpInstances } from './cloud/gcp.js';
import { discoverProxmox } from './hypervisor/proxmox.js';
import { discoverVsphere } from './hypervisor/vmware.js';
import { discoverHyperV } from './hypervisor/hyperv.js';

const execFileAsync = promisify(execFile);

type CollectorConfig = {
  apiUrl: string;
  collectorId: string;
  token: string;
  cidrs: string[];
  ports: number[];
  timeoutMs: number;
  snmpCommunities: string[];
  snmpV3?: SnmpV3Config | null;
  snmpTimeoutMs: number;
  cloudInventoryFile?: string | null;
  virtualInventoryFile?: string | null;
  intervalSeconds: number;
  runOnce: boolean;
};

type SnmpV3Config = {
  username: string;
  level: 'noAuthNoPriv' | 'authNoPriv' | 'authPriv';
  authProtocol?: 'md5' | 'sha' | 'sha224' | 'sha256' | 'sha384' | 'sha512';
  authPassword?: string;
  privProtocol?: 'des' | 'aes' | 'aes256b' | 'aes256r';
  privPassword?: string;
};

type HostResult = {
  address: string;
  hostname?: string | null;
  sysName?: string | null;
  sysDescr?: string | null;
  sysObjectId?: string | null;
  uptime?: number | null;
  model?: string | null;
  serial?: string | null;
  mac?: string | null;
  vendor?: string | null;
  openPorts: number[];
  interfaces: SnmpInterface[];
  routeEntries?: RouteEntry[];
  serviceBanners?: ServiceBanner[];
  cloud?: CloudResource | null;
  virtual?: VirtualResource | null;
  arpEntries?: ArpEntry[];
  macTable?: MacTableEntry[];
  vlans?: VlanEntry[];
  confidence?: number;
  sources?: string[];
  latencyMs?: number | null;
  source: 'TCP' | 'ARP' | 'SNMP' | 'CLOUD' | 'VIRTUAL';
};

type SnmpInterface = {
  index: number;
  name?: string | null;
  description?: string | null;
  alias?: string | null;
  mac?: string | null;
  adminStatus?: number | null;
  operStatus?: number | null;
  speed?: number | null;
};

type LinkResult = {
  localDevice: string;
  localPort?: string | null;
  remoteDevice: string;
  remotePort?: string | null;
  protocol: 'CDP' | 'LLDP' | 'SNMP';
  speed?: string | null;
  vlan?: string | null;
  confidence?: number;
};

type SnmpDiscovery = {
  host: Partial<HostResult>;
  links: LinkResult[];
};

type ArpEntry = {
  address: string;
  mac: string;
  interfaceIndex?: number | null;
};

type MacTableEntry = {
  mac: string;
  interfaceIndex?: number | null;
  bridgePort?: number | null;
  vlan?: number | null;
};

type VlanEntry = {
  vlanId: number;
  name?: string | null;
};

type RouteEntry = {
  destination: string;
  mask?: string | null;
  nextHop?: string | null;
  interfaceIndex?: number | null;
};

type ServiceBanner = {
  port: number;
  service?: string | null;
  product?: string | null;
  banner?: string | null;
};

type CloudResource = {
  provider: 'AWS' | 'AZURE' | 'GCP';
  account?: string | null;
  region?: string | null;
  resourceId: string;
  resourceType?: string | null;
  privateIp?: string | null;
  publicIp?: string | null;
  tags?: Record<string, string>;
};

type VirtualResource = {
  platform: 'VMWARE' | 'PROXMOX' | 'HYPER_V';
  cluster?: string | null;
  host?: string | null;
  vmId: string;
  guestOs?: string | null;
  powerState?: string | null;
  ip?: string | null;
};

const VERSION = '1.1.0';
const MAX_HOSTS_PER_RUN = 2048;
const CONCURRENCY = 64;
const SNMP_CONCURRENCY = 32;
const DEFAULT_PORTS = [22, 80, 443, 445, 3389, 8080, 8443, 9100];

const OIDS = {
  sysDescr: '1.3.6.1.2.1.1.1.0',
  sysObjectId: '1.3.6.1.2.1.1.2.0',
  sysUpTime: '1.3.6.1.2.1.1.3.0',
  sysName: '1.3.6.1.2.1.1.5.0',
  ifDescr: '1.3.6.1.2.1.2.2.1.2',
  ifPhysAddress: '1.3.6.1.2.1.2.2.1.6',
  ifAdminStatus: '1.3.6.1.2.1.2.2.1.7',
  ifOperStatus: '1.3.6.1.2.1.2.2.1.8',
  ifSpeed: '1.3.6.1.2.1.2.2.1.5',
  ifName: '1.3.6.1.2.1.31.1.1.1.1',
  ifAlias: '1.3.6.1.2.1.31.1.1.1.18',
  lldpLocPortId: '1.0.8802.1.1.2.1.3.7.1.3',
  lldpLocPortDesc: '1.0.8802.1.1.2.1.3.7.1.4',
  lldpRemPortId: '1.0.8802.1.1.2.1.4.1.1.7',
  lldpRemPortDesc: '1.0.8802.1.1.2.1.4.1.1.8',
  lldpRemSysName: '1.0.8802.1.1.2.1.4.1.1.9',
  ipNetToMediaPhysAddress: '1.3.6.1.2.1.4.22.1.2',
  dot1dTpFdbPort: '1.3.6.1.2.1.17.4.3.1.2',
  dot1dBasePortIfIndex: '1.3.6.1.2.1.17.1.4.1.2',
  dot1qTpFdbPort: '1.3.6.1.2.1.17.7.1.2.2.1.2',
  dot1qVlanStaticName: '1.3.6.1.2.1.17.7.1.4.3.1.1',
  ipRouteIfIndex: '1.3.6.1.2.1.4.21.1.2',
  ipRouteNextHop: '1.3.6.1.2.1.4.21.1.7',
  ipRouteMask: '1.3.6.1.2.1.4.21.1.11',
  cdpCacheDeviceId: '1.3.6.1.4.1.9.9.23.1.2.1.1.6',
  cdpCacheDevicePort: '1.3.6.1.4.1.9.9.23.1.2.1.1.7',
  cdpCachePlatform: '1.3.6.1.4.1.9.9.23.1.2.1.1.8',
};

async function main() {
  await loadEnvironmentFile();
  const config = loadConfig();
  await runLoop(config);
}

async function runLoop(config: CollectorConfig) {
  await sendCollectorLog(config, 'INFO', 'Collector démarré', {
    cidrs: config.cidrs,
    ports: config.ports,
    snmpV2c: config.snmpCommunities.length > 0,
    snmpV3: Boolean(config.snmpV3),
    cloudInventoryFile: config.cloudInventoryFile ?? null,
    virtualInventoryFile: config.virtualInventoryFile ?? null,
    intervalSeconds: config.intervalSeconds,
  });
  await sendCollectorLog(config, 'DIAGNOSTIC', 'Diagnostic collector', await runDiagnostics(config));
  do {
    try {
      await runDiscovery(config);
    } catch (err) {
      console.error('[collector] run failed', err);
      await sendCollectorLog(config, 'ERROR', 'Run collector en échec', { error: errorMessage(err) });
    }
    if (!config.runOnce) await sleep(config.intervalSeconds * 1000);
  } while (!config.runOnce);
}

async function runDiscovery(config: CollectorConfig) {
  const startedAt = new Date();
  const arp = await readArpTable();
  const hosts = unique(config.cidrs.flatMap(expandCidr));
  if (hosts.length === 0) throw new Error('No host to scan');
  if (hosts.length > MAX_HOSTS_PER_RUN) {
    throw new Error(`Too many hosts (${hosts.length}). Limit is ${MAX_HOSTS_PER_RUN}; split CIDRs or reduce scope.`);
  }

  console.log(`[collector] scanning ${hosts.length} host(s), ports=${config.ports.join(',')}`);
  const scanned = await mapLimit(hosts, CONCURRENCY, async (address) => scanHost(address, config.ports, config.timeoutMs, arp.get(address)));
  const hostByAddress = new Map(scanned.filter((host): host is HostResult => host !== null).map((host) => [host.address, host]));
  const links: LinkResult[] = [];

  if (config.snmpV3 || config.snmpCommunities.length > 0) {
    console.log(`[collector] snmp enabled, v3=${config.snmpV3 ? 'yes' : 'no'}, communities=${config.snmpCommunities.length}`);
    const snmpResults = await mapLimit(hosts, SNMP_CONCURRENCY, async (address) => discoverSnmp(address, config));
    for (const item of snmpResults) {
      if (!item) continue;
      const current = hostByAddress.get(item.host.address!);
      hostByAddress.set(item.host.address!, mergeHost(current, item.host));
      links.push(...item.links);
    }
  }

  for (const imported of await loadExternalInventories(config)) {
    const current = hostByAddress.get(imported.address!);
    hostByAddress.set(imported.address!, mergeHost(current, imported));
  }

  const active = [...hostByAddress.values()];
  const finishedAt = new Date();

  const response = await fetch(`${config.apiUrl.replace(/\/$/, '')}/api/collector/ingest`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.token}`,
      'x-collector-id': config.collectorId,
    },
    body: JSON.stringify({
      run: {
        status: 'SUCCESS',
        startedAt: startedAt.toISOString(),
        finishedAt: finishedAt.toISOString(),
        version: VERSION,
        cidrs: config.cidrs,
        ports: config.ports,
      },
      hosts: active,
      links,
    }),
  });

  const body = await response.text();
  if (!response.ok) throw new Error(`Ingest failed ${response.status}: ${body}`);
  console.log(`[collector] sent ${active.length} active host(s), ${links.length} link(s): ${body}`);
  await sendCollectorLog(config, 'INFO', 'Run collector envoyé', {
    hosts: active.length,
    links: links.length,
    durationMs: finishedAt.getTime() - startedAt.getTime(),
  });
}

async function runDiagnostics(config: CollectorConfig) {
  const dns = await checkDns(config.apiUrl);
  const api = await checkApi(config.apiUrl);
  const arp = await checkArpCommand();
  return {
    version: VERSION,
    dns,
    api,
    arp,
    network: {
      cidrs: config.cidrs,
      ports: config.ports,
      maxHostsPerRun: MAX_HOSTS_PER_RUN,
    },
    snmp: {
      v2cConfigured: config.snmpCommunities.length > 0,
      v3Configured: Boolean(config.snmpV3),
      timeoutMs: config.snmpTimeoutMs,
    },
  };
}

async function checkDns(apiUrl: string) {
  try {
    const hostname = new URL(apiUrl).hostname;
    const result = await lookup(hostname);
    return { ok: true, hostname, address: result.address, family: result.family };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

async function checkApi(apiUrl: string) {
  try {
    const started = Date.now();
    const response = await fetch(`${apiUrl.replace(/\/$/, '')}/ready`);
    return { ok: response.ok, status: response.status, latencyMs: Date.now() - started };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

async function checkArpCommand() {
  try {
    const { stdout } = await execFileAsync('arp', ['-an'], { timeout: 4_000 });
    return { ok: true, entries: stdout.split(/\r?\n/).filter(Boolean).length };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

async function sendCollectorLog(
  config: CollectorConfig,
  level: 'INFO' | 'WARNING' | 'ERROR' | 'DIAGNOSTIC',
  message: string,
  meta?: Record<string, unknown>,
) {
  try {
    const response = await fetch(`${config.apiUrl.replace(/\/$/, '')}/api/collector/logs`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.token}`,
        'x-collector-id': config.collectorId,
      },
      body: JSON.stringify({ level, message, meta, version: VERSION }),
    });
    if (!response.ok) {
      console.warn(`[collector] log push failed ${response.status}: ${await response.text()}`);
    }
  } catch (err) {
    console.warn('[collector] log push failed', err);
  }
}

async function scanHost(address: string, ports: number[], timeoutMs: number, arp?: { mac?: string | null }): Promise<HostResult | null> {
  const started = Date.now();
  const checks = await Promise.all(ports.map(async (port) => ({ port, open: await probeTcp(address, port, timeoutMs) })));
  const openPorts = checks.filter((check) => check.open).map((check) => check.port);
  if (openPorts.length === 0 && !arp?.mac) return null;
  const hostname = await reverseDns(address);
  const serviceBanners = await mapLimit(openPorts.slice(0, 12), 6, (port) => grabServiceBanner(address, port, Math.min(timeoutMs, 1200)));
  return {
    address,
    hostname,
    mac: arp?.mac ?? null,
    vendor: null,
    openPorts,
    interfaces: [],
    routeEntries: [],
    serviceBanners: serviceBanners.filter((banner): banner is ServiceBanner => banner !== null),
    confidence: openPorts.length > 0 ? 45 : 25,
    sources: [openPorts.length > 0 ? 'TCP_BANNER' : 'ARP'],
    latencyMs: Date.now() - started,
    source: openPorts.length > 0 ? 'TCP' : 'ARP',
  };
}

async function discoverSnmp(address: string, config: CollectorConfig): Promise<SnmpDiscovery | null> {
  if (config.snmpV3) {
    const session = snmp.createV3Session(address, buildSnmpV3User(config.snmpV3), {
      version: snmp.Version3,
      timeout: config.snmpTimeoutMs,
      retries: 0,
    });
    try {
      return await discoverWithSession(address, session, 'SNMPv3');
    } catch {
      // Fall back to v2c communities when configured.
    } finally {
      session.close();
    }
  }

  for (const community of config.snmpCommunities) {
    const session = snmp.createSession(address, community, {
      version: snmp.Version2c,
      timeout: config.snmpTimeoutMs,
      retries: 0,
    });
    try {
      return await discoverWithSession(address, session, 'SNMPv2c');
    } catch {
      // Try next community.
    } finally {
      session.close();
    }
  }
  return null;
}

async function discoverWithSession(address: string, session: snmp.Session, source: 'SNMPv2c' | 'SNMPv3'): Promise<SnmpDiscovery> {
  const scalar = await snmpGet(session, [OIDS.sysDescr, OIDS.sysObjectId, OIDS.sysUpTime, OIDS.sysName]);
  const sysDescr = scalar[OIDS.sysDescr];
  const sysName = scalar[OIDS.sysName];
  const sysObjectId = scalar[OIDS.sysObjectId];
  const uptime = Number(scalar[OIDS.sysUpTime]);
  const [
    ifDescr,
    ifPhys,
    ifAdmin,
    ifOper,
    ifSpeed,
    ifName,
    ifAlias,
    locPortId,
    locPortDesc,
    remPortId,
    remPortDesc,
    remSysName,
    ipNetToMedia,
    dot1dTpFdbPort,
    dot1dBasePortIfIndex,
    dot1qTpFdbPort,
    dot1qVlanStaticName,
    ipRouteIfIndex,
    ipRouteNextHop,
    ipRouteMask,
    cdpDeviceId,
    cdpDevicePort,
    cdpPlatform,
  ] = await Promise.all([
    snmpSubtree(session, OIDS.ifDescr),
    snmpSubtree(session, OIDS.ifPhysAddress),
    snmpSubtree(session, OIDS.ifAdminStatus),
    snmpSubtree(session, OIDS.ifOperStatus),
    snmpSubtree(session, OIDS.ifSpeed),
    snmpSubtree(session, OIDS.ifName),
    snmpSubtree(session, OIDS.ifAlias),
    snmpSubtree(session, OIDS.lldpLocPortId),
    snmpSubtree(session, OIDS.lldpLocPortDesc),
    snmpSubtree(session, OIDS.lldpRemPortId),
    snmpSubtree(session, OIDS.lldpRemPortDesc),
    snmpSubtree(session, OIDS.lldpRemSysName),
    snmpSubtree(session, OIDS.ipNetToMediaPhysAddress),
    snmpSubtree(session, OIDS.dot1dTpFdbPort),
    snmpSubtree(session, OIDS.dot1dBasePortIfIndex),
    snmpSubtree(session, OIDS.dot1qTpFdbPort),
    snmpSubtree(session, OIDS.dot1qVlanStaticName),
    snmpSubtree(session, OIDS.ipRouteIfIndex),
    snmpSubtree(session, OIDS.ipRouteNextHop),
    snmpSubtree(session, OIDS.ipRouteMask),
    snmpSubtree(session, OIDS.cdpCacheDeviceId),
    snmpSubtree(session, OIDS.cdpCacheDevicePort),
    snmpSubtree(session, OIDS.cdpCachePlatform),
  ]);

  const interfaces = buildInterfaces({ ifDescr, ifPhys, ifAdmin, ifOper, ifSpeed, ifName, ifAlias });
  const arpEntries = buildArpEntries(ipNetToMedia);
  const macTable = buildMacTable({ dot1dTpFdbPort, dot1dBasePortIfIndex, dot1qTpFdbPort });
  const vlans = buildVlans(dot1qVlanStaticName);
  const routeEntries = buildRouteEntries({ ipRouteIfIndex, ipRouteNextHop, ipRouteMask });
  const lldpLinks = buildLldpLinks(sysName || address, { locPortId, locPortDesc, remPortId, remPortDesc, remSysName });
  const cdpLinks = buildCdpLinks(sysName || address, { ifName, ifDescr, cdpDeviceId, cdpDevicePort, cdpPlatform });
  return {
    host: {
      address,
      hostname: sysName || undefined,
      sysName: sysName || undefined,
      sysDescr: sysDescr || undefined,
      sysObjectId: sysObjectId || undefined,
      uptime: Number.isFinite(uptime) ? uptime : undefined,
      vendor: inferVendor(sysDescr),
      model: inferModel(sysDescr),
      openPorts: [],
      interfaces,
      routeEntries,
      arpEntries,
      macTable,
      vlans,
      confidence: source === 'SNMPv3' ? 95 : 90,
      sources: [source],
      source: 'SNMP',
    },
    links: [...lldpLinks, ...cdpLinks],
  };
}

function snmpGet(session: snmp.Session, oids: string[]): Promise<Record<string, string>> {
  return new Promise((resolve, reject) => {
    session.get(oids, (err, varbinds) => {
      if (err) return reject(err);
      const values: Record<string, string> = {};
      for (const vb of varbinds ?? []) {
        if (snmp.isVarbindError(vb)) continue;
        values[vb.oid] = snmpValueToString(vb.value);
      }
      return resolve(values);
    });
  });
}

function snmpSubtree(session: snmp.Session, oid: string): Promise<Map<string, string>> {
  return new Promise((resolve) => {
    const rows = new Map<string, string>();
    session.subtree(
      oid,
      20,
      (varbinds) => {
        for (const varbind of varbinds) {
          if (!snmp.isVarbindError(varbind)) {
            rows.set(varbind.oid, snmpValueToString(varbind.value));
          }
        }
      },
      () => resolve(rows),
    );
  });
}

function snmpValueToString(value: unknown): string {
  if (Buffer.isBuffer(value)) {
    const printable = value.toString('utf8').replace(/\0/g, '').trim();
    if (printable && /^[\x20-\x7E]+$/.test(printable)) return printable;
    return [...value].map((byte) => byte.toString(16).padStart(2, '0')).join(':');
  }
  if (typeof value === 'object' && value !== null && 'toString' in value) return String(value);
  return value == null ? '' : String(value);
}

function buildInterfaces(tables: {
  ifDescr: Map<string, string>;
  ifPhys: Map<string, string>;
  ifAdmin: Map<string, string>;
  ifOper: Map<string, string>;
  ifSpeed: Map<string, string>;
  ifName: Map<string, string>;
  ifAlias: Map<string, string>;
}): SnmpInterface[] {
  const indexes = new Set<number>();
  for (const [oid] of [...tables.ifDescr, ...tables.ifName]) {
    const index = Number(oid.split('.').at(-1));
    if (Number.isInteger(index) && index > 0) indexes.add(index);
  }
  return [...indexes].sort((a, b) => a - b).map((index) => ({
    index,
    name: getByIndex(tables.ifName, index),
    description: getByIndex(tables.ifDescr, index),
    alias: getByIndex(tables.ifAlias, index),
    mac: normalizeMaybeMac(getByIndex(tables.ifPhys, index)),
    adminStatus: toOptionalNumber(getByIndex(tables.ifAdmin, index)),
    operStatus: toOptionalNumber(getByIndex(tables.ifOper, index)),
    speed: toOptionalNumber(getByIndex(tables.ifSpeed, index)),
  })).filter((item) => item.name || item.description);
}

function buildLldpLinks(localDevice: string, tables: {
  locPortId: Map<string, string>;
  locPortDesc: Map<string, string>;
  remPortId: Map<string, string>;
  remPortDesc: Map<string, string>;
  remSysName: Map<string, string>;
}): LinkResult[] {
  const links: LinkResult[] = [];
  for (const [oid, remoteDevice] of tables.remSysName) {
    if (!remoteDevice) continue;
    const suffix = oid.slice(`${OIDS.lldpRemSysName}.`.length);
    const parts = suffix.split('.');
    const localPortNum = Number(parts.at(-2));
    const remotePort = tables.remPortDesc.get(`${OIDS.lldpRemPortDesc}.${suffix}`) || tables.remPortId.get(`${OIDS.lldpRemPortId}.${suffix}`) || null;
    const localPort =
      (Number.isInteger(localPortNum) ? tables.locPortDesc.get(`${OIDS.lldpLocPortDesc}.${localPortNum}`) : null) ||
      (Number.isInteger(localPortNum) ? tables.locPortId.get(`${OIDS.lldpLocPortId}.${localPortNum}`) : null) ||
      null;
    links.push({
      localDevice,
      localPort,
      remoteDevice,
      remotePort,
      protocol: 'LLDP',
      confidence: 95,
    });
  }
  return dedupeLinks(links);
}

function buildCdpLinks(localDevice: string, tables: {
  ifName: Map<string, string>;
  ifDescr: Map<string, string>;
  cdpDeviceId: Map<string, string>;
  cdpDevicePort: Map<string, string>;
  cdpPlatform: Map<string, string>;
}): LinkResult[] {
  const links: LinkResult[] = [];
  for (const [oid, remoteDevice] of tables.cdpDeviceId) {
    if (!remoteDevice) continue;
    const suffix = oid.slice(`${OIDS.cdpCacheDeviceId}.`.length);
    const localIfIndex = Number(suffix.split('.').at(0));
    const remotePort = tables.cdpDevicePort.get(`${OIDS.cdpCacheDevicePort}.${suffix}`) || null;
    const platform = tables.cdpPlatform.get(`${OIDS.cdpCachePlatform}.${suffix}`) || null;
    const localPort =
      (Number.isInteger(localIfIndex) ? getByIndex(tables.ifName, localIfIndex) : null) ||
      (Number.isInteger(localIfIndex) ? getByIndex(tables.ifDescr, localIfIndex) : null) ||
      null;
    links.push({
      localDevice,
      localPort,
      remoteDevice: cleanRemoteDevice(remoteDevice, platform),
      remotePort,
      protocol: 'CDP',
      confidence: 95,
    });
  }
  return dedupeLinks(links);
}

function buildArpEntries(table: Map<string, string>): ArpEntry[] {
  const entries: ArpEntry[] = [];
  for (const [oid, value] of table) {
    const suffix = oid.slice(`${OIDS.ipNetToMediaPhysAddress}.`.length);
    const parts = suffix.split('.').map(Number);
    const address = parts.slice(-4).join('.');
    const interfaceIndex = parts.length >= 5 ? parts[0] : null;
    const mac = normalizeMaybeMac(value);
    if (!isIpv4(address) || !mac) continue;
    entries.push({ address, mac, interfaceIndex });
  }
  return dedupeBy(entries, (entry) => `${entry.address}|${entry.mac}`);
}

function buildMacTable(tables: {
  dot1dTpFdbPort: Map<string, string>;
  dot1dBasePortIfIndex: Map<string, string>;
  dot1qTpFdbPort: Map<string, string>;
}): MacTableEntry[] {
  const entries: MacTableEntry[] = [];
  for (const [oid, value] of tables.dot1dTpFdbPort) {
    const mac = macFromOidSuffix(oid.slice(`${OIDS.dot1dTpFdbPort}.`.length));
    const bridgePort = toOptionalNumber(value);
    if (!mac) continue;
    entries.push({
      mac,
      bridgePort,
      interfaceIndex: bridgePort ? toOptionalNumber(getByIndex(tables.dot1dBasePortIfIndex, bridgePort)) : null,
    });
  }
  for (const [oid, value] of tables.dot1qTpFdbPort) {
    const suffix = oid.slice(`${OIDS.dot1qTpFdbPort}.`.length);
    const parts = suffix.split('.');
    const vlan = Number(parts[0]);
    const mac = macFromOidSuffix(parts.slice(1).join('.'));
    const bridgePort = toOptionalNumber(value);
    if (!mac) continue;
    entries.push({
      mac,
      vlan: Number.isInteger(vlan) ? vlan : null,
      bridgePort,
      interfaceIndex: bridgePort ? toOptionalNumber(getByIndex(tables.dot1dBasePortIfIndex, bridgePort)) : null,
    });
  }
  return dedupeBy(entries, (entry) => `${entry.mac}|${entry.interfaceIndex ?? ''}|${entry.bridgePort ?? ''}|${entry.vlan ?? ''}`);
}

function buildVlans(table: Map<string, string>): VlanEntry[] {
  const vlans: VlanEntry[] = [];
  for (const [oid, name] of table) {
    const vlanId = Number(oid.split('.').at(-1));
    if (!Number.isInteger(vlanId) || vlanId <= 0 || vlanId > 4094) continue;
    vlans.push({ vlanId, name: name || null });
  }
  return dedupeBy(vlans, (vlan) => String(vlan.vlanId));
}

function buildRouteEntries(tables: {
  ipRouteIfIndex: Map<string, string>;
  ipRouteNextHop: Map<string, string>;
  ipRouteMask: Map<string, string>;
}): RouteEntry[] {
  const destinations = new Set<string>();
  for (const [oid] of [...tables.ipRouteIfIndex, ...tables.ipRouteNextHop, ...tables.ipRouteMask]) {
    const destination = oid.split('.').slice(-4).join('.');
    if (isIpv4(destination)) destinations.add(destination);
  }
  return [...destinations].sort().map((destination) => ({
    destination,
    mask: tables.ipRouteMask.get(`${OIDS.ipRouteMask}.${destination}`) || null,
    nextHop: tables.ipRouteNextHop.get(`${OIDS.ipRouteNextHop}.${destination}`) || null,
    interfaceIndex: toOptionalNumber(tables.ipRouteIfIndex.get(`${OIDS.ipRouteIfIndex}.${destination}`)),
  })).filter((entry) => entry.nextHop || entry.interfaceIndex);
}

function macFromOidSuffix(suffix: string): string | null {
  const bytes = suffix.split('.').map(Number);
  if (bytes.length !== 6 || bytes.some((byte) => !Number.isInteger(byte) || byte < 0 || byte > 255)) return null;
  return bytes.map((byte) => byte.toString(16).padStart(2, '0')).join(':');
}

function cleanRemoteDevice(deviceId: string, platform?: string | null): string {
  const cleaned = deviceId.trim().replace(/\..*$/, '');
  if (cleaned) return cleaned.slice(0, 120);
  return platform?.trim().slice(0, 120) || deviceId.slice(0, 120);
}

function mergeHost(current: HostResult | undefined, snmpHost: Partial<HostResult>): HostResult {
  if (!current) {
    return {
      address: snmpHost.address!,
      hostname: snmpHost.hostname ?? snmpHost.sysName ?? null,
      sysName: snmpHost.sysName ?? null,
      sysDescr: snmpHost.sysDescr ?? null,
      sysObjectId: snmpHost.sysObjectId ?? null,
      uptime: snmpHost.uptime ?? null,
      model: snmpHost.model ?? null,
      serial: snmpHost.serial ?? null,
      mac: snmpHost.mac ?? null,
      vendor: snmpHost.vendor ?? null,
      openPorts: snmpHost.openPorts ?? [],
      interfaces: snmpHost.interfaces ?? [],
      routeEntries: snmpHost.routeEntries ?? [],
      serviceBanners: snmpHost.serviceBanners ?? [],
      cloud: snmpHost.cloud ?? null,
      virtual: snmpHost.virtual ?? null,
      arpEntries: snmpHost.arpEntries ?? [],
      macTable: snmpHost.macTable ?? [],
      vlans: snmpHost.vlans ?? [],
      confidence: snmpHost.confidence ?? 90,
      sources: snmpHost.sources ?? ['SNMP'],
      source: 'SNMP',
    };
  }
  return {
    ...current,
    hostname: snmpHost.hostname ?? current.hostname,
    sysName: snmpHost.sysName ?? current.sysName,
    sysDescr: snmpHost.sysDescr ?? current.sysDescr,
    sysObjectId: snmpHost.sysObjectId ?? current.sysObjectId,
    uptime: snmpHost.uptime ?? current.uptime,
    model: snmpHost.model ?? current.model,
    serial: snmpHost.serial ?? current.serial,
    vendor: snmpHost.vendor ?? current.vendor,
    interfaces: snmpHost.interfaces?.length ? snmpHost.interfaces : current.interfaces,
    routeEntries: snmpHost.routeEntries?.length ? snmpHost.routeEntries : current.routeEntries,
    serviceBanners: snmpHost.serviceBanners?.length ? mergeBanners(current.serviceBanners ?? [], snmpHost.serviceBanners) : current.serviceBanners,
    cloud: snmpHost.cloud ?? current.cloud,
    virtual: snmpHost.virtual ?? current.virtual,
    arpEntries: snmpHost.arpEntries?.length ? snmpHost.arpEntries : current.arpEntries,
    macTable: snmpHost.macTable?.length ? snmpHost.macTable : current.macTable,
    vlans: snmpHost.vlans?.length ? snmpHost.vlans : current.vlans,
    confidence: Math.max(current.confidence ?? 0, snmpHost.confidence ?? 0) || current.confidence,
    sources: unique([...(current.sources ?? [current.source]), ...(snmpHost.sources ?? ['SNMP'])]),
    source: snmpHost.source ?? (snmpHost.sysName || snmpHost.sysDescr ? 'SNMP' : current.source),
  };
}

async function grabServiceBanner(host: string, port: number, timeoutMs: number): Promise<ServiceBanner | null> {
  return new Promise((resolve) => {
    const socket = new Socket();
    let settled = false;
    let data = Buffer.alloc(0);
    const finish = (banner?: string | null) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve({ port, ...classifyBanner(port, banner ?? null) });
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => {
      const probe = bannerProbe(port, host);
      if (probe) socket.write(probe);
      setTimeout(() => finish(data.toString('utf8').replace(/\0/g, '').trim().slice(0, 240) || null), Math.min(timeoutMs, 700));
    });
    socket.on('data', (chunk) => {
      data = Buffer.concat([data, chunk]).subarray(0, 512);
      if (data.length >= 80) finish(data.toString('utf8').replace(/\0/g, '').trim().slice(0, 240));
    });
    socket.once('timeout', () => finish(data.length ? data.toString('utf8').trim().slice(0, 240) : null));
    socket.once('error', () => resolve(null));
    socket.connect(port, host);
  });
}

function bannerProbe(port: number, host: string): string | null {
  if ([80, 8080, 8000, 8443].includes(port)) return `HEAD / HTTP/1.0\r\nHost: ${host}\r\n\r\n`;
  if ([21, 22, 25, 110, 143].includes(port)) return null;
  return '\r\n';
}

function classifyBanner(port: number, banner: string | null): Omit<ServiceBanner, 'port'> {
  const lower = banner?.toLowerCase() ?? '';
  if (port === 22 || lower.startsWith('ssh-')) return { service: 'ssh', product: banner?.match(/^SSH-[^\s]+-([^\r\n]+)/i)?.[1] ?? null, banner };
  if ([80, 8080, 8000, 8443, 443].includes(port) || lower.includes('http/')) {
    const product = banner?.match(/\nserver:\s*([^\r\n]+)/i)?.[1]?.trim() ?? banner?.match(/^server:\s*([^\r\n]+)/i)?.[1]?.trim() ?? null;
    return { service: port === 443 || port === 8443 ? 'https' : 'http', product, banner };
  }
  if (port === 25) return { service: 'smtp', product: banner, banner };
  if (port === 3389) return { service: 'rdp', product: null, banner };
  if (port === 445) return { service: 'smb', product: null, banner };
  if (port === 5432) return { service: 'postgresql', product: null, banner };
  if (port === 3306) return { service: 'mysql', product: null, banner };
  return { service: commonServiceName(port), product: null, banner };
}

function commonServiceName(port: number): string | null {
  const names: Record<number, string> = { 21: 'ftp', 53: 'dns', 110: 'pop3', 143: 'imap', 161: 'snmp', 389: 'ldap', 5900: 'vnc', 6379: 'redis' };
  return names[port] ?? null;
}

async function loadExternalInventories(config: CollectorConfig): Promise<Partial<HostResult>[]> {
  // Live cloud + hypervisor discovery. Each provider returns [] when
  // unconfigured/unreachable, so this never throws and adds no cost when no
  // credentials are present.
  const [aws, azure, gcp] = await Promise.all([discoverAwsEc2(), discoverAzureVms(), discoverGcpInstances()]);
  const [proxmox, vmware, hyperv] = await Promise.all([discoverProxmox(), discoverVsphere(), discoverHyperV()]);

  // Backward compatibility: optional JSON file imports are still merged with
  // the live discovery results when the corresponding env var is set.
  const [cloudFile, virtualFile] = await Promise.all([
    config.cloudInventoryFile ? loadCloudInventory(config.cloudInventoryFile) : Promise.resolve([]),
    config.virtualInventoryFile ? loadVirtualInventory(config.virtualInventoryFile) : Promise.resolve([]),
  ]);

  return [
    ...aws.map(mapDiscoveredCloudHost),
    ...azure.map(mapDiscoveredCloudHost),
    ...gcp.map(mapDiscoveredCloudHost),
    ...proxmox.map(mapDiscoveredVirtualHost),
    ...vmware.map(mapDiscoveredVirtualHost),
    ...hyperv.map(mapDiscoveredVirtualHost),
    ...cloudFile,
    ...virtualFile,
  ];
}

// Structural type matching every cloud provider's DiscoveredCloudHost. Keeps the
// mapper independent of the per-provider literal unions.
type LiveCloudHost = {
  address: string;
  publicIp?: string | null;
  name?: string | null;
  resourceId: string;
  provider: 'AWS' | 'AZURE' | 'GCP';
  platform: string;
  metadata: Record<string, unknown>;
};

// Structural type matching every hypervisor's DiscoveredVirtualHost.
type LiveVirtualHost = {
  address: string;
  name: string;
  resourceId: string;
  platform: string;
  metadata: Record<string, unknown>;
};

function metaString(metadata: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = metadata[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

function metaTags(metadata: Record<string, unknown>): Record<string, string> | undefined {
  const tags = metadata.tags;
  if (tags && typeof tags === 'object' && !Array.isArray(tags)) {
    return tags as Record<string, string>;
  }
  return undefined;
}

function mapDiscoveredCloudHost(host: LiveCloudHost): Partial<HostResult> {
  const address = host.address;
  if (!address || !isIpv4(address)) return {};
  const provider = host.provider;
  const cloud: CloudResource = {
    provider,
    resourceId: host.resourceId,
    resourceType: host.platform,
    privateIp: isIpv4(host.address) ? host.address : null,
    publicIp: host.publicIp && isIpv4(host.publicIp) ? host.publicIp : null,
    region: metaString(host.metadata, 'region', 'location', 'zone'),
    tags: metaTags(host.metadata),
  };
  return {
    address,
    hostname: host.name ?? null,
    model: metaString(host.metadata, 'instanceType', 'vmSize', 'machineType'),
    vendor: provider,
    openPorts: [],
    interfaces: [],
    routeEntries: [],
    serviceBanners: [],
    arpEntries: [],
    macTable: [],
    vlans: [],
    cloud,
    confidence: 90,
    sources: [`CLOUD_${provider}`],
    source: 'CLOUD' as const,
  };
}

function mapDiscoveredVirtualHost(host: LiveVirtualHost): Partial<HostResult> {
  const address = host.address;
  if (!address || !isIpv4(address)) return {};
  const platform = parseVirtualPlatform(host.platform);
  const virtual: VirtualResource = {
    platform,
    vmId: host.resourceId,
    host: metaString(host.metadata, 'node', 'host'),
    cluster: metaString(host.metadata, 'cluster'),
    powerState: metaString(host.metadata, 'status', 'powerState'),
    guestOs: metaString(host.metadata, 'guestOs'),
    ip: address,
  };
  return {
    address,
    hostname: host.name ?? null,
    model: virtual.guestOs,
    vendor: virtual.platform,
    openPorts: [],
    interfaces: [],
    routeEntries: [],
    serviceBanners: [],
    arpEntries: [],
    macTable: [],
    vlans: [],
    virtual,
    confidence: 92,
    sources: [`VIRTUAL_${virtual.platform}`],
    source: 'VIRTUAL' as const,
  };
}

async function loadCloudInventory(file: string): Promise<Partial<HostResult>[]> {
  const raw = JSON.parse(await readFile(file, 'utf8'));
  const resources = Array.isArray(raw) ? raw : raw.resources;
  if (!Array.isArray(resources)) return [];
  const hosts: Array<Partial<HostResult> | null> = resources.map((item: any) => {
    const cloud: CloudResource = {
      provider: parseCloudProvider(item.provider),
      account: stringOrNull(item.account ?? item.accountId ?? item.subscriptionId ?? item.projectId),
      region: stringOrNull(item.region ?? item.location ?? item.zone),
      resourceId: String(item.resourceId ?? item.id ?? item.instanceId ?? item.name),
      resourceType: stringOrNull(item.resourceType ?? item.type),
      privateIp: stringOrNull(item.privateIp ?? item.privateIPAddress ?? item.ip),
      publicIp: stringOrNull(item.publicIp ?? item.publicIPAddress),
      tags: typeof item.tags === 'object' && item.tags ? item.tags : undefined,
    };
    const address = cloud.privateIp || cloud.publicIp;
    if (!address || !isIpv4(address)) return null;
    return {
      address,
      hostname: stringOrNull(item.name ?? item.hostname),
      model: cloud.resourceType,
      vendor: cloud.provider,
      openPorts: [],
      interfaces: [],
      routeEntries: [],
      serviceBanners: [],
      arpEntries: [],
      macTable: [],
      vlans: [],
      cloud,
      confidence: 90,
      sources: [`CLOUD_${cloud.provider}`],
      source: 'CLOUD' as const,
    };
  });
  return hosts.filter((item): item is Partial<HostResult> => item !== null);
}

async function loadVirtualInventory(file: string): Promise<Partial<HostResult>[]> {
  const raw = JSON.parse(await readFile(file, 'utf8'));
  const resources = Array.isArray(raw) ? raw : raw.vms ?? raw.resources;
  if (!Array.isArray(resources)) return [];
  const hosts: Array<Partial<HostResult> | null> = resources.map((item: any) => {
    const virtual: VirtualResource = {
      platform: parseVirtualPlatform(item.platform),
      cluster: stringOrNull(item.cluster),
      host: stringOrNull(item.host ?? item.hypervisor),
      vmId: String(item.vmId ?? item.id ?? item.name),
      guestOs: stringOrNull(item.guestOs ?? item.os),
      powerState: stringOrNull(item.powerState ?? item.status),
      ip: stringOrNull(item.ip ?? item.address),
    };
    if (!virtual.ip || !isIpv4(virtual.ip)) return null;
    return {
      address: virtual.ip,
      hostname: stringOrNull(item.name ?? item.hostname),
      model: virtual.guestOs,
      vendor: virtual.platform,
      openPorts: [],
      interfaces: [],
      routeEntries: [],
      serviceBanners: [],
      arpEntries: [],
      macTable: [],
      vlans: [],
      virtual,
      confidence: 92,
      sources: [`VIRTUAL_${virtual.platform}`],
      source: 'VIRTUAL' as const,
    };
  });
  return hosts.filter((item): item is Partial<HostResult> => item !== null);
}

function parseCloudProvider(value: unknown): CloudResource['provider'] {
  const normalized = String(value ?? '').toUpperCase();
  if (normalized.includes('AZURE')) return 'AZURE';
  if (normalized.includes('GCP') || normalized.includes('GOOGLE')) return 'GCP';
  return 'AWS';
}

function parseVirtualPlatform(value: unknown): VirtualResource['platform'] {
  const normalized = String(value ?? '').toUpperCase();
  if (normalized.includes('PROXMOX')) return 'PROXMOX';
  if (normalized.includes('HYPER')) return 'HYPER_V';
  return 'VMWARE';
}

function stringOrNull(value: unknown): string | null {
  const text = typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
  return text || null;
}

function mergeBanners(left: ServiceBanner[], right: ServiceBanner[]): ServiceBanner[] {
  return dedupeBy([...left, ...right], (banner) => String(banner.port)).slice(0, 64);
}

function probeTcp(host: string, port: number, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new Socket();
    let settled = false;
    const finish = (open: boolean) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(open);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
    socket.connect(port, host);
  });
}

async function reverseDns(address: string): Promise<string | null> {
  try {
    const names = await reverse(address);
    return names[0] ?? null;
  } catch {
    return null;
  }
}

async function readArpTable(): Promise<Map<string, { mac: string | null }>> {
  try {
    const { stdout } = await execFileAsync('arp', ['-an'], { timeout: 4_000 });
    const rows = new Map<string, { mac: string | null }>();
    for (const line of stdout.split(/\r?\n/)) {
      const ip = line.match(/(?:\d{1,3}\.){3}\d{1,3}/)?.[0];
      const mac = line.match(/(?:[0-9a-f]{1,2}[:-]){5}[0-9a-f]{1,2}/i)?.[0] ?? null;
      if (ip) rows.set(ip, { mac: mac ? normalizeMac(mac) : null });
    }
    return rows;
  } catch {
    return new Map();
  }
}

async function loadEnvironmentFile(): Promise<void> {
  const configuredPath = process.env.ORBIS_CONFIG_FILE?.trim();
  const defaultPath = process.platform === 'win32'
    ? path.join(process.env.ProgramData ?? 'C:\\ProgramData', 'OrbisCollector', 'collector.env')
    : null;
  const envPath = configuredPath || defaultPath;
  if (!envPath) return;

  try {
    await access(envPath);
    const contents = await readFile(envPath, 'utf8');
    for (const line of contents.split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (!match || match[2].startsWith('#')) continue;
      const [, key, rawValue] = match;
      // The service environment remains authoritative, so operators can
      // override a value without modifying the managed configuration file.
      if (process.env[key] !== undefined) continue;
      const value = rawValue.replace(/^(?:"([\s\S]*)"|'([\s\S]*)')$/, '$1$2');
      process.env[key] = value;
    }
  } catch (error: any) {
    if (error?.code !== 'ENOENT') {
      console.warn(`[collector] unable to load configuration file ${envPath}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

function loadConfig(): CollectorConfig {
  const apiUrl = requiredEnv('ORBIS_API_URL');
  const collectorId = requiredEnv('ORBIS_COLLECTOR_ID');
  const token = requiredEnv('ORBIS_COLLECTOR_TOKEN');
  const cidrs = parseList(process.env.ORBIS_CIDRS);
  if (cidrs.length === 0) throw new Error('ORBIS_CIDRS is required, example: 192.168.1.0/24');
  return {
    apiUrl,
    collectorId,
    token,
    cidrs,
    ports: parsePorts(process.env.ORBIS_PORTS) ?? DEFAULT_PORTS,
    timeoutMs: toInt(process.env.ORBIS_TIMEOUT_MS, 900),
    snmpCommunities: parseList(process.env.ORBIS_SNMP_COMMUNITIES),
    snmpV3: parseSnmpV3Config(),
    snmpTimeoutMs: toInt(process.env.ORBIS_SNMP_TIMEOUT_MS, 900),
    cloudInventoryFile: process.env.ORBIS_CLOUD_INVENTORY_FILE?.trim() || null,
    virtualInventoryFile: process.env.ORBIS_VIRTUAL_INVENTORY_FILE?.trim() || null,
    intervalSeconds: Math.max(60, toInt(process.env.ORBIS_INTERVAL_SECONDS, 900)),
    runOnce: process.env.ORBIS_RUN_ONCE === 'true',
  };
}

function parseSnmpV3Config(): SnmpV3Config | null {
  const username = process.env.ORBIS_SNMPV3_USERNAME?.trim();
  if (!username) return null;
  const level = parseSnmpV3Level(process.env.ORBIS_SNMPV3_LEVEL);
  const authProtocol = parseSnmpV3AuthProtocol(process.env.ORBIS_SNMPV3_AUTH_PROTOCOL);
  const authPassword = process.env.ORBIS_SNMPV3_AUTH_PASSWORD?.trim();
  const privProtocol = parseSnmpV3PrivProtocol(process.env.ORBIS_SNMPV3_PRIV_PROTOCOL);
  const privPassword = process.env.ORBIS_SNMPV3_PRIV_PASSWORD?.trim();

  if ((level === 'authNoPriv' || level === 'authPriv') && (!authProtocol || !authPassword)) {
    throw new Error('SNMPv3 authNoPriv/authPriv requires ORBIS_SNMPV3_AUTH_PROTOCOL and ORBIS_SNMPV3_AUTH_PASSWORD');
  }
  if (level === 'authPriv' && (!privProtocol || !privPassword)) {
    throw new Error('SNMPv3 authPriv requires ORBIS_SNMPV3_PRIV_PROTOCOL and ORBIS_SNMPV3_PRIV_PASSWORD');
  }

  return {
    username,
    level,
    authProtocol,
    authPassword,
    privProtocol,
    privPassword,
  };
}

function buildSnmpV3User(config: SnmpV3Config): snmp.User {
  const user: snmp.User = {
    name: config.username,
    level: snmp.SecurityLevel[config.level],
  };
  if (config.authProtocol && config.authPassword) {
    user.authProtocol = snmp.AuthProtocols[config.authProtocol];
    user.authKey = config.authPassword;
  }
  if (config.privProtocol && config.privPassword) {
    user.privProtocol = snmp.PrivProtocols[config.privProtocol];
    user.privKey = config.privPassword;
  }
  return user;
}

function parseSnmpV3Level(value?: string): SnmpV3Config['level'] {
  const normalized = (value ?? 'authPriv').trim();
  if (normalized === 'noAuthNoPriv' || normalized === 'authNoPriv' || normalized === 'authPriv') return normalized;
  throw new Error(`Invalid ORBIS_SNMPV3_LEVEL: ${value}`);
}

function parseSnmpV3AuthProtocol(value?: string): SnmpV3Config['authProtocol'] | undefined {
  if (!value?.trim()) return undefined;
  const normalized = value.trim().toLowerCase();
  if (['md5', 'sha', 'sha224', 'sha256', 'sha384', 'sha512'].includes(normalized)) {
    return normalized as SnmpV3Config['authProtocol'];
  }
  throw new Error(`Invalid ORBIS_SNMPV3_AUTH_PROTOCOL: ${value}`);
}

function parseSnmpV3PrivProtocol(value?: string): SnmpV3Config['privProtocol'] | undefined {
  if (!value?.trim()) return undefined;
  const normalized = value.trim().toLowerCase();
  if (['des', 'aes', 'aes256b', 'aes256r'].includes(normalized)) {
    return normalized as SnmpV3Config['privProtocol'];
  }
  throw new Error(`Invalid ORBIS_SNMPV3_PRIV_PROTOCOL: ${value}`);
}

function parseList(value?: string): string[] {
  return (value ?? '').split(/[,\s;]+/).map((item) => item.trim()).filter(Boolean);
}

function parsePorts(value?: string): number[] | null {
  const ports = parseList(value).map(Number).filter((port) => Number.isInteger(port) && port >= 1 && port <= 65_535);
  return ports.length ? unique(ports).slice(0, 128) : null;
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function toInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : fallback;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function expandCidr(cidr: string): string[] {
  const match = cidr.match(/^((?:\d{1,3}\.){3}\d{1,3})\/(\d|[12]\d|3[0-2])$/);
  if (!match) throw new Error(`Invalid CIDR: ${cidr}`);
  const base = ipv4ToInt(match[1]);
  const prefix = Number(match[2]);
  const blockSize = 2 ** (32 - prefix);
  const mask = prefix === 0 ? 0 : (0xffffffff - blockSize + 1) >>> 0;
  const network = (base & mask) >>> 0;
  const broadcast = (network + blockSize - 1) >>> 0;
  const first = prefix <= 30 ? network + 1 : network;
  const last = prefix <= 30 ? broadcast - 1 : broadcast;
  const hosts: string[] = [];
  for (let value = first; value <= last; value += 1) hosts.push(intToIpv4(value));
  return hosts;
}

function ipv4ToInt(ip: string): number {
  const octets = ip.split('.').map(Number);
  if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) {
    throw new Error(`Invalid IPv4 address: ${ip}`);
  }
  return octets.reduce((acc, octet) => acc * 256 + octet, 0) >>> 0;
}

function intToIpv4(value: number): string {
  return [
    (value >>> 24) & 255,
    (value >>> 16) & 255,
    (value >>> 8) & 255,
    value & 255,
  ].join('.');
}

function normalizeMac(value: string): string {
  const hex = value.toLowerCase().replace(/[^0-9a-f]/g, '');
  return hex.length === 12 ? hex.match(/.{1,2}/g)!.join(':') : value.toLowerCase();
}

function normalizeMaybeMac(value?: string | null): string | null {
  if (!value) return null;
  const normalized = normalizeMac(value);
  return normalized === '00:00:00:00:00:00' ? null : normalized;
}

function isIpv4(value: string): boolean {
  const octets = value.split('.').map(Number);
  return octets.length === 4 && octets.every((octet) => Number.isInteger(octet) && octet >= 0 && octet <= 255);
}

function getByIndex(table: Map<string, string>, index: number): string | null {
  const suffix = `.${index}`;
  for (const [oid, value] of table) {
    if (oid.endsWith(suffix)) return value || null;
  }
  return null;
}

function toOptionalNumber(value?: string | null): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function inferVendor(value?: string | null): string | null {
  if (!value) return null;
  const lower = value.toLowerCase();
  if (lower.includes('cisco')) return 'Cisco';
  if (lower.includes('juniper')) return 'Juniper';
  if (lower.includes('aruba') || lower.includes('procurve')) return 'HPE Aruba';
  if (lower.includes('ubiquiti') || lower.includes('unifi')) return 'Ubiquiti';
  if (lower.includes('fortinet')) return 'Fortinet';
  if (lower.includes('palo alto')) return 'Palo Alto';
  if (lower.includes('mikrotik')) return 'MikroTik';
  if (lower.includes('synology')) return 'Synology';
  return null;
}

function inferModel(value?: string | null): string | null {
  if (!value) return null;
  const cisco = value.match(/(?:Cisco IOS Software, )?([^,\n]+(?:C\d{3,5}|ISR\d{3,4}|ASR\d{3,4})[^,\n]*)/i)?.[1];
  if (cisco) return cisco.trim().slice(0, 120);
  const generic = value.match(/(?:model|product|hardware)[:\s]+([A-Za-z0-9._ -]{3,80})/i)?.[1];
  return generic?.trim().slice(0, 120) ?? null;
}

function dedupeLinks(links: LinkResult[]): LinkResult[] {
  const seen = new Set<string>();
  return links.filter((link) => {
    const key = [link.localDevice, link.localPort, link.remoteDevice, link.remotePort].map((value) => value ?? '').join('|');
    const reverse = [link.remoteDevice, link.remotePort, link.localDevice, link.localPort].map((value) => value ?? '').join('|');
    if (seen.has(key) || seen.has(reverse)) return false;
    seen.add(key);
    return true;
  });
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function dedupeBy<T>(items: T[], keyFn: (item: T) => string): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = keyFn(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function mapLimit<T, R>(items: T[], limit: number, mapper: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await mapper(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((err) => {
  console.error('[collector] fatal', err);
  process.exit(1);
});
