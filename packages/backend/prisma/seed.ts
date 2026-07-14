import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

const ADMIN_EMAIL = 'admin.test@orbis.local';
const EDITOR_EMAIL = 'editor.test@orbis.local';
const VIEWER_EMAIL = 'viewer.test@orbis.local';
const PASSWORDS = {
  admin: 'AdminTest123!',
  editor: 'EditorTest123!',
  viewer: 'ViewerTest123!',
};

async function main() {
  console.log('Seed Orbis demo complete...');
  await resetDatabase();

  const uploadDir = process.env.UPLOAD_DIR ?? './uploads';
  await createDemoFiles(uploadDir);

  const organization = await prisma.organization.create({
    data: {
      name: 'Acme Infrastructure Groupe',
      slug: 'acme-infra-demo',
      plan: 'ENTERPRISE',
      stripeCustomerId: 'cus_demo_enterprise_acme',
    },
  });

  const admin = await prisma.user.create({
    data: {
      name: 'Camille Martin',
      email: ADMIN_EMAIL,
      passwordHash: await bcrypt.hash(PASSWORDS.admin, 12),
      avatarUrl: null,
    },
  });
  const editor = await prisma.user.create({
    data: {
      name: 'Nadia Benali',
      email: EDITOR_EMAIL,
      passwordHash: await bcrypt.hash(PASSWORDS.editor, 12),
      avatarUrl: null,
    },
  });
  const viewer = await prisma.user.create({
    data: {
      name: 'Thomas Leroy',
      email: VIEWER_EMAIL,
      passwordHash: await bcrypt.hash(PASSWORDS.viewer, 12),
      avatarUrl: null,
    },
  });

  const adminMembership = await prisma.membership.create({
    data: { userId: admin.id, organizationId: organization.id, role: 'ADMIN', status: 'ACTIVE' },
  });
  const editorMembership = await prisma.membership.create({
    data: { userId: editor.id, organizationId: organization.id, role: 'EDITOR', status: 'ACTIVE' },
  });
  const viewerMembership = await prisma.membership.create({
    data: { userId: viewer.id, organizationId: organization.id, role: 'VIEWER', status: 'ACTIVE' },
  });

  await prisma.invitation.createMany({
    data: [
      {
        organizationId: organization.id,
        email: 'secops@acme.example',
        role: 'EDITOR',
        tokenHash: hashToken('invite-secops-demo'),
        expiresAt: daysFromNow(10),
      },
      {
        organizationId: organization.id,
        email: 'audit@acme.example',
        role: 'VIEWER',
        tokenHash: hashToken('invite-audit-demo'),
        expiresAt: daysFromNow(14),
      },
    ],
  });

  const sites = await createSites(organization.id, admin.id);
  await prisma.userSite.create({ data: { membershipId: editorMembership.id, siteId: sites.france.id } });
  await prisma.userSite.create({ data: { membershipId: viewerMembership.id, siteId: sites.parisDc.id } });

  await prisma.securityPolicy.create({
    data: {
      organizationId: organization.id,
      requireDeviceSite: true,
      requireDeviceOwner: true,
      riskyPorts: [21, 22, 23, 25, 53, 80, 110, 143, 161, 389, 443, 445, 1433, 3306, 5432, 5900, 6379, 9200, 27017],
      criticalPorts: [23, 445, 3389, 5900, 6379, 9200, 27017],
      weakSnmpCommunities: ['public', 'private', 'acme-public'],
      firmwareUnknownDays: 45,
      warrantyWarningDays: 120,
      collectorTokenMaxAgeDays: 120,
    },
  });

  const providers = await createProviders(organization.id);
  const racks = await createRacks(organization.id, sites);
  const devices = await createDevices(organization.id, sites, admin.id, editor.id);
  await createRackSlots(racks, devices);
  const ports = await createPorts(devices);
  await createIpam(organization.id, sites, devices);
  const dcim = await createDcim(organization.id, sites, racks, devices, providers);
  const diagrams = await createDiagrams(organization.id, sites, devices, ports, admin.id);
  await createMedia(devices, uploadDir);
  await createDiscovery(organization.id, sites, devices, admin.id);
  await createReports(organization.id, sites);
  await createAuditTrail(organization.id, admin.id, editor.id, viewer.id, diagrams.main.id, dcim.coreWan.id);

  console.log('Seed termine.');
  console.log(`Admin  : ${ADMIN_EMAIL} / ${PASSWORDS.admin}`);
  console.log(`Editor : ${EDITOR_EMAIL} / ${PASSWORDS.editor}`);
  console.log(`Viewer : ${VIEWER_EMAIL} / ${PASSWORDS.viewer}`);
}

async function resetDatabase() {
  console.log('Reset complet des donnees applicatives...');
  await prisma.userSite.deleteMany();
  await prisma.auditToken.deleteMany();
  await prisma.passwordResetToken.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.alertDelivery.deleteMany();
  await prisma.discoveryCollectorLog.deleteMany();
  await prisma.discoveryEvent.deleteMany();
  await prisma.discoveryState.deleteMany();
  await prisma.discoveryRun.deleteMany();
  await prisma.discoveryCollector.deleteMany();
  await prisma.alertSettings.deleteMany();
  await prisma.reportSchedule.deleteMany();
  await prisma.securityPolicy.deleteMany();
  await prisma.diagramComment.deleteMany();
  await prisma.attachment.deleteMany();
  await prisma.deviceImage.deleteMany();
  await prisma.port.deleteMany();
  await prisma.cable.deleteMany();
  await prisma.patchPanel.deleteMany();
  await prisma.circuit.deleteMany();
  await prisma.provider.deleteMany();
  await prisma.rackSlot.deleteMany();
  await prisma.rack.deleteMany();
  await prisma.diagramVersion.deleteMany();
  await prisma.diagram.deleteMany();
  await prisma.ipAddress.deleteMany();
  await prisma.ipPrefix.deleteMany();
  await prisma.vrf.deleteMany();
  await prisma.vlan.deleteMany();
  await prisma.device.deleteMany();
  await prisma.site.deleteMany();
  await prisma.membership.deleteMany();
  await prisma.invitation.deleteMany();
  await prisma.organization.deleteMany();
  await prisma.user.deleteMany();
}

async function createSites(organizationId: string, createdById: string) {
  const france = await prisma.site.create({
    data: {
      organizationId,
      name: 'France',
      description: 'Perimetre national : siege, datacenter, agences et entrepots.',
      location: 'France',
      createdById,
    },
  });
  const parisCampus = await prisma.site.create({
    data: {
      organizationId,
      name: 'Campus Paris',
      description: 'Siege social, bureaux, salles de reunion et plateau support.',
      location: 'Paris 8e',
      parentId: france.id,
      createdById,
    },
  });
  const parisDc = await prisma.site.create({
    data: {
      organizationId,
      name: 'Datacenter Paris DC1',
      description: 'Salle production principale avec coeur reseau, stockage et hyperviseurs.',
      location: 'Paris - sous-sol securise',
      parentId: parisCampus.id,
      createdById,
    },
  });
  const lyon = await prisma.site.create({
    data: {
      organizationId,
      name: 'Agence Lyon',
      description: 'Agence regionale avec lien SD-WAN et Wi-Fi invite.',
      location: 'Lyon Part-Dieu',
      parentId: france.id,
      createdById,
    },
  });
  const lilleWarehouse = await prisma.site.create({
    data: {
      organizationId,
      name: 'Entrepot Lille',
      description: 'Site industriel avec reseau OT, cameras et terminaux logistiques.',
      location: 'Lille',
      parentId: france.id,
      createdById,
    },
  });
  const belgium = await prisma.site.create({
    data: {
      organizationId,
      name: 'Belgique',
      description: 'Perimetre international de reprise d activite.',
      location: 'Belgique',
      createdById,
    },
  });
  const brusselsDr = await prisma.site.create({
    data: {
      organizationId,
      name: 'Bruxelles DR',
      description: 'Site de reprise avec stockage replique et lien WAN dedie.',
      location: 'Bruxelles',
      parentId: belgium.id,
      createdById,
    },
  });

  return { france, parisCampus, parisDc, lyon, lilleWarehouse, belgium, brusselsDr };
}

async function createProviders(organizationId: string) {
  const orange = await prisma.provider.create({
    data: {
      organizationId,
      name: 'Orange Business',
      contactName: 'Support Entreprise',
      contactEmail: 'support.enterprise@orange.example',
      supportPhone: '+33 1 70 00 00 00',
      portalUrl: 'https://portal.orange-business.example',
      notes: 'MPLS principal, SLA 99.95%, escalade NOC prioritaire.',
    },
  });
  const equinix = await prisma.provider.create({
    data: {
      organizationId,
      name: 'Equinix Fabric',
      contactName: 'Service Delivery',
      contactEmail: 'fabric-support@equinix.example',
      portalUrl: 'https://fabric.equinix.example',
      notes: 'Interconnexion cloud privee vers Azure et AWS.',
    },
  });
  const proximus = await prisma.provider.create({
    data: {
      organizationId,
      name: 'Proximus',
      contactName: 'NOC Proximus',
      contactEmail: 'noc@proximus.example',
      supportPhone: '+32 2 000 00 00',
      notes: 'Lien Bruxelles DR.',
    },
  });
  return { orange, equinix, proximus };
}

