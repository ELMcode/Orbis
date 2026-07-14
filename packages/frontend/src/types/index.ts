// Shared types mirroring the Prisma schema.

export type Role = 'ADMIN' | 'EDITOR' | 'VIEWER';

export interface Organization {
  id: string;
  name: string;
  slug: string;
  role: Role;
  permissions?: string[];
  plan?: string;
}

export type DeviceType =
  | 'SWITCH'
  | 'ROUTER'
  | 'FIREWALL'
  | 'SERVER'
  | 'HYPERVISOR'
  | 'WORKSTATION'
  | 'PRINTER'
  | 'CAMERA'
  | 'CONTROLLER'
  | 'PATCH_PANEL'
  | 'MODEM'
  | 'PHONE'
  | 'IOT'
  | 'OT'
  | 'NAS'
  | 'SAN'
  | 'PDU'
  | 'UPS'
  | 'ACCESS_POINT'
  | 'LOAD_BALANCER'
  | 'INTERNET'
  | 'CLOUD'
  | 'VM'
  | 'RACK'
  | 'OTHER';

export type DeviceStatus = 'ONLINE' | 'WARNING' | 'OFFLINE' | 'MAINTENANCE' | 'UNKNOWN';
export type DeviceLifecycleStatus =
  'PLANNED' | 'IN_SERVICE' | 'MAINTENANCE' | 'END_OF_SUPPORT' | 'REPLACEMENT_DUE' | 'RETIRED';

export type PortType =
  'ETHERNET' | 'FIBER' | 'SFP' | 'SFP_PLUS' | 'QSFP' | 'CONSOLE' | 'USB' | 'POWER' | 'OTHER';

export interface User {
  id: string;
  name: string;
  email: string;
  avatarUrl?: string | null;
  active?: boolean;
  createdAt?: string;
}

export interface Member {
  id: string;
  userId: string;
  name: string;
  email: string;
  role: Role;
  status: 'ACTIVE' | 'INVITED';
  avatarUrl?: string | null;
  active?: boolean;
  joinedAt?: string;
  permissions: string[];
}

// Extended /auth/me response including the user's scope.
export interface AuthMeResponse {
  user: User;
  organizations: Organization[];
}

export interface Site {
  id: string;
  name: string;
  description?: string | null;
  parentId?: string | null;
  location?: string | null;
  createdAt: string;
  updatedAt: string;
  _count?: { diagrams: number; devices: number; children: number };
  children?: Site[]; // Frontend-only tree representation.
}

export interface Device {
  id: string;
  name: string;
  type: DeviceType;
  status: DeviceStatus;
  siteId?: string | null;
  diagramId?: string | null;
  diagramNodeId?: string | null;
  brand?: string | null;
  model?: string | null;
  serial?: string | null;
  assetTag?: string | null;
  ip?: string | null;
  mac?: string | null;
  vlan?: string | null;
  location?: string | null;
  notes?: string | null;
  purchaseDate?: string | null;
  warrantyEnd?: string | null;
  supportEnd?: string | null;
  replacementDue?: string | null;
  lifecycleStatus?: DeviceLifecycleStatus;
  owner?: string | null;
  cost?: number | null;
  tags: string[];
  customFields?: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
  site?: Pick<Site, 'id' | 'name'> | null;
  ports?: Port[];
  images?: DeviceImage[];
  attachments?: Attachment[];
  rackSlot?: (RackSlot & { rack: Rack }) | null;
  _count?: { ports: number; images: number; attachments: number };
}

export type ApplicationDependencyType =
  | 'APPLICATION'
  | 'DATABASE'
  | 'SERVICE'
  | 'NETWORK'
  | 'EXTERNAL'
  | 'STORAGE'
  | 'SECURITY'
  | 'OTHER';
