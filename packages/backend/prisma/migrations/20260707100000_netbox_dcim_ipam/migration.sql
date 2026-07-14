CREATE TABLE "Vrf" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "siteId" TEXT,
  "name" TEXT NOT NULL,
  "rd" TEXT,
  "description" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Vrf_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "IpPrefix" ADD COLUMN "vrfId" TEXT;
ALTER TABLE "IpAddress" ADD COLUMN "reservedBy" TEXT;
ALTER TABLE "IpAddress" ADD COLUMN "reservationExpiresAt" TIMESTAMP(3);

CREATE TABLE "Provider" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "contactName" TEXT,
  "contactEmail" TEXT,
  "supportPhone" TEXT,
  "portalUrl" TEXT,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Provider_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Circuit" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "siteId" TEXT,
  "providerId" TEXT,
  "name" TEXT NOT NULL,
  "circuitId" TEXT,
  "type" TEXT,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "bandwidthMbps" INTEGER,
  "demarcation" TEXT,
  "installDate" TIMESTAMP(3),
  "renewalDate" TIMESTAMP(3),
  "monthlyCost" DOUBLE PRECISION,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Circuit_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PatchPanel" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "siteId" TEXT,
  "rackId" TEXT,
  "name" TEXT NOT NULL,
  "portsCount" INTEGER NOT NULL DEFAULT 24,
  "description" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PatchPanel_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Cable" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "circuitId" TEXT,
  "label" TEXT NOT NULL,
  "cableType" TEXT NOT NULL DEFAULT 'COPPER',
  "status" TEXT NOT NULL DEFAULT 'CONNECTED',
  "lengthMeters" DOUBLE PRECISION,
  "aDeviceId" TEXT,
  "aPortLabel" TEXT,
  "aPatchPanelId" TEXT,
  "aPatchPort" TEXT,
  "bDeviceId" TEXT,
  "bPortLabel" TEXT,
  "bPatchPanelId" TEXT,
  "bPatchPort" TEXT,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Cable_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Vrf_organizationId_siteId_name_key" ON "Vrf"("organizationId", "siteId", "name");
CREATE INDEX "Vrf_organizationId_idx" ON "Vrf"("organizationId");
CREATE INDEX "Vrf_siteId_idx" ON "Vrf"("siteId");
CREATE INDEX "IpPrefix_vrfId_idx" ON "IpPrefix"("vrfId");
CREATE UNIQUE INDEX "Provider_organizationId_name_key" ON "Provider"("organizationId", "name");
CREATE INDEX "Provider_organizationId_idx" ON "Provider"("organizationId");
CREATE INDEX "Circuit_organizationId_idx" ON "Circuit"("organizationId");
CREATE INDEX "Circuit_siteId_idx" ON "Circuit"("siteId");
CREATE INDEX "Circuit_providerId_idx" ON "Circuit"("providerId");
CREATE INDEX "Circuit_status_idx" ON "Circuit"("status");
CREATE INDEX "PatchPanel_organizationId_idx" ON "PatchPanel"("organizationId");
CREATE INDEX "PatchPanel_siteId_idx" ON "PatchPanel"("siteId");
CREATE INDEX "PatchPanel_rackId_idx" ON "PatchPanel"("rackId");
CREATE INDEX "Cable_organizationId_idx" ON "Cable"("organizationId");
CREATE INDEX "Cable_circuitId_idx" ON "Cable"("circuitId");
CREATE INDEX "Cable_aDeviceId_idx" ON "Cable"("aDeviceId");
CREATE INDEX "Cable_bDeviceId_idx" ON "Cable"("bDeviceId");
CREATE INDEX "Cable_aPatchPanelId_idx" ON "Cable"("aPatchPanelId");
CREATE INDEX "Cable_bPatchPanelId_idx" ON "Cable"("bPatchPanelId");

DROP INDEX IF EXISTS "IpPrefix_organizationId_siteId_cidr_key";
CREATE UNIQUE INDEX "IpPrefix_organizationId_siteId_vrfId_cidr_key" ON "IpPrefix"("organizationId", "siteId", "vrfId", "cidr");

ALTER TABLE "Vrf" ADD CONSTRAINT "Vrf_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Vrf" ADD CONSTRAINT "Vrf_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "IpPrefix" ADD CONSTRAINT "IpPrefix_vrfId_fkey" FOREIGN KEY ("vrfId") REFERENCES "Vrf"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Provider" ADD CONSTRAINT "Provider_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Circuit" ADD CONSTRAINT "Circuit_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Circuit" ADD CONSTRAINT "Circuit_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Circuit" ADD CONSTRAINT "Circuit_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "Provider"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PatchPanel" ADD CONSTRAINT "PatchPanel_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PatchPanel" ADD CONSTRAINT "PatchPanel_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PatchPanel" ADD CONSTRAINT "PatchPanel_rackId_fkey" FOREIGN KEY ("rackId") REFERENCES "Rack"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Cable" ADD CONSTRAINT "Cable_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Cable" ADD CONSTRAINT "Cable_circuitId_fkey" FOREIGN KEY ("circuitId") REFERENCES "Circuit"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Cable" ADD CONSTRAINT "Cable_aDeviceId_fkey" FOREIGN KEY ("aDeviceId") REFERENCES "Device"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Cable" ADD CONSTRAINT "Cable_bDeviceId_fkey" FOREIGN KEY ("bDeviceId") REFERENCES "Device"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Cable" ADD CONSTRAINT "Cable_aPatchPanelId_fkey" FOREIGN KEY ("aPatchPanelId") REFERENCES "PatchPanel"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Cable" ADD CONSTRAINT "Cable_bPatchPanelId_fkey" FOREIGN KEY ("bPatchPanelId") REFERENCES "PatchPanel"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- CreateTable
CREATE TABLE "VrfRouteTarget" (
    "id" TEXT NOT NULL,
    "vrfId" TEXT NOT NULL,
    "rt" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "VrfRouteTarget_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "VrfRouteTarget_vrfId_rt_direction_key" ON "VrfRouteTarget"("vrfId", "rt", "direction");

-- CreateIndex
CREATE INDEX "VrfRouteTarget_vrfId_idx" ON "VrfRouteTarget"("vrfId");

-- AddForeignKey
ALTER TABLE "VrfRouteTarget" ADD CONSTRAINT "VrfRouteTarget_vrfId_fkey" FOREIGN KEY ("vrfId") REFERENCES "Vrf"("id") ON DELETE CASCADE ON UPDATE CASCADE;