async function createRacks(organizationId: string, sites: Awaited<ReturnType<typeof createSites>>) {
  const coreRack = await prisma.rack.create({
    data: {
      organizationId,
      name: 'PAR-DC1-R01 - Core',
      siteId: sites.parisDc.id,
      totalUnits: 42,
      description: 'Baie production : edge, coeur reseau, hyperviseurs, stockage.',
    },
  });
  const serverRack = await prisma.rack.create({
    data: {
      organizationId,
      name: 'PAR-DC1-R02 - Compute',
      siteId: sites.parisDc.id,
      totalUnits: 42,
      description: 'Baie compute et backup.',
    },
  });
  const brusselsRack = await prisma.rack.create({
    data: {
      organizationId,
      name: 'BRU-DR-R01',
      siteId: sites.brusselsDr.id,
      totalUnits: 24,
      description: 'Armoire reprise d activite Bruxelles.',
    },
  });
  const lyonRack = await prisma.rack.create({
    data: {
      organizationId,
      name: 'LYO-IDF-R01',
      siteId: sites.lyon.id,
      totalUnits: 18,
      description: 'Armoire agence Lyon.',
    },
  });
  return { coreRack, serverRack, brusselsRack, lyonRack };
}

async function createDevices(organizationId: string, sites: Awaited<ReturnType<typeof createSites>>, adminId: string, editorId: string) {
  const common = { organizationId, editedById: adminId };
  const fwEdge = await prisma.device.create({
    data: {
      ...common,
      name: 'PAR-FW-EDGE-01',
      type: 'FIREWALL',
      status: 'ONLINE',
      siteId: sites.parisDc.id,
      brand: 'Fortinet',
      model: 'FortiGate 200F',
      serial: 'FG200F-DEMO-001',
      ip: '10.0.0.1',
      mac: '00:09:0f:aa:00:01',
      location: 'PAR-DC1-R01 U40',
      owner: 'Equipe Reseau',
      cost: 8200,
      warrantyEnd: new Date('2028-03-15'),
      tags: ['edge', 'firewall', 'vpn', 'production'],
      notes: 'Cluster HA actif/passif, terminaison VPN et filtrage perimetrique.',
    },
  });
  const fwEdgeBackup = await prisma.device.create({
    data: {
      ...common,
      name: 'PAR-FW-EDGE-02',
      type: 'FIREWALL',
      status: 'ONLINE',
      siteId: sites.parisDc.id,
      brand: 'Fortinet',
      model: 'FortiGate 200F',
      serial: 'FG200F-DEMO-002',
      ip: '10.0.0.2',
      mac: '00:09:0f:aa:00:02',
      location: 'PAR-DC1-R01 U39',
      owner: 'Equipe Reseau',
      cost: 8200,
      warrantyEnd: new Date('2028-03-15'),
      tags: ['edge', 'firewall', 'ha', 'production'],
      notes: 'Second membre du cluster HA.',
    },
  });
  const core1 = await prisma.device.create({
    data: {
      ...common,
      name: 'PAR-SW-CORE-01',
      type: 'SWITCH',
      status: 'ONLINE',
      siteId: sites.parisDc.id,
      brand: 'Cisco',
      model: 'Catalyst 9500-48Y4C',
      serial: 'C9500-DEMO-001',
      ip: '10.0.0.10',
      mac: '00:1a:2b:00:00:10',
      location: 'PAR-DC1-R01 U37',
      owner: 'Equipe Reseau',
      cost: 23800,
      warrantyEnd: new Date('2029-01-20'),
      tags: ['core', 'routing', '25g', 'production'],
      notes: 'Coeur L3, VRF PROD/GUEST/MGMT, uplinks 100G.',
    },
  });
  const core2 = await prisma.device.create({
    data: {
      ...common,
      name: 'PAR-SW-CORE-02',
      type: 'SWITCH',
      status: 'ONLINE',
      siteId: sites.parisDc.id,
      brand: 'Cisco',
      model: 'Catalyst 9500-48Y4C',
      serial: 'C9500-DEMO-002',
      ip: '10.0.0.11',
      mac: '00:1a:2b:00:00:11',
      location: 'PAR-DC1-R01 U36',
      owner: 'Equipe Reseau',
      cost: 23800,
      warrantyEnd: new Date('2029-01-20'),
      tags: ['core', 'redundant', 'production'],
      notes: 'Second coeur L3 en StackWise Virtual.',
    },
  });
  const dist = await prisma.device.create({
    data: {
      ...common,
      name: 'PAR-SW-DIST-01',
      type: 'SWITCH',
      status: 'WARNING',
      siteId: sites.parisCampus.id,
      brand: 'Aruba',
      model: 'CX 6300M',
      serial: 'A6300-DEMO-001',
      ip: '10.0.1.10',
      mac: '98:4b:e1:00:01:10',
      location: 'Local technique 2e etage',
      owner: 'Equipe Reseau',
      cost: 7100,
      warrantyEnd: new Date('2027-09-01'),
      tags: ['distribution', 'campus', 'poe'],
      notes: 'Alerte decouverte : ports utilisateurs changes depuis le dernier scan.',
    },
  });
  const hyperv1 = await prisma.device.create({
    data: {
      ...common,
      editedById: editorId,
      name: 'PAR-HV-01',
      type: 'HYPERVISOR',
      status: 'WARNING',
      siteId: sites.parisDc.id,
      brand: 'Dell',
      model: 'PowerEdge R650',
      serial: 'R650-DEMO-001',
      ip: '10.0.10.11',
      mac: '00:15:5d:00:10:11',
      location: 'PAR-DC1-R02 U22',
      owner: 'Equipe Systeme',
      cost: 14300,
      warrantyEnd: daysFromNow(75),
      tags: ['compute', 'hypervisor', 'vmware'],
      notes: 'Hote de virtualisation, garantie proche expiration.',
    },
  });
  const hyperv2 = await prisma.device.create({
    data: {
      ...common,
      editedById: editorId,
      name: 'PAR-HV-02',
      type: 'HYPERVISOR',
      status: 'ONLINE',
      siteId: sites.parisDc.id,
      brand: 'Dell',
      model: 'PowerEdge R650',
      serial: 'R650-DEMO-002',
      ip: '10.0.10.12',
      mac: '00:15:5d:00:10:12',
      location: 'PAR-DC1-R02 U20',
      owner: 'Equipe Systeme',
      cost: 14300,
      warrantyEnd: new Date('2028-11-30'),
      tags: ['compute', 'hypervisor', 'vmware'],
      notes: 'Hote de virtualisation principal.',
    },
  });
  const erpVm = await prisma.device.create({
    data: {
      ...common,
      editedById: editorId,
      name: 'VM-ERP-PROD-01',
      type: 'VM',
      status: 'ONLINE',
      siteId: sites.parisDc.id,
      brand: 'VMware',
      model: 'vSphere VM',
      serial: 'vm-erp-prod-01',
      ip: '10.0.30.21',
      mac: '00:50:56:aa:30:21',
      location: 'Cluster Paris Production',
      owner: 'Equipe Applicative',
      tags: ['erp', 'vm', 'critical'],
      notes: 'Application ERP coeur metier.',
    },
  });
  const nas = await prisma.device.create({
    data: {
      ...common,
      editedById: editorId,
      name: 'PAR-NAS-BACKUP-01',
      type: 'NAS',
      status: 'ONLINE',
      siteId: sites.parisDc.id,
      brand: 'Synology',
      model: 'RS3621xs+',
      serial: 'SYNO-DEMO-001',
      ip: '10.0.20.50',
      mac: '00:11:32:00:20:50',
      location: 'PAR-DC1-R02 U14',
      owner: 'Equipe Stockage',
      cost: 6900,
      warrantyEnd: new Date('2029-05-01'),
      tags: ['backup', 'storage', 'nfs'],
      notes: 'Sauvegardes Veeam, retention 30 jours.',
    },
  });
  const san = await prisma.device.create({
    data: {
      ...common,
      name: 'PAR-SAN-01',
      type: 'SAN',
      status: 'ONLINE',
      siteId: sites.parisDc.id,
      brand: 'Pure Storage',
      model: 'FlashArray X20',
      serial: 'PURE-DEMO-001',
      ip: '10.0.20.60',
      mac: '24:a9:37:00:20:60',
      location: 'PAR-DC1-R02 U10',
      owner: 'Equipe Stockage',
      cost: 49000,
      warrantyEnd: new Date('2028-06-30'),
      tags: ['storage', 'iscsi', 'critical'],
      notes: 'Stockage primaire VM.',
    },
  });
  const ups = await prisma.device.create({
    data: {
      ...common,
      name: 'PAR-UPS-01',
      type: 'UPS',
      status: 'ONLINE',
      siteId: sites.parisDc.id,
      brand: 'APC',
      model: 'Smart-UPS SRT 6000',
      serial: 'APC-DEMO-001',
      ip: '10.0.90.10',
      mac: '00:c0:b7:00:90:10',
      location: 'PAR-DC1-R01 U02',
      owner: 'Facilities',
      cost: 5200,
      warrantyEnd: new Date('2027-04-10'),
      tags: ['power', 'ups'],
      notes: 'Autonomie estimee 26 minutes.',
    },
  });
  const pdu = await prisma.device.create({
    data: {
      ...common,
      name: 'PAR-PDU-R01-A',
      type: 'PDU',
      status: 'ONLINE',
      siteId: sites.parisDc.id,
      brand: 'Raritan',
      model: 'PX3',
      serial: 'PDU-DEMO-001',
      ip: '10.0.90.20',
      mac: '00:0d:5d:00:90:20',
      location: 'PAR-DC1-R01 cote A',
      owner: 'Facilities',
      tags: ['power', 'metered'],
      notes: 'PDU mesure par prise.',
    },
  });
  const controller = await prisma.device.create({
    data: {
      ...common,
      name: 'PAR-WLC-01',
      type: 'CONTROLLER',
      status: 'ONLINE',
      siteId: sites.parisCampus.id,
      brand: 'Cisco',
      model: 'Catalyst 9800-CL',
      serial: 'C9800CL-DEMO',
      ip: '10.0.40.2',
      mac: '00:50:56:00:40:02',
      location: 'Cluster Paris Production',
      owner: 'Equipe Reseau',
      tags: ['wifi', 'controller'],
      notes: 'Controleur Wi-Fi campus.',
    },
  });
  const apParis = await prisma.device.create({
    data: {
      ...common,
      name: 'PAR-AP-OPENSPACE-01',
      type: 'ACCESS_POINT',
      status: 'ONLINE',
      siteId: sites.parisCampus.id,
      brand: 'Cisco',
      model: 'Catalyst 9166',
      serial: 'AP9166-DEMO-001',
      ip: '10.0.40.21',
      mac: '88:1d:fc:00:40:21',
      location: 'Open-space 3e etage',
      owner: 'Equipe Reseau',
      tags: ['wifi', 'poe', 'campus'],
      notes: 'BSSID principal utilisateurs et invite.',
    },
  });
  const printer = await prisma.device.create({
    data: {
      ...common,
      name: 'PAR-PRN-FINANCE-01',
      type: 'PRINTER',
      status: 'ONLINE',
      siteId: sites.parisCampus.id,
      brand: 'Ricoh',
      model: 'IM C4500',
      serial: 'RICOH-DEMO-001',
      ip: '10.0.50.30',
      mac: '58:38:79:00:50:30',
      location: 'Finance - 4e etage',
      owner: 'Support IT',
      tags: ['printer', 'user-lan'],
      notes: 'Imprimante departement finance.',
    },
  });
  const camera = await prisma.device.create({
    data: {
      ...common,
      name: 'PAR-CAM-LOBBY-01',
      type: 'CAMERA',
      status: 'ONLINE',
      siteId: sites.parisCampus.id,
      brand: 'Axis',
      model: 'P3265-LV',
      serial: 'AXIS-DEMO-001',
      ip: '10.0.60.41',
      mac: 'ac:cc:8e:00:60:41',
      location: 'Hall accueil',
      owner: 'Securite physique',
      tags: ['camera', 'iot', 'vlan-60'],
      notes: 'Flux RTSP isole sur VLAN securite.',
    },
  });
  const workstation = await prisma.device.create({
    data: {
      ...common,
      name: 'PAR-PC-FIN-042',
      type: 'WORKSTATION',
      status: 'ONLINE',
      siteId: sites.parisCampus.id,
      brand: 'Lenovo',
      model: 'ThinkPad T14',
      serial: 'LEN-DEMO-042',
      ip: '10.0.50.142',
      mac: '8c:16:45:00:50:42',
      location: 'Finance',
      owner: 'Julie Simon',
      tags: ['endpoint', 'finance', 'managed'],
      notes: 'Poste gere par MDM, EDR actif.',
    },
  });
  const lyonRouter = await prisma.device.create({
    data: {
      ...common,
      name: 'LYO-RTR-SDWAN-01',
      type: 'ROUTER',
      status: 'ONLINE',
      siteId: sites.lyon.id,
      brand: 'Cisco',
      model: 'C1111-8P',
      serial: 'C1111-DEMO-LYO',
      ip: '10.20.0.1',
      mac: '00:42:68:20:00:01',
      location: 'LYO-IDF-R01 U16',
      owner: 'Equipe Reseau',
      cost: 1800,
      warrantyEnd: new Date('2028-02-12'),
      tags: ['sdwan', 'branch'],
      notes: 'Routeur agence Lyon, double acces fibre/4G.',
    },
  });
  const lyonSwitch = await prisma.device.create({
    data: {
      ...common,
      name: 'LYO-SW-ACCESS-01',
      type: 'SWITCH',
      status: 'ONLINE',
      siteId: sites.lyon.id,
      brand: 'Aruba',
      model: 'CX 6200F',
      serial: 'A6200-DEMO-LYO',
      ip: '10.20.0.10',
      mac: '98:4b:e1:20:00:10',
      location: 'LYO-IDF-R01 U14',
      owner: 'Equipe Reseau',
      tags: ['access', 'branch', 'poe'],
      notes: 'Switch acces 48 ports PoE.',
    },
  });
  const otGateway = await prisma.device.create({
    data: {
      ...common,
      name: 'LIL-OT-GW-01',
      type: 'OT',
      status: 'WARNING',
      siteId: sites.lilleWarehouse.id,
      brand: 'Moxa',
      model: 'UC-8112',
      serial: 'MOXA-DEMO-001',
      ip: '10.30.10.5',
      mac: '00:90:e8:30:10:05',
      location: 'Local automatisme',
      owner: 'Equipe Industrie',
      tags: ['ot', 'industrial', 'needs-review'],
      notes: 'Firmware non renseigne, ports industriels decouverts.',
    },
  });
  const iotSensor = await prisma.device.create({
    data: {
      ...common,
      name: 'LIL-IOT-TEMP-17',
      type: 'IOT',
      status: 'ONLINE',
      siteId: sites.lilleWarehouse.id,
      brand: 'Milesight',
      model: 'EM300-TH',
      serial: 'IOT-DEMO-017',
      ip: '10.30.20.17',
      mac: '24:e1:24:30:20:17',
      location: 'Zone froide',
      owner: 'Facilities',
      tags: ['iot', 'temperature'],
      notes: 'Sonde temperature/humidite.',
    },
  });
  const brRouter = await prisma.device.create({
    data: {
      ...common,
      name: 'BRU-RTR-EDGE-01',
      type: 'ROUTER',
      status: 'ONLINE',
      siteId: sites.brusselsDr.id,
      brand: 'Juniper',
      model: 'SRX345',
      serial: 'SRX-DEMO-BRU',
      ip: '10.40.0.1',
      mac: '3c:61:04:40:00:01',
      location: 'BRU-DR-R01 U20',
      owner: 'Equipe Reseau',
      cost: 3900,
      warrantyEnd: new Date('2028-08-05'),
      tags: ['dr', 'edge'],
      notes: 'Routeur de reprise Bruxelles.',
    },
  });
  const brNas = await prisma.device.create({
    data: {
      ...common,
      editedById: editorId,
      name: 'BRU-NAS-REPLICA-01',
      type: 'NAS',
      status: 'MAINTENANCE',
      siteId: sites.brusselsDr.id,
      brand: 'QNAP',
      model: 'TS-h1886XU',
      serial: 'QNAP-DEMO-BRU',
      ip: '10.40.20.50',
      mac: '00:08:9b:40:20:50',
      location: 'BRU-DR-R01 U12',
      owner: 'Equipe Stockage',
      cost: 7300,
      warrantyEnd: new Date('2027-12-15'),
      tags: ['dr', 'replication', 'storage'],
      notes: 'Replica quotidienne depuis Paris, maintenance disque planifiee.',
    },
  });
  const cloudAzure = await prisma.device.create({
    data: {
      ...common,
      name: 'AZURE-VNET-HUB-WEU',
      type: 'CLOUD',
      status: 'ONLINE',
      siteId: sites.parisDc.id,
      brand: 'Microsoft Azure',
      model: 'Virtual WAN Hub',
      ip: '10.80.0.1',
      location: 'West Europe',
      owner: 'Cloud Center of Excellence',
      cost: 1250,
      tags: ['cloud', 'azure', 'wan'],
      notes: 'Hub cloud connecte via Equinix Fabric.',
    },
  });
  const internet = await prisma.device.create({
    data: {
      ...common,
      name: 'Internet',
      type: 'INTERNET',
      status: 'ONLINE',
      siteId: sites.parisDc.id,
      owner: 'Operateurs',
      tags: ['external'],
      notes: 'Representation logique des liens externes.',
    },
  });

  return {
    fwEdge,
    fwEdgeBackup,
    core1,
    core2,
    dist,
    hyperv1,
    hyperv2,
    erpVm,
    nas,
    san,
    ups,
    pdu,
    controller,
    apParis,
    printer,
    camera,
    workstation,
    lyonRouter,
    lyonSwitch,
    otGateway,
    iotSensor,
    brRouter,
    brNas,
    cloudAzure,
    internet,
  };
}