export type ApplicationDependencyStatus = 'ACTIVE' | 'DEGRADED' | 'DEPRECATED' | 'UNKNOWN';
export type Criticality = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export interface ApplicationDependency {
  id: string;
  name: string;
  dependencyType: ApplicationDependencyType;
  status: ApplicationDependencyStatus;
  criticality: Criticality;
  sourceDeviceId?: string | null;
  targetDeviceId?: string | null;
  sourceName?: string | null;
  targetName?: string | null;
  protocol?: string | null;
  port?: number | null;
  description?: string | null;
  owner?: string | null;
  tags: string[];
  customFields?: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
  sourceDevice?: Pick<Device, 'id' | 'name' | 'siteId'> & {
    site?: Pick<Site, 'id' | 'name'> | null;
  };
  targetDevice?: Pick<Device, 'id' | 'name' | 'siteId'> & {
    site?: Pick<Site, 'id' | 'name'> | null;
  };
}

export type AssetContractType =
  'LICENSE' | 'SUPPORT' | 'MAINTENANCE' | 'WARRANTY' | 'SUBSCRIPTION' | 'SERVICE' | 'OTHER';
export type AssetContractStatus = 'ACTIVE' | 'EXPIRING' | 'EXPIRED' | 'TERMINATED' | 'DRAFT';

export interface AssetContract {
  id: string;
  deviceId?: string | null;
  name: string;
  type: AssetContractType;
  status: AssetContractStatus;
  vendor?: string | null;
  contractNumber?: string | null;
  seatsTotal?: number | null;
  seatsUsed?: number | null;
  startDate?: string | null;
  endDate?: string | null;
  renewalDate?: string | null;
  owner?: string | null;
  cost?: number | null;
  notes?: string | null;
  tags: string[];
  customFields?: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
  device?: Pick<Device, 'id' | 'name' | 'siteId'> & { site?: Pick<Site, 'id' | 'name'> | null };
}

export type CustomFieldTarget =
  'DEVICE' | 'SITE' | 'IP_PREFIX' | 'IP_ADDRESS' | 'CONTRACT' | 'DEPENDENCY';
export type CustomFieldType = 'TEXT' | 'NUMBER' | 'BOOLEAN' | 'DATE' | 'URL' | 'SELECT';

