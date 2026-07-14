-- CreateEnum
CREATE TYPE "DeviceLifecycleStatus" AS ENUM ('PLANNED', 'IN_SERVICE', 'MAINTENANCE', 'END_OF_SUPPORT', 'REPLACEMENT_DUE', 'RETIRED');

-- CreateEnum
CREATE TYPE "ApplicationDependencyType" AS ENUM ('APPLICATION', 'DATABASE', 'SERVICE', 'NETWORK', 'EXTERNAL', 'STORAGE', 'SECURITY', 'OTHER');

-- CreateEnum
CREATE TYPE "ApplicationDependencyStatus" AS ENUM ('ACTIVE', 'DEGRADED', 'DEPRECATED', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "Criticality" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "AssetContractType" AS ENUM ('LICENSE', 'SUPPORT', 'MAINTENANCE', 'WARRANTY', 'SUBSCRIPTION', 'SERVICE', 'OTHER');

-- CreateEnum
CREATE TYPE "AssetContractStatus" AS ENUM ('ACTIVE', 'EXPIRING', 'EXPIRED', 'TERMINATED', 'DRAFT');

-- CreateEnum
CREATE TYPE "CustomFieldTarget" AS ENUM ('DEVICE', 'SITE', 'IP_PREFIX', 'IP_ADDRESS', 'CONTRACT', 'DEPENDENCY');

-- CreateEnum
CREATE TYPE "CustomFieldType" AS ENUM ('TEXT', 'NUMBER', 'BOOLEAN', 'DATE', 'URL', 'SELECT');

-- CreateEnum
CREATE TYPE "SavedViewTarget" AS ENUM ('DEVICES', 'SITES', 'IPAM', 'DCIM', 'CONTRACTS', 'DEPENDENCIES', 'DISCOVERY');

-- AlterTable
ALTER TABLE "Device" ADD COLUMN "assetTag" TEXT;
ALTER TABLE "Device" ADD COLUMN "supportEnd" TIMESTAMP(3);
ALTER TABLE "Device" ADD COLUMN "replacementDue" TIMESTAMP(3);
ALTER TABLE "Device" ADD COLUMN "lifecycleStatus" "DeviceLifecycleStatus" NOT NULL DEFAULT 'IN_SERVICE';
ALTER TABLE "Device" ADD COLUMN "customFields" JSONB;

-- AlterTable
ALTER TABLE "Site" ADD COLUMN "customFields" JSONB;

-- AlterTable
ALTER TABLE "IpPrefix" ADD COLUMN "customFields" JSONB;

-- AlterTable
ALTER TABLE "IpAddress" ADD COLUMN "customFields" JSONB;

-- CreateTable
CREATE TABLE "ApplicationDependency" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "dependencyType" "ApplicationDependencyType" NOT NULL DEFAULT 'APPLICATION',
    "status" "ApplicationDependencyStatus" NOT NULL DEFAULT 'ACTIVE',
    "criticality" "Criticality" NOT NULL DEFAULT 'MEDIUM',
    "sourceDeviceId" TEXT,
    "targetDeviceId" TEXT,
    "sourceName" TEXT,
    "targetName" TEXT,
    "protocol" TEXT,
    "port" INTEGER,
    "description" TEXT,
    "owner" TEXT,
    "tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "customFields" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApplicationDependency_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssetContract" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "deviceId" TEXT,
    "name" TEXT NOT NULL,
    "type" "AssetContractType" NOT NULL DEFAULT 'LICENSE',
    "status" "AssetContractStatus" NOT NULL DEFAULT 'ACTIVE',
    "vendor" TEXT,
    "contractNumber" TEXT,
    "seatsTotal" INTEGER,
    "seatsUsed" INTEGER,
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "renewalDate" TIMESTAMP(3),
    "owner" TEXT,
    "cost" DOUBLE PRECISION,
    "notes" TEXT,
    "tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "customFields" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AssetContract_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomFieldDefinition" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "target" "CustomFieldTarget" NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "type" "CustomFieldType" NOT NULL DEFAULT 'TEXT',
    "required" BOOLEAN NOT NULL DEFAULT false,
    "options" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "defaultValue" JSONB,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomFieldDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TagDefinition" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#2563eb',
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TagDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SavedView" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "createdById" TEXT,
    "name" TEXT NOT NULL,
    "target" "SavedViewTarget" NOT NULL DEFAULT 'DEVICES',
    "filters" JSONB NOT NULL DEFAULT '{}',
    "columns" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "shared" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SavedView_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Device_lifecycleStatus_idx" ON "Device"("lifecycleStatus");
CREATE INDEX "Device_supportEnd_idx" ON "Device"("supportEnd");
CREATE INDEX "Device_replacementDue_idx" ON "Device"("replacementDue");

CREATE INDEX "ApplicationDependency_organizationId_idx" ON "ApplicationDependency"("organizationId");
CREATE INDEX "ApplicationDependency_organizationId_name_idx" ON "ApplicationDependency"("organizationId", "name");
CREATE INDEX "ApplicationDependency_organizationId_dependencyType_idx" ON "ApplicationDependency"("organizationId", "dependencyType");
CREATE INDEX "ApplicationDependency_organizationId_criticality_idx" ON "ApplicationDependency"("organizationId", "criticality");
CREATE INDEX "ApplicationDependency_sourceDeviceId_idx" ON "ApplicationDependency"("sourceDeviceId");
CREATE INDEX "ApplicationDependency_targetDeviceId_idx" ON "ApplicationDependency"("targetDeviceId");

CREATE INDEX "AssetContract_organizationId_idx" ON "AssetContract"("organizationId");
CREATE INDEX "AssetContract_organizationId_name_idx" ON "AssetContract"("organizationId", "name");
CREATE INDEX "AssetContract_organizationId_status_idx" ON "AssetContract"("organizationId", "status");
CREATE INDEX "AssetContract_organizationId_endDate_idx" ON "AssetContract"("organizationId", "endDate");
CREATE INDEX "AssetContract_deviceId_idx" ON "AssetContract"("deviceId");

CREATE UNIQUE INDEX "CustomFieldDefinition_organizationId_target_key_key" ON "CustomFieldDefinition"("organizationId", "target", "key");
CREATE INDEX "CustomFieldDefinition_organizationId_idx" ON "CustomFieldDefinition"("organizationId");
CREATE INDEX "CustomFieldDefinition_organizationId_target_idx" ON "CustomFieldDefinition"("organizationId", "target");

CREATE UNIQUE INDEX "TagDefinition_organizationId_name_key" ON "TagDefinition"("organizationId", "name");
CREATE INDEX "TagDefinition_organizationId_idx" ON "TagDefinition"("organizationId");

CREATE INDEX "SavedView_organizationId_idx" ON "SavedView"("organizationId");
CREATE INDEX "SavedView_organizationId_target_idx" ON "SavedView"("organizationId", "target");
CREATE INDEX "SavedView_createdById_idx" ON "SavedView"("createdById");

-- AddForeignKey
ALTER TABLE "ApplicationDependency" ADD CONSTRAINT "ApplicationDependency_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ApplicationDependency" ADD CONSTRAINT "ApplicationDependency_sourceDeviceId_fkey" FOREIGN KEY ("sourceDeviceId") REFERENCES "Device"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ApplicationDependency" ADD CONSTRAINT "ApplicationDependency_targetDeviceId_fkey" FOREIGN KEY ("targetDeviceId") REFERENCES "Device"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "AssetContract" ADD CONSTRAINT "AssetContract_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AssetContract" ADD CONSTRAINT "AssetContract_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "CustomFieldDefinition" ADD CONSTRAINT "CustomFieldDefinition_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TagDefinition" ADD CONSTRAINT "TagDefinition_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SavedView" ADD CONSTRAINT "SavedView_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SavedView" ADD CONSTRAINT "SavedView_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