async function createRackSlots(racks: Awaited<ReturnType<typeof createRacks>>, devices: Awaited<ReturnType<typeof createDevices>>) {
  await prisma.rackSlot.createMany({
    data: [
      { rackId: racks.coreRack.id, deviceId: devices.fwEdge.id, startUnit: 40, units: 1 },
      { rackId: racks.coreRack.id, deviceId: devices.fwEdgeBackup.id, startUnit: 39, units: 1 },
      { rackId: racks.coreRack.id, deviceId: devices.core1.id, startUnit: 37, units: 1 },
      { rackId: racks.coreRack.id, deviceId: devices.core2.id, startUnit: 36, units: 1 },
      { rackId: racks.coreRack.id, deviceId: devices.ups.id, startUnit: 2, units: 3 },
      { rackId: racks.serverRack.id, deviceId: devices.hyperv1.id, startUnit: 22, units: 1 },
      { rackId: racks.serverRack.id, deviceId: devices.hyperv2.id, startUnit: 20, units: 1 },
      { rackId: racks.serverRack.id, deviceId: devices.nas.id, startUnit: 14, units: 2 },
      { rackId: racks.serverRack.id, deviceId: devices.san.id, startUnit: 10, units: 2 },
      { rackId: racks.brusselsRack.id, deviceId: devices.brRouter.id, startUnit: 20, units: 1 },
      { rackId: racks.brusselsRack.id, deviceId: devices.brNas.id, startUnit: 12, units: 4 },
      { rackId: racks.lyonRack.id, deviceId: devices.lyonRouter.id, startUnit: 16, units: 1 },
      { rackId: racks.lyonRack.id, deviceId: devices.lyonSwitch.id, startUnit: 14, units: 1 },
    ],
  });
}

