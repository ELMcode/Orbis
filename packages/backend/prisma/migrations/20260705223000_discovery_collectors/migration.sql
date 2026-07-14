-- Discovery collectors: local agents installed inside customer networks.

CREATE TYPE "DiscoveryCollectorStatus" AS ENUM ('ACTIVE', 'PAUSED', 'REVOKED', 'ERROR');
CREATE TYPE "DiscoveryRunStatus" AS ENUM ('SUCCESS', 'PARTIAL', 'FAILED');

CREATE TABLE "DiscoveryCollector" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "siteId" TEXT,
    "name" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "status" "DiscoveryCollectorStatus" NOT NULL DEFAULT 'ACTIVE',
    "defaultCidrs" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "defaultPorts" INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[],
    "version" TEXT,
    "lastSeenAt" TIMESTAMP(3),
    "lastIp" TEXT,
    "lastSummary" JSONB,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DiscoveryCollector_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DiscoveryRun" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "collectorId" TEXT NOT NULL,
    "siteId" TEXT,
    "status" "DiscoveryRunStatus" NOT NULL DEFAULT 'SUCCESS',
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "summary" JSONB NOT NULL,
    "raw" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DiscoveryRun_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "DiscoveryCollector_organizationId_idx" ON "DiscoveryCollector"("organizationId");
CREATE INDEX "DiscoveryCollector_siteId_idx" ON "DiscoveryCollector"("siteId");
CREATE INDEX "DiscoveryCollector_status_idx" ON "DiscoveryCollector"("status");
CREATE INDEX "DiscoveryRun_organizationId_idx" ON "DiscoveryRun"("organizationId");
CREATE INDEX "DiscoveryRun_collectorId_idx" ON "DiscoveryRun"("collectorId");
CREATE INDEX "DiscoveryRun_siteId_idx" ON "DiscoveryRun"("siteId");
CREATE INDEX "DiscoveryRun_createdAt_idx" ON "DiscoveryRun"("createdAt");

ALTER TABLE "DiscoveryCollector" ADD CONSTRAINT "DiscoveryCollector_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DiscoveryCollector" ADD CONSTRAINT "DiscoveryCollector_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "DiscoveryRun" ADD CONSTRAINT "DiscoveryRun_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DiscoveryRun" ADD CONSTRAINT "DiscoveryRun_collectorId_fkey" FOREIGN KEY ("collectorId") REFERENCES "DiscoveryCollector"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DiscoveryRun" ADD CONSTRAINT "DiscoveryRun_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE SET NULL ON UPDATE CASCADE;
