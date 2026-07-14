CREATE TYPE "ReportFormat" AS ENUM ('CSV', 'PDF');
CREATE TYPE "ReportType" AS ENUM ('INVENTORY', 'IPAM', 'CHANGES', 'TOPOLOGY', 'AVAILABILITY', 'RISKS', 'CAPACITY');
CREATE TYPE "ReportFrequency" AS ENUM ('WEEKLY', 'MONTHLY', 'QUARTERLY');

CREATE TABLE "ReportSchedule" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "type" "ReportType" NOT NULL,
  "format" "ReportFormat" NOT NULL,
  "frequency" "ReportFrequency" NOT NULL DEFAULT 'MONTHLY',
  "recipients" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "siteId" TEXT,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "nextRunAt" TIMESTAMP(3),
  "lastRunAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ReportSchedule_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ReportSchedule_organizationId_idx" ON "ReportSchedule"("organizationId");
CREATE INDEX "ReportSchedule_siteId_idx" ON "ReportSchedule"("siteId");
CREATE INDEX "ReportSchedule_type_idx" ON "ReportSchedule"("type");
CREATE INDEX "ReportSchedule_active_idx" ON "ReportSchedule"("active");
CREATE INDEX "ReportSchedule_nextRunAt_idx" ON "ReportSchedule"("nextRunAt");

ALTER TABLE "ReportSchedule"
  ADD CONSTRAINT "ReportSchedule_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ReportSchedule"
  ADD CONSTRAINT "ReportSchedule_siteId_fkey"
  FOREIGN KEY ("siteId") REFERENCES "Site"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