async function createPorts(devices: Awaited<ReturnType<typeof createDevices>>) {
  const p = {
    internetWan: await port(devices.internet.id, 'Transit Orange', 'FIBER', '10G', 'Lien operateur principal'),
    fwWan1: await port(devices.fwEdge.id, 'wan1', 'SFP_PLUS', '10G', 'Transit Orange'),
    fwHa: await port(devices.fwEdge.id, 'ha1', 'ETHERNET', '1G', 'Sync HA'),
    fwLan: await port(devices.fwEdge.id, 'x1', 'SFP_PLUS', '25G', 'Vers coeur reseau'),
    fw2Ha: await port(devices.fwEdgeBackup.id, 'ha1', 'ETHERNET', '1G', 'Sync HA'),
    fw2Lan: await port(devices.fwEdgeBackup.id, 'x1', 'SFP_PLUS', '25G', 'Vers coeur reseau'),
    core1Fw: await port(devices.core1.id, 'Te1/0/1', 'SFP_PLUS', '25G', 'Vers firewall primaire'),
    core2Fw: await port(devices.core2.id, 'Te1/0/1', 'SFP_PLUS', '25G', 'Vers firewall secondaire'),
    core1Core2: await port(devices.core1.id, 'Hu1/0/49', 'QSFP', '100G', 'VSL vers core 02'),
    core2Core1: await port(devices.core2.id, 'Hu1/0/49', 'QSFP', '100G', 'VSL vers core 01'),
    core1Hv1: await port(devices.core1.id, 'Te1/0/11', 'SFP_PLUS', '25G', 'Vers PAR-HV-01'),
    hv1Nic: await port(devices.hyperv1.id, 'vmnic0', 'SFP_PLUS', '25G', 'Uplink A'),
    core2Hv2: await port(devices.core2.id, 'Te1/0/12', 'SFP_PLUS', '25G', 'Vers PAR-HV-02'),
    hv2Nic: await port(devices.hyperv2.id, 'vmnic0', 'SFP_PLUS', '25G', 'Uplink A'),
    core1Nas: await port(devices.core1.id, 'Te1/0/21', 'SFP_PLUS', '10G', 'Vers NAS backup'),
    nasNic: await port(devices.nas.id, 'LAN1', 'SFP_PLUS', '10G', 'Uplink backup'),
    core2San: await port(devices.core2.id, 'Te1/0/22', 'SFP_PLUS', '25G', 'Vers SAN'),
    sanNic: await port(devices.san.id, 'ct0.eth2', 'SFP_PLUS', '25G', 'iSCSI A'),
    core1Dist: await port(devices.core1.id, 'Te1/0/31', 'SFP_PLUS', '10G', 'Vers distribution campus'),
    distCore: await port(devices.dist.id, '1/1/49', 'SFP_PLUS', '10G', 'Vers coeur DC'),
    distAp: await port(devices.dist.id, '1/1/10', 'ETHERNET', '1G', 'AP open-space'),
    apPort: await port(devices.apParis.id, 'eth0', 'ETHERNET', '1G', 'PoE'),
    distPrinter: await port(devices.dist.id, '1/1/24', 'ETHERNET', '1G', 'Imprimante finance'),
    printerPort: await port(devices.printer.id, 'eth0', 'ETHERNET', '1G', 'LAN'),
    lyonWan: await port(devices.lyonRouter.id, 'Gig0/0/0', 'ETHERNET', '1G', 'WAN fibre'),
    lyonLan: await port(devices.lyonRouter.id, 'Gig0/0/1', 'ETHERNET', '1G', 'LAN agence'),
    lyonSwUplink: await port(devices.lyonSwitch.id, '1/1/48', 'SFP', '1G', 'Vers routeur'),
    brWan: await port(devices.brRouter.id, 'ge-0/0/0', 'SFP_PLUS', '1G', 'Lien DR'),
    brNas: await port(devices.brNas.id, 'LAN1', 'SFP_PLUS', '10G', 'Replication'),
    azurePrivate: await port(devices.cloudAzure.id, 'private-peering', 'FIBER', '1G', 'Equinix Fabric'),
  };

  await connect(p.internetWan.id, p.fwWan1.id);
  await connect(p.fwHa.id, p.fw2Ha.id);
  await connect(p.fwLan.id, p.core1Fw.id);
  await connect(p.fw2Lan.id, p.core2Fw.id);
  await connect(p.core1Core2.id, p.core2Core1.id);
  await connect(p.core1Hv1.id, p.hv1Nic.id);
  await connect(p.core2Hv2.id, p.hv2Nic.id);
  await connect(p.core1Nas.id, p.nasNic.id);
  await connect(p.core2San.id, p.sanNic.id);
  await connect(p.core1Dist.id, p.distCore.id);
  await connect(p.distAp.id, p.apPort.id);
  await connect(p.distPrinter.id, p.printerPort.id);
  await connect(p.lyonLan.id, p.lyonSwUplink.id);

  return p;
}

async function port(deviceId: string, label: string, portType: 'ETHERNET' | 'FIBER' | 'SFP' | 'SFP_PLUS' | 'QSFP' | 'CONSOLE' | 'USB' | 'POWER' | 'OTHER', speed: string, description: string) {
  return prisma.port.create({ data: { deviceId, label, portType, speed, description } });
}

async function connect(a: string, b: string) {
  await prisma.port.update({ where: { id: a }, data: { connectedPortId: b } });
  await prisma.port.update({ where: { id: b }, data: { connectedPortId: a } });
}