export interface CustomFieldDefinition {
  id: string;
  target: CustomFieldTarget;
  key: string;
  label: string;
  type: CustomFieldType;
  required: boolean;
  options: string[];
  defaultValue?: unknown;
  description?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TagDefinition {
  id: string;
  name: string;
  color: string;
  description?: string | null;
  createdAt: string;
  updatedAt: string;
}

export type SavedViewTarget =
  'DEVICES' | 'SITES' | 'IPAM' | 'DCIM' | 'CONTRACTS' | 'DEPENDENCIES' | 'DISCOVERY';

export interface SavedView {
  id: string;
  name: string;
  target: SavedViewTarget;
  filters: Record<string, unknown>;
  columns: string[];
  shared: boolean;
  createdAt: string;
  updatedAt: string;
  createdBy?: Pick<User, 'id' | 'name' | 'email'> | null;
}

export interface Port {
  id: string;
  deviceId: string;
  label: string;
  portType: PortType;
  speed?: string | null;
  connectedPortId?: string | null;
  vlan?: string | null;
  description?: string | null;
}

export interface DeviceImage {
  id: string;
  deviceId: string;
  path: string;
  mimeType: string;
  thumbPath?: string | null;
  caption?: string | null;
  sortOrder: number;
  createdAt: string;
}

export interface Attachment {
  id: string;
  deviceId: string;
  filename: string;
  path: string;
  mimeType: string;
  size: number;
  createdAt: string;
}

export interface Diagram {
  id: string;
  name: string;
  siteId?: string | null;
  nodes: any[];
  edges: any[];
  viewport?: any;
  version: number;
  createdAt: string;
  updatedAt: string;
  site?: Pick<Site, 'id' | 'name'> | null;
  _count?: { history: number };
}

export interface DiagramVersion {
  id: string;
  diagramId: string;
  nodes: any[];
  edges: any[];
  message?: string | null;
  createdAt: string;
}

export interface DiagramComment {
  id: string;
  diagramId: string;
  body: string;
  x?: number | null;
  y?: number | null;
  resolved: boolean;
  createdAt: string;
  updatedAt: string;
  user?: Pick<User, 'id' | 'name' | 'email'> | null;
}

export type EntityCommentTarget = 'DEVICE' | 'IP_PREFIX' | 'IP_ADDRESS';

export interface EntityComment {
  id: string;
  targetType: EntityCommentTarget;
  deviceId?: string | null;
  ipPrefixId?: string | null;
  ipAddressId?: string | null;
  body: string;
  resolved: boolean;
  createdAt: string;
  updatedAt: string;
  user?: Pick<User, 'id' | 'name' | 'email'> | null;
}

export type DiscoveryFormat = 'AUTO' | 'LINKS_CSV' | 'CDP' | 'LLDP' | 'ARP';

export interface DiscoveryImportResult {
  devicesCreated: number;
  devicesMatched: number;
  linksDiscovered: number;
  ipAddressesCreated: number;
  ipAddressesMatched: number;
  hostsScanned?: number;
  hostsUp?: number;
  openPorts?: Array<{
    address: string;
    ports: number[];
    deviceId?: string | null;
    deviceName: string;
    created: boolean;
  }>;
  diagram?: Diagram | null;
}

export type DiscoveryCollectorStatus = 'ACTIVE' | 'PAUSED' | 'REVOKED' | 'ERROR';
export type DiscoveryCollectorRole = 'PRIMARY' | 'SECONDARY' | 'STANDBY';
export type DiscoveryRunStatus = 'SUCCESS' | 'PARTIAL' | 'FAILED';
export type DiscoveryDeviceState = 'ONLINE' | 'DOWN' | 'UNKNOWN';
export type DiscoveryEventType =
  | 'NEW_DEVICE'
  | 'DEVICE_REAPPEARED'
  | 'DEVICE_DOWN'
  | 'IP_CHANGED'
  | 'PORTS_CHANGED'
  | 'IP_CONFLICT'
  | 'MAC_CONFLICT'
  | 'LATENCY_HIGH';
export type DiscoveryEventSeverity = 'INFO' | 'WARNING' | 'CRITICAL';
export type AlertDeliveryStatus = 'PENDING' | 'SENT' | 'FAILED' | 'SKIPPED';
export type AlertChannel = 'EMAIL' | 'WEBHOOK' | 'SLACK' | 'TEAMS';
export type IncidentStatus = 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED';
export type PublicApiScope = 'read:inventory' | 'read:ipam' | 'read:events';
export type PublicApiKeyStatus = 'ACTIVE' | 'REVOKED';
export type WebhookEndpointStatus = 'ACTIVE' | 'PAUSED';
export type WebhookDeliveryStatus = 'PENDING' | 'SENT' | 'FAILED';

export interface PublicApiKey {
  id: string;
  name: string;
  tokenPrefix: string;
  scopes: PublicApiScope[];
  status: PublicApiKeyStatus;
  expiresAt?: string | null;
  lastUsedAt?: string | null;
  createdAt: string;
}

export interface WebhookEndpoint {
  id: string;
  name: string;
  url: string;
  events: string[];
  status: WebhookEndpointStatus;
  lastSuccessAt?: string | null;
  lastFailureAt?: string | null;
  createdAt: string;
  _count?: { deliveries: number };
}

export interface WebhookDelivery {
  id: string;
  eventType: string;
  status: WebhookDeliveryStatus;
  statusCode?: number | null;
  error?: string | null;
  deliveredAt?: string | null;
  createdAt: string;
}

export interface DiscoveryRun {
  id: string;
  status: DiscoveryRunStatus;
  summary: {
    hostsSeen?: number;
    snmpHosts?: number;
    linksSeen?: number;
    cdpLinks?: number;
    lldpLinks?: number;
    arpEntries?: number;
    macEntries?: number;
    vlansSeen?: number;
    confidenceAverage?: number;
    ipConflicts?: number;
    macConflicts?: number;
    devicesCreated?: number;
    devicesUpdated?: number;
    devicesMatched?: number;
    ipAddressesCreated?: number;
    ipAddressesMatched?: number;
    eventsCreated?: number;
    newDevices?: number;
    downDevices?: number;
    reappearedDevices?: number;
    portChanges?: number;
    ipChanges?: number;
    cidrs?: string[];
    ports?: number[];
    [key: string]: unknown;
  };
  startedAt?: string | null;
  finishedAt?: string | null;
  createdAt: string;
}

export interface DiscoveryCollector {
  id: string;
  name: string;
  siteId?: string | null;
  status: DiscoveryCollectorStatus;
  role: DiscoveryCollectorRole;
  priority: number;
  failoverAfterMinutes: number;
  tokenRotationDays?: number | null;
  tokenLastRotatedAt?: string | null;
  tokenExpiresAt?: string | null;
  nextTokenRotationAt?: string | null;
  tokenRotationDue?: boolean;
  tokenExpiresSoon?: boolean;
  failoverState?: 'PRIMARY' | 'STALE_PRIMARY' | 'READY' | 'STANDBY' | 'UNAVAILABLE';
  defaultCidrs: string[];
  defaultPorts: number[];
  autoDiagram?: boolean;
  version?: string | null;
  lastSeenAt?: string | null;
  lastIp?: string | null;
  lastSummary?: DiscoveryRun['summary'] | null;
  notes?: string | null;
  createdAt: string;
  updatedAt: string;
  site?: Pick<Site, 'id' | 'name'> | null;
  runs?: DiscoveryRun[];
  states?: Array<{
    id: string;
    status: DiscoveryDeviceState;
    firstSeenAt: string;
    lastSeenAt: string;
    lastAddress?: string | null;
    lastHostname?: string | null;
    lastPorts: number[];
    missCount: number;
    device: Pick<Device, 'id' | 'name' | 'type' | 'status' | 'ip'>;
  }>;
  events?: DiscoveryEvent[];
  logs?: DiscoveryCollectorLog[];
}

export interface DiscoveryCollectorLog {
  id: string;
  level: 'INFO' | 'WARNING' | 'ERROR' | 'DIAGNOSTIC';
  message: string;
  meta?: Record<string, unknown> | null;
  createdAt: string;
}

export interface DiscoveryEvent {
  id: string;
  type: DiscoveryEventType;
  severity: DiscoveryEventSeverity;
  title: string;
  message?: string | null;
  meta?: Record<string, unknown> | null;
  acknowledgedAt?: string | null;
  acknowledgedBy?: Pick<User, 'id' | 'name' | 'email'> | null;
  createdAt: string;
  site?: Pick<Site, 'id' | 'name'> | null;
  collector?: { id: string; name: string } | null;
  device?: Pick<Device, 'id' | 'name' | 'type' | 'ip'> | null;
  deliveries?: AlertDelivery[];
}

export interface AlertDelivery {
  id: string;
  channel: AlertChannel;
  status: AlertDeliveryStatus;
  target?: string | null;
  error?: string | null;
  sentAt?: string | null;
  createdAt: string;
}

export interface AlertSettings {
  id: string;
  emailEnabled: boolean;
  emailRecipients: string[];
  webhookEnabled: boolean;
  webhookUrl?: string | null;
  slackEnabled: boolean;
  slackWebhookUrl?: string | null;
  teamsEnabled: boolean;
  teamsWebhookUrl?: string | null;
  minSeverity: DiscoveryEventSeverity;
  eventTypes: DiscoveryEventType[];
  includeResolvedInfo: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface MonitoringPolicy {
  id: string;
  availabilityTargetPct: number;
  latencyWarningMs: number;
  latencyCriticalMs: number;
  latencyAlertsEnabled: boolean;
  measurementRetentionDays: number;
  incidentAutoResolve: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface MaintenanceWindow {
  id: string;
  title: string;
  siteId?: string | null;
  deviceId?: string | null;
  startsAt: string;
  endsAt: string;
  notes?: string | null;
  createdAt: string;
  updatedAt: string;
  site?: Pick<Site, 'id' | 'name'> | null;
  device?: Pick<Device, 'id' | 'name' | 'type' | 'ip'> | null;
}

export interface Incident {
  id: string;
  title: string;
  severity: DiscoveryEventSeverity;
  status: IncidentStatus;
  source: string;
  sourceEventId?: string | null;
  openedAt: string;
  acknowledgedAt?: string | null;
  resolvedAt?: string | null;
  lastEventAt: string;
  notes?: string | null;
  site?: Pick<Site, 'id' | 'name'> | null;
  device?: Pick<Device, 'id' | 'name' | 'type' | 'ip'> | null;
}

export interface AvailabilitySummary {
  days: number;
  total: number;
  up: number;
  down: number;
  availabilityPct: number;
  targetPct: number;
  targetMet: boolean;
  latencyAvgMs?: number | null;
  latencyP95Ms?: number | null;
}

export type SecurityRiskSeverity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type SecurityRiskCategory =
  | 'RISKY_PORT'
  | 'UNKNOWN_DEVICE'
  | 'MISSING_SITE'
  | 'MISSING_OWNER'
  | 'FIRMWARE_UNKNOWN'
  | 'FIRMWARE_OBSOLETE'
  | 'WEAK_SNMP'
  | 'IP_CONFLICT'
  | 'MAC_CONFLICT'
  | 'COLLECTOR_SECRET';

export interface SecurityPolicy {
  id: string;
  requireDeviceSite: boolean;
  requireDeviceOwner: boolean;
  riskyPorts: number[];
  criticalPorts: number[];
  weakSnmpCommunities: string[];
  firmwareUnknownDays: number;
  warrantyWarningDays: number;
  collectorTokenMaxAgeDays: number;
  createdAt: string;
  updatedAt: string;
}

export interface SecurityRisk {
  id: string;
  category: SecurityRiskCategory;
  severity: SecurityRiskSeverity;
  status: 'OPEN' | 'ACKNOWLEDGED';
  title: string;
  description: string;
  remediation: string;
  site?: Pick<Site, 'id' | 'name'> | null;
  device?: Pick<Device, 'id' | 'name' | 'ip' | 'type'> | null;
  collector?: { id: string; name: string } | null;
  evidence: Record<string, unknown>;
  detectedAt: string;
}

export interface SecuritySummary {
  score: number;
  counts: { total: number; critical: number; high: number; medium: number; low: number };
  byCategory: Record<string, number>;
  risks: SecurityRisk[];
}

export interface AuditLog {
  id: string;
  action: string;
  target?: string | null;
  targetId?: string | null;
  meta?: Record<string, unknown> | null;
  ip?: string | null;
  createdAt: string;
  user?: Pick<User, 'id' | 'name' | 'email'> | null;
}

export type ReportFormat = 'CSV' | 'PDF';
export type ReportType =
  'INVENTORY' | 'IPAM' | 'CHANGES' | 'TOPOLOGY' | 'AVAILABILITY' | 'RISKS' | 'CAPACITY';
export type ReportFrequency = 'WEEKLY' | 'MONTHLY' | 'QUARTERLY';

export interface ReportSchedule {
  id: string;
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
  nextRunAt?: string | null;
  lastRunAt?: string | null;
  createdAt: string;
  updatedAt: string;
  site?: Pick<Site, 'id' | 'name'> | null;
}

export interface Rack {
  id: string;
  name: string;
  siteId?: string | null;
  totalUnits: number;
  description?: string | null;
  createdAt: string;
  updatedAt: string;
  site?: Pick<Site, 'id' | 'name'> | null;
  slots?: (RackSlot & { device: Device })[];
  _count?: { slots: number };
}

export interface RackSlot {
  id: string;
  rackId: string;
  deviceId: string;
  startUnit: number;
  units: number;
  device?: Device;
}

export type IpAddressStatus = 'RESERVED' | 'ASSIGNED' | 'DHCP' | 'DEPRECATED' | 'UNKNOWN';

export interface Vlan {
  id: string;
  vlanId: number;
  name: string;
  siteId?: string | null;
  description?: string | null;
  createdAt: string;
  updatedAt: string;
  site?: Pick<Site, 'id' | 'name'> | null;
  _count?: { prefixes: number };
}

export interface Vrf {
  id: string;
  name: string;
  rd?: string | null;
  siteId?: string | null;
  description?: string | null;
  createdAt: string;
  updatedAt: string;
  site?: Pick<Site, 'id' | 'name'> | null;
  _count?: { prefixes: number };
}

export interface IpPrefix {
  id: string;
  cidr: string;
  name?: string | null;
  siteId?: string | null;
  vlanId?: string | null;
  vrfId?: string | null;
  gateway?: string | null;
  description?: string | null;
  createdAt: string;
  updatedAt: string;
  site?: Pick<Site, 'id' | 'name'> | null;
  vlan?: Pick<Vlan, 'id' | 'vlanId' | 'name'> | null;
  vrf?: Pick<Vrf, 'id' | 'name' | 'rd'> | null;
  _count?: { addresses: number };
}

export interface IpAddress {
  id: string;
  address: string;
  status: IpAddressStatus;
  siteId?: string | null;
  prefixId?: string | null;
  deviceId?: string | null;
  dnsName?: string | null;
  interfaceLabel?: string | null;
  reservedBy?: string | null;
  reservationExpiresAt?: string | null;
  description?: string | null;
  createdAt: string;
  updatedAt: string;
  site?: Pick<Site, 'id' | 'name'> | null;
  prefix?:
    | (Pick<IpPrefix, 'id' | 'cidr' | 'name'> & { vrf?: Pick<Vrf, 'id' | 'name' | 'rd'> | null })
    | null;
  device?: Pick<Device, 'id' | 'name' | 'type'> | null;
}

export interface Provider {
  id: string;
  name: string;
  contactName?: string | null;
  contactEmail?: string | null;
  supportPhone?: string | null;
  portalUrl?: string | null;
  notes?: string | null;
  createdAt: string;
  updatedAt: string;
  _count?: { circuits: number };
}

export interface Circuit {
  id: string;
  siteId?: string | null;
  providerId?: string | null;
  name: string;
  circuitId?: string | null;
  type?: string | null;
  status: string;
  bandwidthMbps?: number | null;
  demarcation?: string | null;
  installDate?: string | null;
  renewalDate?: string | null;
  monthlyCost?: number | null;
  notes?: string | null;
  createdAt: string;
  updatedAt: string;
  site?: Pick<Site, 'id' | 'name'> | null;
  provider?: Pick<Provider, 'id' | 'name'> | null;
  _count?: { cables: number };
}

export interface PatchPanel {
  id: string;
  siteId?: string | null;
  rackId?: string | null;
  name: string;
  portsCount: number;
  description?: string | null;
  createdAt: string;
  updatedAt: string;
  site?: Pick<Site, 'id' | 'name'> | null;
  rack?: Pick<Rack, 'id' | 'name'> | null;
}

export interface Cable {
  id: string;
  circuitId?: string | null;
  label: string;
  cableType: string;
  status: string;
  lengthMeters?: number | null;
  aDeviceId?: string | null;
  aPortLabel?: string | null;
  aPatchPanelId?: string | null;
  aPatchPort?: string | null;
  bDeviceId?: string | null;
  bPortLabel?: string | null;
  bPatchPanelId?: string | null;
  bPatchPort?: string | null;
  notes?: string | null;
  createdAt: string;
  updatedAt: string;
  circuit?: Pick<Circuit, 'id' | 'name' | 'circuitId'> | null;
  aDevice?: Pick<Device, 'id' | 'name' | 'type' | 'ip'> | null;
  bDevice?: Pick<Device, 'id' | 'name' | 'type' | 'ip'> | null;
  aPatchPanel?: Pick<PatchPanel, 'id' | 'name'> | null;
  bPatchPanel?: Pick<PatchPanel, 'id' | 'name'> | null;
}

// ─── Custom React Flow node ────────────────────────────────
export interface DeviceNodeData {
  label: string;
  deviceType: DeviceType;
  status?: DeviceStatus;
  deviceId?: string | null;
  ip?: string;
  brand?: string;
  model?: string;
  autoLayout?: boolean;
  positionLocked?: boolean;
  topologyRank?: number;
  [key: string]: unknown;
}

export interface DeviceNode {
  id: string;
  type: 'device';
  position: { x: number; y: number };
  data: DeviceNodeData;
  width?: number;
  height?: number;
  selected?: boolean;
}

export interface CableEdgeData {
  cableType?: PortType;
  label?: string;
  speed?: string;
  vlan?: string;
  protocol?: string;
  layer?: string;
  confidence?: number;
  localPort?: string;
  remotePort?: string;
  discovered?: boolean;
  validationStatus?: 'PENDING' | 'APPROVED' | 'REJECTED';
  notes?: string;
  [key: string]: unknown;
}

export interface CableEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
  type?: 'cable';
  animated?: boolean;
  data?: CableEdgeData;
}
