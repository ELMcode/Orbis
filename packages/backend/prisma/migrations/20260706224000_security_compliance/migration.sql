ALTER TABLE "DiscoveryCollector" ADD COLUMN "tokenLastRotatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "DiscoveryCollector" ADD COLUMN "tokenExpiresAt" TIMESTAMP(3);
CREATE INDEX "DiscoveryCollector_tokenExpiresAt_idx" ON "DiscoveryCollector"("tokenExpiresAt");

CREATE TABLE "SecurityPolicy" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "requireDeviceSite" BOOLEAN NOT NULL DEFAULT true,
  "requireDeviceOwner" BOOLEAN NOT NULL DEFAULT true,
  "riskyPorts" INTEGER[] DEFAULT ARRAY[21,23,25,53,110,143,161,389,445,1433,1521,3306,5432,5900,6379,9200,9300,11211,27017]::INTEGER[],
  "criticalPorts" INTEGER[] DEFAULT ARRAY[23,445,3389,5900,6379,9200,11211,27017]::INTEGER[],
  "weakSnmpCommunities" TEXT[] DEFAULT ARRAY['public','private']::TEXT[],
  "firmwareUnknownDays" INTEGER NOT NULL DEFAULT 30,
  "warrantyWarningDays" INTEGER NOT NULL DEFAULT 90,
  "collectorTokenMaxAgeDays" INTEGER NOT NULL DEFAULT 180,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SecurityPolicy_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SecurityPolicy_organizationId_key" ON "SecurityPolicy"("organizationId");
ALTER TABLE "SecurityPolicy" ADD CONSTRAINT "SecurityPolicy_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