async function createIpam(organizationId: string, sites: Awaited<ReturnType<typeof createSites>>, devices: Awaited<ReturnType<typeof createDevices>>) {
  const vrfProd = await prisma.vrf.create({
    data: { organizationId, siteId: sites.parisDc.id, name: 'PROD', rd: '65000:10', description: 'VRF production applications et serveurs.' },
  });
  const vrfMgmt = await prisma.vrf.create({
    data: { organizationId, siteId: sites.parisDc.id, name: 'MGMT', rd: '65000:90', description: 'Administration reseau, power, supervision.' },
  });
  const vrfGuest = await prisma.vrf.create({
    data: { organizationId, siteId: sites.parisCampus.id, name: 'GUEST', rd: '65000:200', description: 'Wi-Fi invite isole.' },
  });
  const vrfDr = await prisma.vrf.create({
    data: { organizationId, siteId: sites.brusselsDr.id, name: 'DR', rd: '65000:40', description: 'Plan de reprise Bruxelles.' },
  });

  const vlans = await prisma.$transaction([
    prisma.vlan.create({ data: { organizationId, siteId: sites.parisDc.id, vlanId: 10, name: 'Servers PROD', description: 'Serveurs et hyperviseurs production.' } }),
    prisma.vlan.create({ data: { organizationId, siteId: sites.parisDc.id, vlanId: 20, name: 'Storage', description: 'Stockage backup et iSCSI.' } }),
    prisma.vlan.create({ data: { organizationId, siteId: sites.parisCampus.id, vlanId: 40, name: 'Wi-Fi Corp', description: 'Points d acces et controleur Wi-Fi.' } }),
    prisma.vlan.create({ data: { organizationId, siteId: sites.parisCampus.id, vlanId: 50, name: 'Users Finance', description: 'Postes et imprimantes finance.' } }),
    prisma.vlan.create({ data: { organizationId, siteId: sites.lilleWarehouse.id, vlanId: 310, name: 'OT Supervision', description: 'Passerelles industrielles.' } }),
    prisma.vlan.create({ data: { organizationId, siteId: sites.brusselsDr.id, vlanId: 410, name: 'DR Storage', description: 'Stockage DR.' } }),
    prisma.vlan.create({ data: { organizationId, siteId: sites.parisDc.id, vlanId: 90, name: 'Management', description: 'Supervision et administration.' } }),
  ]);

  const [vlanServers, vlanStorage, vlanWifi, vlanFinance, vlanOt, vlanDrStorage, vlanMgmt] = vlans;
  const prefixes = await prisma.$transaction([
    prisma.ipPrefix.create({ data: { organizationId, siteId: sites.parisDc.id, vlanId: vlanServers.id, vrfId: vrfProd.id, cidr: '10.0.10.0/24', name: 'PAR-DC1 Servers', gateway: '10.0.10.1', description: 'Serveurs production Paris.' } }),
    prisma.ipPrefix.create({ data: { organizationId, siteId: sites.parisDc.id, vlanId: vlanStorage.id, vrfId: vrfProd.id, cidr: '10.0.20.0/24', name: 'PAR-DC1 Storage', gateway: '10.0.20.1', description: 'Stockage et backup.' } }),
    prisma.ipPrefix.create({ data: { organizationId, siteId: sites.parisCampus.id, vlanId: vlanWifi.id, vrfId: vrfProd.id, cidr: '10.0.40.0/24', name: 'Campus Wi-Fi corp', gateway: '10.0.40.1' } }),
    prisma.ipPrefix.create({ data: { organizationId, siteId: sites.parisCampus.id, vlanId: vlanFinance.id, vrfId: vrfProd.id, cidr: '10.0.50.0/24', name: 'Campus Finance', gateway: '10.0.50.1' } }),
    prisma.ipPrefix.create({ data: { organizationId, siteId: sites.parisCampus.id, vlanId: vlanWifi.id, vrfId: vrfGuest.id, cidr: '172.16.40.0/22', name: 'Wi-Fi invite', gateway: '172.16.40.1' } }),
    prisma.ipPrefix.create({ data: { organizationId, siteId: sites.lilleWarehouse.id, vlanId: vlanOt.id, vrfId: vrfProd.id, cidr: '10.30.10.0/24', name: 'Lille OT', gateway: '10.30.10.1' } }),
    prisma.ipPrefix.create({ data: { organizationId, siteId: sites.brusselsDr.id, vlanId: vlanDrStorage.id, vrfId: vrfDr.id, cidr: '10.40.20.0/24', name: 'Bruxelles DR Storage', gateway: '10.40.20.1' } }),
    prisma.ipPrefix.create({ data: { organizationId, siteId: sites.parisDc.id, vlanId: vlanMgmt.id, vrfId: vrfMgmt.id, cidr: '10.0.90.0/24', name: 'Management Paris', gateway: '10.0.90.1' } }),
  ]);

  const [servers, storage, wifi, finance, guest, ot, drStorage, mgmt] = prefixes;
  await prisma.ipAddress.createMany({
    data: [
      ip(organizationId, sites.parisDc.id, mgmt.id, devices.fwEdge.id, '10.0.0.1', 'ASSIGNED', 'par-fw-edge-01.acme.local', 'wan/mgmt', 'Firewall primaire'),
      ip(organizationId, sites.parisDc.id, mgmt.id, devices.core1.id, '10.0.0.10', 'ASSIGNED', 'par-sw-core-01.acme.local', 'mgmt0', 'Switch coeur 1'),
      ip(organizationId, sites.parisDc.id, mgmt.id, devices.core2.id, '10.0.0.11', 'ASSIGNED', 'par-sw-core-02.acme.local', 'mgmt0', 'Switch coeur 2'),
      ip(organizationId, sites.parisDc.id, servers.id, devices.hyperv1.id, '10.0.10.11', 'ASSIGNED', 'par-hv-01.acme.local', 'vmnic0', 'Hyperviseur 1'),
      ip(organizationId, sites.parisDc.id, servers.id, devices.hyperv2.id, '10.0.10.12', 'ASSIGNED', 'par-hv-02.acme.local', 'vmnic0', 'Hyperviseur 2'),
      ip(organizationId, sites.parisDc.id, servers.id, devices.erpVm.id, '10.0.30.21', 'ASSIGNED', 'erp-prod-01.acme.local', 'eth0', 'ERP production'),
      ip(organizationId, sites.parisDc.id, storage.id, devices.nas.id, '10.0.20.50', 'ASSIGNED', 'par-nas-backup-01.acme.local', 'LAN1', 'NAS backup'),
      ip(organizationId, sites.parisDc.id, storage.id, devices.san.id, '10.0.20.60', 'ASSIGNED', 'par-san-01.acme.local', 'ct0.eth2', 'SAN primaire'),
      ip(organizationId, sites.parisDc.id, mgmt.id, devices.ups.id, '10.0.90.10', 'ASSIGNED', 'par-ups-01.acme.local', 'mgmt', 'UPS'),
      ip(organizationId, sites.parisCampus.id, wifi.id, devices.controller.id, '10.0.40.2', 'ASSIGNED', 'par-wlc-01.acme.local', 'mgmt', 'Controleur Wi-Fi'),
      ip(organizationId, sites.parisCampus.id, wifi.id, devices.apParis.id, '10.0.40.21', 'DHCP', 'par-ap-openspace-01.acme.local', 'eth0', 'AP open-space'),
      ip(organizationId, sites.parisCampus.id, finance.id, devices.printer.id, '10.0.50.30', 'ASSIGNED', 'par-prn-finance-01.acme.local', 'eth0', 'Imprimante finance'),
      ip(organizationId, sites.parisCampus.id, finance.id, devices.workstation.id, '10.0.50.142', 'DHCP', 'par-pc-fin-042.acme.local', 'wlan0', 'Poste finance'),
      ip(organizationId, sites.parisCampus.id, guest.id, null, '172.16.40.10', 'RESERVED', 'guest-room-101.acme.local', null, 'Reservation salle formation', 'Accueil IT', daysFromNow(30)),
      ip(organizationId, sites.lilleWarehouse.id, ot.id, devices.otGateway.id, '10.30.10.5', 'ASSIGNED', 'lil-ot-gw-01.acme.local', 'eth0', 'Passerelle OT'),
      ip(organizationId, sites.lilleWarehouse.id, ot.id, devices.iotSensor.id, '10.30.20.17', 'DHCP', 'lil-iot-temp-17.acme.local', 'wlan0', 'Sonde temperature'),
      ip(organizationId, sites.brusselsDr.id, drStorage.id, devices.brNas.id, '10.40.20.50', 'ASSIGNED', 'bru-nas-replica-01.acme.local', 'LAN1', 'Replica DR'),
      ip(organizationId, sites.brusselsDr.id, drStorage.id, null, '10.40.20.88', 'DEPRECATED', 'old-backup-bru.acme.local', null, 'Ancienne cible backup a retirer'),
    ],
  });
}

function ip(
  organizationId: string,
  siteId: string,
  prefixId: string,
  deviceId: string | null,
  address: string,
  status: 'RESERVED' | 'ASSIGNED' | 'DHCP' | 'DEPRECATED' | 'UNKNOWN',
  dnsName: string,
  interfaceLabel: string | null,
  description: string,
  reservedBy?: string,
  reservationExpiresAt?: Date,
) {
  return { organizationId, siteId, prefixId, deviceId, address, status, dnsName, interfaceLabel, description, reservedBy, reservationExpiresAt };
}

