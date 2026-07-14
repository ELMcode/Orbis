CREATE TYPE "DiscoveryProposalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

CREATE TABLE "DiscoveryProposal" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "siteId" TEXT,
  "createdById" TEXT NOT NULL,
  "reviewedById" TEXT,
  "status" "DiscoveryProposalStatus" NOT NULL DEFAULT 'PENDING',
  "source" TEXT NOT NULL,
  "summary" JSONB NOT NULL,
  "payload" JSONB NOT NULL,
  "reviewNote" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reviewedAt" TIMESTAMP(3),
  CONSTRAINT "DiscoveryProposal_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "DiscoveryProposal_organizationId_status_createdAt_idx" ON "DiscoveryProposal"("organizationId", "status", "createdAt");
CREATE INDEX "DiscoveryProposal_siteId_idx" ON "DiscoveryProposal"("siteId");
ALTER TABLE "DiscoveryProposal" ADD CONSTRAINT "DiscoveryProposal_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DiscoveryProposal" ADD CONSTRAINT "DiscoveryProposal_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "DiscoveryProposal" ADD CONSTRAINT "DiscoveryProposal_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DiscoveryProposal" ADD CONSTRAINT "DiscoveryProposal_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "UserNotification" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "body" TEXT,
  "target" TEXT,
  "targetId" TEXT,
  "readAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "UserNotification_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "UserNotification_userId_readAt_createdAt_idx" ON "UserNotification"("userId", "readAt", "createdAt");
CREATE INDEX "UserNotification_organizationId_createdAt_idx" ON "UserNotification"("organizationId", "createdAt");
ALTER TABLE "UserNotification" ADD CONSTRAINT "UserNotification_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UserNotification" ADD CONSTRAINT "UserNotification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "IntegrationCredential" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "encryptedData" TEXT NOT NULL,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "IntegrationCredential_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "IntegrationCredential_organizationId_name_key" ON "IntegrationCredential"("organizationId", "name");
CREATE INDEX "IntegrationCredential_organizationId_provider_idx" ON "IntegrationCredential"("organizationId", "provider");
ALTER TABLE "IntegrationCredential" ADD CONSTRAINT "IntegrationCredential_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
