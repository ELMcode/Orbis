CREATE TYPE "DiscoveryCollectorLogLevel" AS ENUM ('INFO', 'WARNING', 'ERROR', 'DIAGNOSTIC');

CREATE TABLE "DiscoveryCollectorLog" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "collectorId" TEXT NOT NULL,
  "level" "DiscoveryCollectorLogLevel" NOT NULL DEFAULT 'INFO',
  "message" TEXT NOT NULL,
  "meta" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "DiscoveryCollectorLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "DiscoveryCollectorLog_organizationId_idx" ON "DiscoveryCollectorLog"("organizationId");
CREATE INDEX "DiscoveryCollectorLog_collectorId_idx" ON "DiscoveryCollectorLog"("collectorId");
CREATE INDEX "DiscoveryCollectorLog_level_idx" ON "DiscoveryCollectorLog"("level");
CREATE INDEX "DiscoveryCollectorLog_createdAt_idx" ON "DiscoveryCollectorLog"("createdAt");

ALTER TABLE "DiscoveryCollectorLog"
  ADD CONSTRAINT "DiscoveryCollectorLog_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DiscoveryCollectorLog"
  ADD CONSTRAINT "DiscoveryCollectorLog_collectorId_fkey"
  FOREIGN KEY ("collectorId") REFERENCES "DiscoveryCollector"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