async function createDcim(
  organizationId: string,
  sites: Awaited<ReturnType<typeof createSites>>,
  racks: Awaited<ReturnType<typeof createRacks>>,
  devices: Awaited<ReturnType<typeof createDevices>>,
  providers: Awaited<ReturnType<typeof createProviders>>,
) {
  const coreWan = await prisma.circuit.create({
    data: {
      organizationId,
      siteId: sites.parisDc.id,
      providerId: providers.orange.id,
      name: 'PAR-DC1 MPLS Principal',
      circuitId: 'OBS-MPLS-PAR-10G-001',
      type: 'MPLS',
      status: 'ACTIVE',
      bandwidthMbps: 10000,
      demarcation: 'MMR Paris DC1 - baie operateur',
      installDate: new Date('2025-01-12'),
      renewalDate: new Date('2028-01-12'),
      monthlyCost: 4200,
      notes: 'Lien principal production, SLA 99.95%.',
    },
  });
  const cloudWan = await prisma.circuit.create({
    data: {
      organizationId,
      siteId: sites.parisDc.id,
      providerId: providers.equinix.id,
      name: 'Equinix Fabric Azure',
      circuitId: 'EQX-FAB-AZURE-WEU-1G',
      type: 'Cloud Connect',
      status: 'ACTIVE',
      bandwidthMbps: 1000,
      demarcation: 'PAR-DC1-R01 patch PNL-WAN port 08',
      installDate: new Date('2025-09-01'),
      renewalDate: new Date('2027-09-01'),
      monthlyCost: 950,
      notes: 'Peering prive hub Azure West Europe.',
    },
  });
  const drWan = await prisma.circuit.create({
    data: {
      organizationId,
      siteId: sites.brusselsDr.id,
      providerId: providers.proximus.id,
      name: 'BRU DR Ethernet',
      circuitId: 'PROX-BRU-ETH-1G-DR',
      type: 'Ethernet',
      status: 'ACTIVE',
      bandwidthMbps: 1000,
      demarcation: 'BRU-DR-R01 panneau WAN',
      installDate: new Date('2024-11-20'),
      renewalDate: new Date('2027-11-20'),
      monthlyCost: 780,
      notes: 'Lien reprise d activite Bruxelles.',
    },
  });

  const patchCore = await prisma.patchPanel.create({
    data: { organizationId, siteId: sites.parisDc.id, rackId: racks.coreRack.id, name: 'PAR-DC1-R01-PP-WAN', portsCount: 24, description: 'Panneau operateurs et interco cloud.' },
  });
  const patchServer = await prisma.patchPanel.create({
    data: { organizationId, siteId: sites.parisDc.id, rackId: racks.serverRack.id, name: 'PAR-DC1-R02-PP-SERVER', portsCount: 48, description: 'Brassage serveurs et stockage.' },
  });
  const patchBrussels = await prisma.patchPanel.create({
    data: { organizationId, siteId: sites.brusselsDr.id, rackId: racks.brusselsRack.id, name: 'BRU-DR-R01-PP-WAN', portsCount: 24, description: 'Brassage WAN et DR.' },
  });

  await prisma.cable.createMany({
    data: [
      cable(organizationId, coreWan.id, 'WAN-PAR-OBS-001', 'FIBER', 18, null, 'Transit Orange', patchCore.id, '01', devices.fwEdge.id, 'wan1', null, null, 'Liaison operateur vers firewall primaire.'),
      cable(organizationId, null, 'CORE-FW-25G-A', 'DAC', 2, devices.fwEdge.id, 'x1', null, null, devices.core1.id, 'Te1/0/1', null, null, 'DAC 25G firewall primaire vers core 01.'),
      cable(organizationId, null, 'CORE-FW-25G-B', 'DAC', 2, devices.fwEdgeBackup.id, 'x1', null, null, devices.core2.id, 'Te1/0/1', null, null, 'DAC 25G firewall secondaire vers core 02.'),
      cable(organizationId, null, 'CORE-VSL-100G-01', 'FIBER', 3, devices.core1.id, 'Hu1/0/49', null, null, devices.core2.id, 'Hu1/0/49', null, null, 'VSL 100G coeur redondant.'),
      cable(organizationId, null, 'HV01-UPLINK-A', 'FIBER', 8, devices.core1.id, 'Te1/0/11', null, null, devices.hyperv1.id, 'vmnic0', patchServer.id, '11', 'Uplink compute host 01.'),
      cable(organizationId, null, 'NAS-BACKUP-10G', 'FIBER', 7, devices.core1.id, 'Te1/0/21', null, null, devices.nas.id, 'LAN1', patchServer.id, '21', 'Trafic backup.'),
      cable(organizationId, cloudWan.id, 'EQX-AZURE-PRIVATE', 'FIBER', 12, devices.cloudAzure.id, 'private-peering', patchCore.id, '08', devices.core1.id, 'Te1/0/35', null, null, 'Interconnexion cloud privee.'),
      cable(organizationId, drWan.id, 'BRU-WAN-DR-001', 'FIBER', 10, null, 'Proximus NTE', patchBrussels.id, '01', devices.brRouter.id, 'ge-0/0/0', null, null, 'Lien WAN Bruxelles.'),
    ],
  });

  return { coreWan, cloudWan, drWan, patchCore, patchServer, patchBrussels };
}

function cable(
  organizationId: string,
  circuitId: string | null,
  label: string,
  cableType: string,
  lengthMeters: number,
  aDeviceId: string | null,
  aPortLabel: string | null,
  aPatchPanelId: string | null,
  aPatchPort: string | null,
  bDeviceId: string | null,
  bPortLabel: string | null,
  bPatchPanelId: string | null,
  bPatchPort: string | null,
  notes: string,
) {
  return {
    organizationId,
    circuitId,
    label,
    cableType,
    status: 'CONNECTED',
    lengthMeters,
    aDeviceId,
    aPortLabel,
    aPatchPanelId,
    aPatchPort,
    bDeviceId,
    bPortLabel,
    bPatchPanelId,
    bPatchPort,
    notes,
  };
}

async function createDiagrams(
  organizationId: string,
  sites: Awaited<ReturnType<typeof createSites>>,
  devices: Awaited<ReturnType<typeof createDevices>>,
  ports: Awaited<ReturnType<typeof createPorts>>,
  adminId: string,
) {
  const mainNodes = [
    rfNode(devices.internet.id, 'Internet / transit', 'INTERNET', -220, 20, 'ONLINE'),
    rfNode(devices.fwEdge.id, 'PAR-FW-EDGE-01', 'FIREWALL', 40, -60, 'ONLINE'),
    rfNode(devices.fwEdgeBackup.id, 'PAR-FW-EDGE-02', 'FIREWALL', 40, 110, 'ONLINE'),
    rfNode(devices.core1.id, 'PAR-SW-CORE-01', 'SWITCH', 330, -70, 'ONLINE'),
    rfNode(devices.core2.id, 'PAR-SW-CORE-02', 'SWITCH', 330, 120, 'ONLINE'),
    rfNode(devices.hyperv1.id, 'PAR-HV-01', 'HYPERVISOR', 640, -180, 'WARNING'),
    rfNode(devices.hyperv2.id, 'PAR-HV-02', 'HYPERVISOR', 640, -40, 'ONLINE'),
    rfNode(devices.nas.id, 'NAS Backup', 'NAS', 640, 120, 'ONLINE'),
    rfNode(devices.san.id, 'SAN Primaire', 'SAN', 640, 260, 'ONLINE'),
    rfNode(devices.cloudAzure.id, 'Azure Hub', 'CLOUD', 330, 330, 'ONLINE'),
  ];
  const mainEdges = [
    rfEdge('wan', devices.internet.id, devices.fwEdge.id, 'Orange 10G', ports.internetWan.id, ports.fwWan1.id),
    rfEdge('ha', devices.fwEdge.id, devices.fwEdgeBackup.id, 'HA sync 1G', ports.fwHa.id, ports.fw2Ha.id),
    rfEdge('fw-core-a', devices.fwEdge.id, devices.core1.id, '25G', ports.fwLan.id, ports.core1Fw.id),
    rfEdge('fw-core-b', devices.fwEdgeBackup.id, devices.core2.id, '25G', ports.fw2Lan.id, ports.core2Fw.id),
    rfEdge('core-vsl', devices.core1.id, devices.core2.id, 'VSL 100G', ports.core1Core2.id, ports.core2Core1.id),
    rfEdge('hv1', devices.core1.id, devices.hyperv1.id, '25G', ports.core1Hv1.id, ports.hv1Nic.id),
    rfEdge('hv2', devices.core2.id, devices.hyperv2.id, '25G', ports.core2Hv2.id, ports.hv2Nic.id),
    rfEdge('nas', devices.core1.id, devices.nas.id, 'Backup 10G', ports.core1Nas.id, ports.nasNic.id),
    rfEdge('san', devices.core2.id, devices.san.id, 'iSCSI 25G', ports.core2San.id, ports.sanNic.id),
    rfEdge('azure', devices.core1.id, devices.cloudAzure.id, 'Equinix 1G', null, ports.azurePrivate.id),
  ];

  const main = await prisma.diagram.create({
    data: {
      organizationId,
      name: 'Topologie Paris DC1 - Production',
      siteId: sites.parisDc.id,
      nodes: mainNodes,
      edges: mainEdges,
      viewport: { x: 80, y: 60, zoom: 0.78 },
      version: 3,
      createdById: adminId,
    },
  });
  await prisma.diagramVersion.createMany({
    data: [
      { diagramId: main.id, nodes: mainNodes.slice(0, 6), edges: mainEdges.slice(0, 5), message: 'Import initial depuis la decouverte CDP/LLDP.' },
      { diagramId: main.id, nodes: mainNodes.slice(0, 8), edges: mainEdges.slice(0, 7), message: 'Ajout compute et backup.' },
      { diagramId: main.id, nodes: mainNodes, edges: mainEdges, message: 'Ajout SAN et interconnexion cloud.' },
    ],
  });
  await prisma.diagramComment.createMany({
    data: [
      {
        organizationId,
        diagramId: main.id,
        userId: adminId,
        body: 'Verifier si le lien Azure doit etre represente comme circuit critique dans le runbook PRA.',
        x: 330,
        y: 330,
        resolved: false,
      },
      {
        organizationId,
        diagramId: main.id,
        userId: adminId,
        body: 'Le lien HA firewall est documente et cable physiquement.',
        x: 80,
        y: 40,
        resolved: true,
      },
    ],
  });

  const campus = await prisma.diagram.create({
    data: {
      organizationId,
      name: 'Campus Paris - Acces utilisateurs',
      siteId: sites.parisCampus.id,
      nodes: [
        rfNode(devices.dist.id, 'PAR-SW-DIST-01', 'SWITCH', 120, 80, 'WARNING'),
        rfNode(devices.controller.id, 'PAR-WLC-01', 'CONTROLLER', 420, -60, 'ONLINE'),
        rfNode(devices.apParis.id, 'AP Open-space', 'ACCESS_POINT', 420, 80, 'ONLINE'),
        rfNode(devices.printer.id, 'Imprimante Finance', 'PRINTER', 420, 230, 'ONLINE'),
        rfNode(devices.camera.id, 'Camera lobby', 'CAMERA', 420, 380, 'ONLINE'),
        rfNode(devices.workstation.id, 'Poste finance', 'WORKSTATION', 720, 230, 'ONLINE'),
      ],
      edges: [
        rfEdge('dist-ap', devices.dist.id, devices.apParis.id, 'PoE+ 1G', ports.distAp.id, ports.apPort.id),
        rfEdge('dist-prn', devices.dist.id, devices.printer.id, '1G', ports.distPrinter.id, ports.printerPort.id),
        rfEdge('wifi-client', devices.apParis.id, devices.workstation.id, 'Wi-Fi 6E', null, null),
      ],
      viewport: { x: 120, y: 80, zoom: 0.86 },
      version: 1,
      createdById: adminId,
    },
  });

  return { main, campus };
}

