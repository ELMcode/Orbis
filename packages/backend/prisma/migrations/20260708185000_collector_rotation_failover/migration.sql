CREATE TYPE "DiscoveryCollectorRole" AS ENUM ('PRIMARY', 'SECONDARY', 'STANDBY');

ALTER TABLE "DiscoveryCollector"
  ADD COLUMN "tokenRotationDays" INTEGER,
  ADD COLUMN "nextTokenRotationAt" TIMESTAMP(3),
  ADD COLUMN "role" "DiscoveryCollectorRole" NOT NULL DEFAULT 'PRIMARY',
  ADD COLUMN "priority" INTEGER NOT NULL DEFAULT 100,
  ADD COLUMN "failoverAfterMinutes" INTEGER NOT NULL DEFAULT 15;

CREATE INDEX "DiscoveryCollector_nextTokenRotationAt_idx" ON "DiscoveryCollector"("nextTokenRotationAt");
CREATE INDEX "DiscoveryCollector_organizationId_siteId_status_priority_idx" ON "DiscoveryCollector"("organizationId", "siteId", "status", "priority");
