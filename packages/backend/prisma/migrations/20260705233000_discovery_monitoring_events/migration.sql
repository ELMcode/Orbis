-- Monitoring/diff state for collector discoveries.

CREATE TYPE "DiscoveryDeviceState" AS ENUM ('ONLINE', 'DOWN', 'UNKNOWN');
CREATE TYPE "DiscoveryEventType" AS ENUM ('NEW_DEVICE', 'DEVICE_REAPPEARED', 'DEVICE_DOWN', 'IP_CHANGED', 'PORTS_CHANGED');
CREATE TYPE "DiscoveryEventSeverity" AS ENUM ('INFO', 'WARNING', 'CRITICAL');

CREATE TABLE "DiscoveryState" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "collectorId" TEXT NOT NULL,
    "siteId" TEXT,
    "deviceId" TEXT NOT NULL,
    "status" "DiscoveryDeviceState" NOT NULL DEFAULT 'UNKNOWN',
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastAddress" TEXT,
    "lastHostname" TEXT,
    "lastPorts" INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[],
    "lastFingerprint" TEXT,
    "missCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DiscoveryState_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DiscoveryEvent" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "collectorId" TEXT NOT NULL,
    "runId" TEXT,
    "siteId" TEXT,
    "deviceId" TEXT,
    "type" "DiscoveryEventType" NOT NULL,
    "severity" "DiscoveryEventSeverity" NOT NULL DEFAULT 'INFO',
    "title" TEXT NOT NULL,
    "message" TEXT,
    "meta" JSONB,
    "acknowledgedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DiscoveryEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DiscoveryState_collectorId_deviceId_key" ON "DiscoveryState"("collectorId", "deviceId");
CREATE INDEX "DiscoveryState_organizationId_idx" ON "DiscoveryState"("organizationId");
CREATE INDEX "DiscoveryState_collectorId_idx" ON "DiscoveryState"("collectorId");
CREATE INDEX "DiscoveryState_siteId_idx" ON "DiscoveryState"("siteId");
CREATE INDEX "DiscoveryState_deviceId_idx" ON "DiscoveryState"("deviceId");
CREATE INDEX "DiscoveryState_status_idx" ON "DiscoveryState"("status");
CREATE INDEX "DiscoveryState_lastSeenAt_idx" ON "DiscoveryState"("lastSeenAt");

CREATE INDEX "DiscoveryEvent_organizationId_idx" ON "DiscoveryEvent"("organizationId");
CREATE INDEX "DiscoveryEvent_collectorId_idx" ON "DiscoveryEvent"("collectorId");
CREATE INDEX "DiscoveryEvent_runId_idx" ON "DiscoveryEvent"("runId");
CREATE INDEX "DiscoveryEvent_siteId_idx" ON "DiscoveryEvent"("siteId");
CREATE INDEX "DiscoveryEvent_deviceId_idx" ON "DiscoveryEvent"("deviceId");
CREATE INDEX "DiscoveryEvent_type_idx" ON "DiscoveryEvent"("type");
CREATE INDEX "DiscoveryEvent_severity_idx" ON "DiscoveryEvent"("severity");
CREATE INDEX "DiscoveryEvent_createdAt_idx" ON "DiscoveryEvent"("createdAt");

ALTER TABLE "DiscoveryState" ADD CONSTRAINT "DiscoveryState_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DiscoveryState" ADD CONSTRAINT "DiscoveryState_collectorId_fkey" FOREIGN KEY ("collectorId") REFERENCES "DiscoveryCollector"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DiscoveryState" ADD CONSTRAINT "DiscoveryState_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "DiscoveryState" ADD CONSTRAINT "DiscoveryState_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DiscoveryEvent" ADD CONSTRAINT "DiscoveryEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DiscoveryEvent" ADD CONSTRAINT "DiscoveryEvent_collectorId_fkey" FOREIGN KEY ("collectorId") REFERENCES "DiscoveryCollector"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DiscoveryEvent" ADD CONSTRAINT "DiscoveryEvent_runId_fkey" FOREIGN KEY ("runId") REFERENCES "DiscoveryRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "DiscoveryEvent" ADD CONSTRAINT "DiscoveryEvent_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "DiscoveryEvent" ADD CONSTRAINT "DiscoveryEvent_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE SET NULL ON UPDATE CASCADE;
