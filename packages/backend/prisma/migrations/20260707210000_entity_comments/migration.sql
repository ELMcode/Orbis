CREATE TYPE "EntityCommentTarget" AS ENUM ('DEVICE', 'IP_PREFIX', 'IP_ADDRESS');

CREATE TABLE "EntityComment" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "targetType" "EntityCommentTarget" NOT NULL,
  "deviceId" TEXT,
  "ipPrefixId" TEXT,
  "ipAddressId" TEXT,
  "userId" TEXT,
  "body" TEXT NOT NULL,
  "resolved" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EntityComment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "EntityComment_organizationId_idx" ON "EntityComment"("organizationId");
CREATE INDEX "EntityComment_targetType_idx" ON "EntityComment"("targetType");
CREATE INDEX "EntityComment_deviceId_idx" ON "EntityComment"("deviceId");
CREATE INDEX "EntityComment_ipPrefixId_idx" ON "EntityComment"("ipPrefixId");
CREATE INDEX "EntityComment_ipAddressId_idx" ON "EntityComment"("ipAddressId");
CREATE INDEX "EntityComment_userId_idx" ON "EntityComment"("userId");

ALTER TABLE "EntityComment" ADD CONSTRAINT "EntityComment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EntityComment" ADD CONSTRAINT "EntityComment_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EntityComment" ADD CONSTRAINT "EntityComment_ipPrefixId_fkey" FOREIGN KEY ("ipPrefixId") REFERENCES "IpPrefix"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EntityComment" ADD CONSTRAINT "EntityComment_ipAddressId_fkey" FOREIGN KEY ("ipAddressId") REFERENCES "IpAddress"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EntityComment" ADD CONSTRAINT "EntityComment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
