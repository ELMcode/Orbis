CREATE TYPE "AlertChannel" AS ENUM ('EMAIL', 'WEBHOOK');

CREATE TYPE "AlertDeliveryStatus" AS ENUM ('PENDING', 'SENT', 'FAILED', 'SKIPPED');

CREATE TABLE "AlertSettings" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "emailEnabled" BOOLEAN NOT NULL DEFAULT false,
  "emailRecipients" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "webhookEnabled" BOOLEAN NOT NULL DEFAULT false,
  "webhookUrl" TEXT,
  "minSeverity" "DiscoveryEventSeverity" NOT NULL DEFAULT 'WARNING',
  "eventTypes" "DiscoveryEventType"[] DEFAULT ARRAY[]::"DiscoveryEventType"[],
  "includeResolvedInfo" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "AlertSettings_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AlertDelivery" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "eventId" TEXT NOT NULL,
  "channel" "AlertChannel" NOT NULL,
  "status" "AlertDeliveryStatus" NOT NULL DEFAULT 'PENDING',
  "target" TEXT,
  "error" TEXT,
  "sentAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "AlertDelivery_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "DiscoveryEvent" ADD COLUMN "acknowledgedById" TEXT;

CREATE UNIQUE INDEX "AlertSettings_organizationId_key" ON "AlertSettings"("organizationId");
CREATE INDEX "AlertSettings_organizationId_idx" ON "AlertSettings"("organizationId");
CREATE INDEX "AlertDelivery_organizationId_idx" ON "AlertDelivery"("organizationId");
CREATE INDEX "AlertDelivery_eventId_idx" ON "AlertDelivery"("eventId");
CREATE INDEX "AlertDelivery_channel_idx" ON "AlertDelivery"("channel");
CREATE INDEX "AlertDelivery_status_idx" ON "AlertDelivery"("status");
CREATE INDEX "AlertDelivery_createdAt_idx" ON "AlertDelivery"("createdAt");
CREATE INDEX "DiscoveryEvent_acknowledgedAt_idx" ON "DiscoveryEvent"("acknowledgedAt");

ALTER TABLE "AlertSettings"
  ADD CONSTRAINT "AlertSettings_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AlertDelivery"
  ADD CONSTRAINT "AlertDelivery_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AlertDelivery"
  ADD CONSTRAINT "AlertDelivery_eventId_fkey"
  FOREIGN KEY ("eventId") REFERENCES "DiscoveryEvent"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DiscoveryEvent"
  ADD CONSTRAINT "DiscoveryEvent_acknowledgedById_fkey"
  FOREIGN KEY ("acknowledgedById") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
