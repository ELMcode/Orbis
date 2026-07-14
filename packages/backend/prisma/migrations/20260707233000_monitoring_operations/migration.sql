ALTER TYPE "DiscoveryEventType" ADD VALUE 'LATENCY_HIGH';

CREATE TYPE "IncidentStatus" AS ENUM ('OPEN', 'ACKNOWLEDGED', 'RESOLVED');

CREATE TABLE "MonitoringPolicy" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "availabilityTargetPct" DOUBLE PRECISION NOT NULL DEFAULT 99.0,
  "latencyWarningMs" INTEGER NOT NULL DEFAULT 250,
  "latencyCriticalMs" INTEGER NOT NULL DEFAULT 1000,
  "measurementRetentionDays" INTEGER NOT NULL DEFAULT 90,
  "incidentAutoResolve" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MonitoringPolicy_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MaintenanceWindow" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "siteId" TEXT,
  "deviceId" TEXT,
  "title" TEXT NOT NULL,
  "startsAt" TIMESTAMP(3) NOT NULL,
  "endsAt" TIMESTAMP(3) NOT NULL,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MaintenanceWindow_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Incident" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "siteId" TEXT,
  "deviceId" TEXT,
  "title" TEXT NOT NULL,
  "severity" "DiscoveryEventSeverity" NOT NULL DEFAULT 'WARNING',
  "status" "IncidentStatus" NOT NULL DEFAULT 'OPEN',
  "source" TEXT NOT NULL DEFAULT 'MONITORING',
  "sourceEventId" TEXT,
  "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "acknowledgedAt" TIMESTAMP(3),
  "resolvedAt" TIMESTAMP(3),
  "lastEventAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Incident_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AvailabilitySample" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "collectorId" TEXT NOT NULL,
  "runId" TEXT NOT NULL,
  "siteId" TEXT,
  "deviceId" TEXT NOT NULL,
  "status" "DiscoveryDeviceState" NOT NULL DEFAULT 'UNKNOWN',
  "latencyMs" DOUBLE PRECISION,
  "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AvailabilitySample_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MonitoringPolicy_organizationId_key" ON "MonitoringPolicy"("organizationId");

CREATE INDEX "MaintenanceWindow_organizationId_idx" ON "MaintenanceWindow"("organizationId");
CREATE INDEX "MaintenanceWindow_siteId_idx" ON "MaintenanceWindow"("siteId");
CREATE INDEX "MaintenanceWindow_deviceId_idx" ON "MaintenanceWindow"("deviceId");
CREATE INDEX "MaintenanceWindow_startsAt_idx" ON "MaintenanceWindow"("startsAt");
CREATE INDEX "MaintenanceWindow_endsAt_idx" ON "MaintenanceWindow"("endsAt");

CREATE INDEX "Incident_organizationId_idx" ON "Incident"("organizationId");
CREATE INDEX "Incident_siteId_idx" ON "Incident"("siteId");
CREATE INDEX "Incident_deviceId_idx" ON "Incident"("deviceId");
CREATE INDEX "Incident_status_idx" ON "Incident"("status");
CREATE INDEX "Incident_severity_idx" ON "Incident"("severity");
CREATE INDEX "Incident_openedAt_idx" ON "Incident"("openedAt");

CREATE INDEX "AvailabilitySample_organizationId_idx" ON "AvailabilitySample"("organizationId");
CREATE INDEX "AvailabilitySample_collectorId_idx" ON "AvailabilitySample"("collectorId");
CREATE INDEX "AvailabilitySample_runId_idx" ON "AvailabilitySample"("runId");
CREATE INDEX "AvailabilitySample_siteId_idx" ON "AvailabilitySample"("siteId");
CREATE INDEX "AvailabilitySample_deviceId_idx" ON "AvailabilitySample"("deviceId");
CREATE INDEX "AvailabilitySample_status_idx" ON "AvailabilitySample"("status");
CREATE INDEX "AvailabilitySample_checkedAt_idx" ON "AvailabilitySample"("checkedAt");

ALTER TABLE "MonitoringPolicy" ADD CONSTRAINT "MonitoringPolicy_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MaintenanceWindow" ADD CONSTRAINT "MaintenanceWindow_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MaintenanceWindow" ADD CONSTRAINT "MaintenanceWindow_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "MaintenanceWindow" ADD CONSTRAINT "MaintenanceWindow_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Incident" ADD CONSTRAINT "Incident_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Incident" ADD CONSTRAINT "Incident_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Incident" ADD CONSTRAINT "Incident_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AvailabilitySample" ADD CONSTRAINT "AvailabilitySample_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AvailabilitySample" ADD CONSTRAINT "AvailabilitySample_collectorId_fkey" FOREIGN KEY ("collectorId") REFERENCES "DiscoveryCollector"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AvailabilitySample" ADD CONSTRAINT "AvailabilitySample_runId_fkey" FOREIGN KEY ("runId") REFERENCES "DiscoveryRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AvailabilitySample" ADD CONSTRAINT "AvailabilitySample_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AvailabilitySample" ADD CONSTRAINT "AvailabilitySample_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE;