function rfNode(id: string, label: string, deviceType: string, x: number, y: number, status: string) {
  return {
    id,
    type: 'device',
    position: { x, y },
    data: { label, deviceType, status, deviceId: id },
    width: 210,
    height: 92,
  };
}

function rfEdge(id: string, source: string, target: string, label: string, sourcePortId: string | null, targetPortId: string | null) {
  return {
    id,
    source,
    target,
    label,
    type: 'cable',
    animated: false,
    data: { cableType: 'FIBER', speed: label, sourcePortId, targetPortId },
  };
}

async function createMedia(devices: Awaited<ReturnType<typeof createDevices>>, uploadDir: string) {
  await prisma.deviceImage.createMany({
    data: [
      { deviceId: devices.fwEdge.id, path: 'images/firewall-demo.png', mimeType: 'image/png', thumbPath: 'images/firewall-demo.png', caption: 'Facade du firewall primaire', sortOrder: 1 },
      { deviceId: devices.core1.id, path: 'images/switch-demo.png', mimeType: 'image/png', thumbPath: 'images/switch-demo.png', caption: 'Switch coeur en production', sortOrder: 1 },
      { deviceId: devices.hyperv1.id, path: 'images/server-demo.png', mimeType: 'image/png', thumbPath: 'images/server-demo.png', caption: 'Hote de virtualisation', sortOrder: 1 },
    ],
  });
  await prisma.attachment.createMany({
    data: [
      { deviceId: devices.fwEdge.id, filename: 'contrat-support-fortinet.pdf', path: 'attachments/contrat-support-fortinet.pdf', mimeType: 'application/pdf', size: 1240 },
      { deviceId: devices.core1.id, filename: 'runbook-coeur-reseau.txt', path: 'attachments/runbook-coeur-reseau.txt', mimeType: 'text/plain', size: 840 },
      { deviceId: devices.nas.id, filename: 'procedure-restauration.txt', path: 'attachments/procedure-restauration.txt', mimeType: 'text/plain', size: 760 },
    ],
  });

  await createDemoFiles(uploadDir);
}

async function createDiscovery(organizationId: string, sites: Awaited<ReturnType<typeof createSites>>, devices: Awaited<ReturnType<typeof createDevices>>, adminId: string) {
  const collector = await prisma.discoveryCollector.create({
    data: {
      organizationId,
      siteId: sites.parisDc.id,
      name: 'Collector Paris DC1',
      tokenHash: hashToken('collector-paris-demo-token'),
      tokenLastRotatedAt: daysAgo(12),
      tokenExpiresAt: daysFromNow(108),
      status: 'ACTIVE',
      defaultCidrs: ['10.0.0.0/16', '10.20.0.0/16', '10.30.0.0/16'],
      defaultPorts: [22, 80, 443, 445, 3389, 5900, 161, 9100],
      version: '1.4.0',
      lastSeenAt: minutesAgo(17),
      lastIp: '172.29.0.12',
      lastSummary: { hosts: 28, created: 3, updated: 14, events: 5, snmp: 11, lldpLinks: 18 },
      notes: 'Collector installe sur le serveur de supervision Paris.',
    },
  });
  const lyonCollector = await prisma.discoveryCollector.create({
    data: {
      organizationId,
      siteId: sites.lyon.id,
      name: 'Collector Agence Lyon',
      tokenHash: hashToken('collector-lyon-demo-token'),
      tokenLastRotatedAt: daysAgo(4),
      tokenExpiresAt: daysFromNow(176),
      status: 'ACTIVE',
      defaultCidrs: ['10.20.0.0/16'],
      defaultPorts: [22, 80, 443, 161, 9100],
      version: '1.4.0',
      lastSeenAt: minutesAgo(42),
      lastIp: '10.20.0.15',
      lastSummary: { hosts: 9, created: 1, updated: 6, events: 1, snmp: 4, lldpLinks: 5 },
      notes: 'Collector local sur mini-PC agence.',
    },
  });
  const run = await prisma.discoveryRun.create({
    data: {
      organizationId,
      collectorId: collector.id,
      siteId: sites.parisDc.id,
      status: 'SUCCESS',
      startedAt: minutesAgo(25),
      finishedAt: minutesAgo(19),
      summary: { hosts: 28, created: 3, updated: 14, unchanged: 11, links: 18, durationSeconds: 361 },
      raw: { source: 'collector', protocols: ['arp', 'icmp', 'tcp', 'snmpv2c', 'snmpv3', 'lldp', 'cdp'] },
    },
  });
  const partialRun = await prisma.discoveryRun.create({
    data: {
      organizationId,
      collectorId: lyonCollector.id,
      siteId: sites.lyon.id,
      status: 'PARTIAL',
      startedAt: daysAgo(1),
      finishedAt: daysAgo(1),
      summary: { hosts: 9, created: 1, updated: 6, unchanged: 2, links: 5, warnings: 1 },
      raw: { source: 'collector', warning: 'SNMP indisponible sur deux terminaux utilisateurs.' },
    },
  });

  await prisma.discoveryState.createMany({
    data: [
      state(organizationId, collector.id, sites.parisDc.id, devices.fwEdge.id, 'ONLINE', '10.0.0.1', 'PAR-FW-EDGE-01', [22, 443, 500, 4500], 'fortigate-200f-fw'),
      state(organizationId, collector.id, sites.parisDc.id, devices.core1.id, 'ONLINE', '10.0.0.10', 'PAR-SW-CORE-01', [22, 80, 443, 161], 'cisco-c9500-core'),
      state(organizationId, collector.id, sites.parisDc.id, devices.hyperv1.id, 'ONLINE', '10.0.10.11', 'PAR-HV-01', [135, 445, 3389, 5985], 'windows-hypervisor'),
      state(organizationId, collector.id, sites.parisDc.id, devices.nas.id, 'ONLINE', '10.0.20.50', 'PAR-NAS-BACKUP-01', [22, 80, 443, 445, 5000], 'synology-rs'),
      state(organizationId, collector.id, sites.parisCampus.id, devices.dist.id, 'ONLINE', '10.0.1.10', 'PAR-SW-DIST-01', [22, 80, 443, 161], 'aruba-cx'),
      state(organizationId, collector.id, sites.lilleWarehouse.id, devices.otGateway.id, 'ONLINE', '10.30.10.5', 'LIL-OT-GW-01', [22, 80, 502, 161], 'moxa-ot'),
      state(organizationId, lyonCollector.id, sites.lyon.id, devices.lyonRouter.id, 'ONLINE', '10.20.0.1', 'LYO-RTR-SDWAN-01', [22, 443, 161], 'cisco-router'),
      state(organizationId, lyonCollector.id, sites.lyon.id, devices.lyonSwitch.id, 'ONLINE', '10.20.0.10', 'LYO-SW-ACCESS-01', [22, 80, 443, 161], 'aruba-access'),
    ],
  });

  const events = await prisma.$transaction([
    prisma.discoveryEvent.create({
      data: {
        organizationId,
        collectorId: collector.id,
        runId: run.id,
        siteId: sites.parisCampus.id,
        deviceId: devices.dist.id,
        type: 'PORTS_CHANGED',
        severity: 'WARNING',
        title: 'Ports utilisateurs modifies sur PAR-SW-DIST-01',
        message: 'Le scan LLDP/CDP indique 4 nouveaux voisins et 2 ports liberes depuis le run precedent.',
        meta: { addedPorts: ['1/1/18', '1/1/19', '1/1/23', '1/1/24'], removedPorts: ['1/1/12', '1/1/13'] },
      },
    }),
    prisma.discoveryEvent.create({
      data: {
        organizationId,
        collectorId: collector.id,
        runId: run.id,
        siteId: sites.lilleWarehouse.id,
        deviceId: devices.otGateway.id,
        type: 'NEW_DEVICE',
        severity: 'INFO',
        title: 'Nouvelle passerelle OT confirmee',
        message: 'L equipement LIL-OT-GW-01 a ete rapproche avec la fiche source of truth.',
        meta: { method: 'fingerprint+mac', confidence: 0.92 },
        acknowledgedAt: minutesAgo(8),
        acknowledgedById: adminId,
      },
    }),
    prisma.discoveryEvent.create({
      data: {
        organizationId,
        collectorId: collector.id,
        runId: run.id,
        siteId: sites.parisDc.id,
        deviceId: devices.hyperv1.id,
        type: 'IP_CHANGED',
        severity: 'WARNING',
        title: 'Changement IP detecte sur PAR-HV-01',
        message: 'Ancienne IP iDRAC detectee en doublon, verifier inventaire.',
        meta: { previous: '10.0.90.31', current: '10.0.10.11' },
      },
    }),
    prisma.discoveryEvent.create({
      data: {
        organizationId,
        collectorId: lyonCollector.id,
        runId: partialRun.id,
        siteId: sites.lyon.id,
        deviceId: devices.lyonSwitch.id,
        type: 'DEVICE_REAPPEARED',
        severity: 'INFO',
        title: 'LYO-SW-ACCESS-01 de nouveau visible',
        message: 'Le switch agence Lyon repond aux sondes SNMP apres maintenance.',
        meta: { downtimeMinutes: 32 },
      },
    }),
  ]);

  await prisma.alertSettings.create({
    data: {
      organizationId,
      emailEnabled: true,
      emailRecipients: ['it-ops@acme.example', 'secops@acme.example'],
      webhookEnabled: true,
      webhookUrl: 'https://hooks.acme.example/orbis',
      minSeverity: 'WARNING',
      eventTypes: ['DEVICE_DOWN', 'IP_CHANGED', 'PORTS_CHANGED', 'IP_CONFLICT', 'MAC_CONFLICT'],
      includeResolvedInfo: true,
    },
  });
  await prisma.alertDelivery.createMany({
    data: [
      { organizationId, eventId: events[0].id, channel: 'EMAIL', status: 'SENT', target: 'it-ops@acme.example', sentAt: minutesAgo(15) },
      { organizationId, eventId: events[0].id, channel: 'WEBHOOK', status: 'SENT', target: 'https://hooks.acme.example/orbis', sentAt: minutesAgo(15) },
      { organizationId, eventId: events[2].id, channel: 'EMAIL', status: 'PENDING', target: 'secops@acme.example' },
    ],
  });
  await prisma.discoveryCollectorLog.createMany({
    data: [
      { organizationId, collectorId: collector.id, level: 'INFO', message: 'Run termine : 28 hotes, 18 liens LLDP/CDP.', meta: { runId: run.id } },
      { organizationId, collectorId: collector.id, level: 'WARNING', message: 'SNMP community faible detectee sur un ancien equipement.', meta: { community: 'public', device: 'LIL-OT-GW-01' } },
      { organizationId, collectorId: collector.id, level: 'DIAGNOSTIC', message: 'Latence moyenne ICMP 4.8 ms sur le perimetre Paris.', meta: { avgMs: 4.8 } },
      { organizationId, collectorId: lyonCollector.id, level: 'WARNING', message: 'Run partiel : deux hotes sans SNMP.', meta: { runId: partialRun.id } },
    ],
  });
}

