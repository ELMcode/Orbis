-- Extend device taxonomy for broader infrastructure mapping.
ALTER TYPE "DeviceType" ADD VALUE IF NOT EXISTS 'HYPERVISOR';
ALTER TYPE "DeviceType" ADD VALUE IF NOT EXISTS 'WORKSTATION';
ALTER TYPE "DeviceType" ADD VALUE IF NOT EXISTS 'PRINTER';
ALTER TYPE "DeviceType" ADD VALUE IF NOT EXISTS 'CAMERA';
ALTER TYPE "DeviceType" ADD VALUE IF NOT EXISTS 'CONTROLLER';
ALTER TYPE "DeviceType" ADD VALUE IF NOT EXISTS 'PATCH_PANEL';
ALTER TYPE "DeviceType" ADD VALUE IF NOT EXISTS 'MODEM';
ALTER TYPE "DeviceType" ADD VALUE IF NOT EXISTS 'PHONE';
ALTER TYPE "DeviceType" ADD VALUE IF NOT EXISTS 'IOT';
ALTER TYPE "DeviceType" ADD VALUE IF NOT EXISTS 'OT';

-- IPAM / VLAN source of truth.
CREATE TYPE "IpAddressStatus" AS ENUM ('RESERVED', 'ASSIGNED', 'DHCP', 'DEPRECATED', 'UNKNOWN');

CREATE TABLE "Vlan" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "siteId" TEXT,
    "vlanId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Vlan_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "IpPrefix" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "siteId" TEXT,
    "vlanId" TEXT,
    "cidr" TEXT NOT NULL,
    "name" TEXT,
    "gateway" TEXT,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IpPrefix_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "IpAddress" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "siteId" TEXT,
    "prefixId" TEXT,
    "deviceId" TEXT,
    "address" TEXT NOT NULL,
    "status" "IpAddressStatus" NOT NULL DEFAULT 'UNKNOWN',
    "dnsName" TEXT,
    "interfaceLabel" TEXT,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IpAddress_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DiagramComment" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "diagramId" TEXT NOT NULL,
    "userId" TEXT,
    "body" TEXT NOT NULL,
    "x" DOUBLE PRECISION,
    "y" DOUBLE PRECISION,
    "resolved" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DiagramComment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Vlan_organizationId_siteId_vlanId_key" ON "Vlan"("organizationId", "siteId", "vlanId");
CREATE INDEX "Vlan_organizationId_idx" ON "Vlan"("organizationId");
CREATE INDEX "Vlan_siteId_idx" ON "Vlan"("siteId");

CREATE UNIQUE INDEX "IpPrefix_organizationId_siteId_cidr_key" ON "IpPrefix"("organizationId", "siteId", "cidr");
CREATE INDEX "IpPrefix_organizationId_idx" ON "IpPrefix"("organizationId");
CREATE INDEX "IpPrefix_siteId_idx" ON "IpPrefix"("siteId");
CREATE INDEX "IpPrefix_vlanId_idx" ON "IpPrefix"("vlanId");

CREATE UNIQUE INDEX "IpAddress_organizationId_siteId_address_key" ON "IpAddress"("organizationId", "siteId", "address");
CREATE INDEX "IpAddress_organizationId_idx" ON "IpAddress"("organizationId");
CREATE INDEX "IpAddress_siteId_idx" ON "IpAddress"("siteId");
CREATE INDEX "IpAddress_prefixId_idx" ON "IpAddress"("prefixId");
CREATE INDEX "IpAddress_deviceId_idx" ON "IpAddress"("deviceId");

CREATE INDEX "DiagramComment_organizationId_idx" ON "DiagramComment"("organizationId");
CREATE INDEX "DiagramComment_diagramId_idx" ON "DiagramComment"("diagramId");
CREATE INDEX "DiagramComment_userId_idx" ON "DiagramComment"("userId");

ALTER TABLE "Vlan" ADD CONSTRAINT "Vlan_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Vlan" ADD CONSTRAINT "Vlan_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "IpPrefix" ADD CONSTRAINT "IpPrefix_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "IpPrefix" ADD CONSTRAINT "IpPrefix_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "IpPrefix" ADD CONSTRAINT "IpPrefix_vlanId_fkey" FOREIGN KEY ("vlanId") REFERENCES "Vlan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "IpAddress" ADD CONSTRAINT "IpAddress_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "IpAddress" ADD CONSTRAINT "IpAddress_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "IpAddress" ADD CONSTRAINT "IpAddress_prefixId_fkey" FOREIGN KEY ("prefixId") REFERENCES "IpPrefix"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "IpAddress" ADD CONSTRAINT "IpAddress_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "DiagramComment" ADD CONSTRAINT "DiagramComment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DiagramComment" ADD CONSTRAINT "DiagramComment_diagramId_fkey" FOREIGN KEY ("diagramId") REFERENCES "Diagram"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DiagramComment" ADD CONSTRAINT "DiagramComment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