function state(
  organizationId: string,
  collectorId: string,
  siteId: string,
  deviceId: string,
  status: 'ONLINE' | 'DOWN' | 'UNKNOWN',
  lastAddress: string,
  lastHostname: string,
  lastPorts: number[],
  lastFingerprint: string,
) {
  return {
    organizationId,
    collectorId,
    siteId,
    deviceId,
    status,
    firstSeenAt: daysAgo(21),
    lastSeenAt: minutesAgo(20),
    lastAddress,
    lastHostname,
    lastPorts,
    lastFingerprint,
    missCount: 0,
  };
}

async function createReports(organizationId: string, sites: Awaited<ReturnType<typeof createSites>>) {
  await prisma.reportSchedule.createMany({
    data: [
      {
        organizationId,
        name: 'Comite infra mensuel - PDF',
        type: 'INVENTORY',
        format: 'PDF',
        frequency: 'MONTHLY',
        recipients: ['cio@acme.example', 'it-ops@acme.example'],
        siteId: sites.parisDc.id,
        active: true,
        timezone: 'Europe/Paris',
        scheduledHour: 8,
        scheduledMinute: 30,
        scheduledMonthDay: 1,
        startAt: daysAgo(8),
        nextRunAt: daysFromNow(24),
        lastRunAt: daysAgo(6),
      },
      {
        organizationId,
        name: 'Export IPAM hebdomadaire',
        type: 'IPAM',
        format: 'CSV',
        frequency: 'WEEKLY',
        recipients: ['network@acme.example'],
        active: true,
        timezone: 'Europe/Paris',
        scheduledHour: 7,
        scheduledMinute: 0,
        scheduledWeekday: 1,
        startAt: daysAgo(14),
        nextRunAt: daysFromNow(6),
        lastRunAt: daysAgo(1),
      },
      {
        organizationId,
        name: 'Risques securite - direction IT',
        type: 'RISKS',
        format: 'PDF',
        frequency: 'WEEKLY',
        recipients: ['secops@acme.example', 'rssI@acme.example'],
        active: true,
        timezone: 'Europe/Paris',
        scheduledHour: 9,
        scheduledMinute: 15,
        scheduledWeekday: 2,
        startAt: daysAgo(30),
        nextRunAt: daysFromNow(7),
        lastRunAt: daysAgo(2),
      },
    ],
  });
}

async function createAuditTrail(organizationId: string, adminId: string, editorId: string, viewerId: string, diagramId: string, circuitId: string) {
  await prisma.auditLog.createMany({
    data: [
      audit(organizationId, adminId, 'auth.login', 'User', adminId, { method: 'password' }, '127.0.0.1', minutesAgo(9)),
      audit(organizationId, editorId, 'device.update', 'Device', null, { fields: ['owner', 'warrantyEnd'] }, '127.0.0.1', daysAgo(1)),
      audit(organizationId, adminId, 'diagram.update', 'Diagram', diagramId, { version: 3, message: 'Ajout interconnexion cloud' }, '127.0.0.1', daysAgo(2)),
      audit(organizationId, adminId, 'dcim.circuit.create', 'Circuit', circuitId, { provider: 'Orange Business' }, '127.0.0.1', daysAgo(4)),
      audit(organizationId, viewerId, 'report.export', 'Report', null, { type: 'inventory', format: 'pdf' }, '127.0.0.1', daysAgo(5)),
      audit(organizationId, adminId, 'security.policy.update', 'SecurityPolicy', null, { collectorTokenMaxAgeDays: 120 }, '127.0.0.1', daysAgo(6)),
    ],
  });
}

function audit(organizationId: string, userId: string, action: string, target: string, targetId: string | null, meta: object, ipAddress: string, createdAt: Date) {
  return { organizationId, userId, action, target, targetId, meta, ip: ipAddress, createdAt };
}

async function createDemoFiles(uploadDir: string) {
  await mkdir(join(uploadDir, 'images'), { recursive: true });
  await mkdir(join(uploadDir, 'attachments'), { recursive: true });

  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAACXBIWXMAAAsTAAALEwEAmpwYAAAAnUlEQVR4nO3aMQrAMAwEwWb//7L3ULCgGxckDVy6rVRE7AiT2Jv7uQMAcC8BIEgACBIAggSAIAEgSAAIEgCCBIAgASBIAAgSAIIEgCABIHRft9Y7R13Xx3E84zhOkiRJnud5Lcty27YsyxJCiNFas21bURQpimIYhmHbtq7r+r7v+76u67qu6/P8fD6fTqdjGIYgCIIgCIIgCIIgCIIgCIIgCIIg6APe7gbdZyTRBAAAAABJRU5ErkJggg==',
    'base64',
  );
  await writeFile(join(uploadDir, 'images/firewall-demo.png'), png);
  await writeFile(join(uploadDir, 'images/switch-demo.png'), png);
  await writeFile(join(uploadDir, 'images/server-demo.png'), png);
  await writeFile(join(uploadDir, 'attachments/runbook-coeur-reseau.txt'), 'Runbook coeur reseau\n- Verifier HA firewall\n- Controler VSL core\n- Escalade NOC si perte double uplink\n', 'utf8');
  await writeFile(join(uploadDir, 'attachments/procedure-restauration.txt'), 'Procedure restauration\n1. Selectionner le job Veeam\n2. Restaurer en bac a sable\n3. Valider avec le metier\n', 'utf8');
  await writeFile(join(uploadDir, 'attachments/contrat-support-fortinet.pdf'), '%PDF-1.4\n% Demo placeholder Orbis\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n', 'utf8');
}

function hashToken(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

function daysAgo(days: number) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d;
}

function daysFromNow(days: number) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d;
}

function minutesAgo(minutes: number) {
  const d = new Date();
  d.setMinutes(d.getMinutes() - minutes);
  return d;
}

main()
  .catch((error) => {
    console.error('Seed echoue', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
