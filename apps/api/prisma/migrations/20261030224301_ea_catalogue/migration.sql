-- CreateEnum
CREATE TYPE "AppType" AS ENUM ('APPLICATION', 'PLATFORM', 'SERVICE', 'DATABASE', 'EXTERNAL');

-- CreateEnum
CREATE TYPE "AppHosting" AS ENUM ('ON_PREMISE', 'CLOUD', 'SAAS');

-- CreateEnum
CREATE TYPE "AppLifecycle" AS ENUM ('PLANNED', 'ACTIVE', 'PHASING_OUT', 'RETIRED');

-- CreateEnum
CREATE TYPE "Criticality" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "DataClassification" AS ENUM ('PUBLIC', 'INTERNAL', 'CONFIDENTIAL', 'SECRET');

-- CreateEnum
CREATE TYPE "InterfaceDirection" AS ENUM ('ONE_WAY', 'TWO_WAY');

-- CreateEnum
CREATE TYPE "InterfaceTechnology" AS ENUM ('API', 'FILE', 'DB_LINK', 'MANUAL', 'MESSAGE_QUEUE');

-- CreateEnum
CREATE TYPE "InterfaceFrequency" AS ENUM ('REAL_TIME', 'HOURLY', 'DAILY', 'WEEKLY', 'MONTHLY', 'ON_DEMAND');

-- CreateEnum
CREATE TYPE "EaStatus" AS ENUM ('PLANNED', 'ACTIVE', 'RETIRED');

-- CreateEnum
CREATE TYPE "StrategicImportance" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- AlterTable

-- CreateTable
CREATE TABLE "Application" (
    "objectId" UUID NOT NULL,
    "appType" "AppType" NOT NULL DEFAULT 'APPLICATION',
    "vendor" TEXT NOT NULL DEFAULT '',
    "version" TEXT NOT NULL DEFAULT '',
    "businessOwnerId" UUID,
    "itOwnerId" UUID,
    "departmentId" UUID,
    "hosting" "AppHosting" NOT NULL DEFAULT 'ON_PREMISE',
    "hostingCountry" TEXT NOT NULL DEFAULT '',
    "lifecycle" "AppLifecycle" NOT NULL DEFAULT 'ACTIVE',
    "liveFrom" TIMESTAMP(3),
    "phaseOutFrom" TIMESTAMP(3),
    "retiredAt" TIMESTAMP(3),
    "criticality" "Criticality" NOT NULL DEFAULT 'MEDIUM',
    "dataClassification" "DataClassification" NOT NULL DEFAULT 'INTERNAL',
    "licenceNotes" TEXT NOT NULL DEFAULT '',
    "url" TEXT,

    CONSTRAINT "Application_pkey" PRIMARY KEY ("objectId")
);

-- CreateTable
CREATE TABLE "AppInterface" (
    "id" UUID NOT NULL,
    "code" TEXT,
    "nameEn" TEXT NOT NULL DEFAULT '',
    "nameAr" TEXT NOT NULL DEFAULT '',
    "descriptionEn" TEXT NOT NULL DEFAULT '',
    "descriptionAr" TEXT NOT NULL DEFAULT '',
    "sourceId" UUID NOT NULL,
    "targetId" UUID NOT NULL,
    "direction" "InterfaceDirection" NOT NULL DEFAULT 'ONE_WAY',
    "technology" "InterfaceTechnology" NOT NULL DEFAULT 'API',
    "frequency" "InterfaceFrequency" NOT NULL DEFAULT 'DAILY',
    "ownerId" UUID,
    "status" "EaStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" UUID,
    "updatedById" UUID,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "AppInterface_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DataObject" (
    "id" UUID NOT NULL,
    "code" TEXT,
    "nameEn" TEXT NOT NULL DEFAULT '',
    "nameAr" TEXT NOT NULL DEFAULT '',
    "definitionEn" TEXT NOT NULL DEFAULT '',
    "definitionAr" TEXT NOT NULL DEFAULT '',
    "classification" "DataClassification" NOT NULL DEFAULT 'INTERNAL',
    "systemOfRecordId" UUID,
    "ownerId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" UUID,
    "updatedById" UUID,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "DataObject_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DataObjectUsage" (
    "dataObjectId" UUID NOT NULL,
    "applicationId" UUID NOT NULL,
    "canCreate" BOOLEAN NOT NULL DEFAULT false,
    "canRead" BOOLEAN NOT NULL DEFAULT false,
    "canUpdate" BOOLEAN NOT NULL DEFAULT false,
    "canDelete" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "DataObjectUsage_pkey" PRIMARY KEY ("dataObjectId","applicationId")
);

-- CreateTable
CREATE TABLE "InterfaceDataObject" (
    "interfaceId" UUID NOT NULL,
    "dataObjectId" UUID NOT NULL,

    CONSTRAINT "InterfaceDataObject_pkey" PRIMARY KEY ("interfaceId","dataObjectId")
);

-- CreateTable
CREATE TABLE "Capability" (
    "id" UUID NOT NULL,
    "code" TEXT,
    "nameEn" TEXT NOT NULL DEFAULT '',
    "nameAr" TEXT NOT NULL DEFAULT '',
    "descriptionEn" TEXT NOT NULL DEFAULT '',
    "descriptionAr" TEXT NOT NULL DEFAULT '',
    "parentId" UUID,
    "level" INTEGER NOT NULL DEFAULT 1,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "ownerId" UUID,
    "importance" "StrategicImportance" NOT NULL DEFAULT 'MEDIUM',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" UUID,
    "updatedById" UUID,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Capability_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CapabilityProcess" (
    "capabilityId" UUID NOT NULL,
    "processId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CapabilityProcess_pkey" PRIMARY KEY ("capabilityId","processId")
);

-- CreateTable
CREATE TABLE "CapabilityApplication" (
    "capabilityId" UUID NOT NULL,
    "applicationId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CapabilityApplication_pkey" PRIMARY KEY ("capabilityId","applicationId")
);

-- CreateIndex
CREATE INDEX "Application_lifecycle_idx" ON "Application"("lifecycle");

-- CreateIndex
CREATE INDEX "Application_departmentId_idx" ON "Application"("departmentId");

-- CreateIndex
CREATE INDEX "AppInterface_sourceId_idx" ON "AppInterface"("sourceId");

-- CreateIndex
CREATE INDEX "AppInterface_targetId_idx" ON "AppInterface"("targetId");

-- CreateIndex
CREATE INDEX "DataObjectUsage_applicationId_idx" ON "DataObjectUsage"("applicationId");

-- CreateIndex
CREATE INDEX "InterfaceDataObject_dataObjectId_idx" ON "InterfaceDataObject"("dataObjectId");

-- CreateIndex
CREATE INDEX "Capability_parentId_sortOrder_idx" ON "Capability"("parentId", "sortOrder");

-- CreateIndex
CREATE INDEX "CapabilityProcess_processId_idx" ON "CapabilityProcess"("processId");

-- CreateIndex
CREATE INDEX "CapabilityApplication_applicationId_idx" ON "CapabilityApplication"("applicationId");

-- AddForeignKey
ALTER TABLE "Application" ADD CONSTRAINT "Application_objectId_fkey" FOREIGN KEY ("objectId") REFERENCES "RepoObject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Application" ADD CONSTRAINT "Application_businessOwnerId_fkey" FOREIGN KEY ("businessOwnerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Application" ADD CONSTRAINT "Application_itOwnerId_fkey" FOREIGN KEY ("itOwnerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Application" ADD CONSTRAINT "Application_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AppInterface" ADD CONSTRAINT "AppInterface_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "Application"("objectId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AppInterface" ADD CONSTRAINT "AppInterface_targetId_fkey" FOREIGN KEY ("targetId") REFERENCES "Application"("objectId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AppInterface" ADD CONSTRAINT "AppInterface_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DataObject" ADD CONSTRAINT "DataObject_systemOfRecordId_fkey" FOREIGN KEY ("systemOfRecordId") REFERENCES "Application"("objectId") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DataObject" ADD CONSTRAINT "DataObject_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DataObjectUsage" ADD CONSTRAINT "DataObjectUsage_dataObjectId_fkey" FOREIGN KEY ("dataObjectId") REFERENCES "DataObject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DataObjectUsage" ADD CONSTRAINT "DataObjectUsage_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("objectId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InterfaceDataObject" ADD CONSTRAINT "InterfaceDataObject_interfaceId_fkey" FOREIGN KEY ("interfaceId") REFERENCES "AppInterface"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InterfaceDataObject" ADD CONSTRAINT "InterfaceDataObject_dataObjectId_fkey" FOREIGN KEY ("dataObjectId") REFERENCES "DataObject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Capability" ADD CONSTRAINT "Capability_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Capability"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Capability" ADD CONSTRAINT "Capability_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CapabilityProcess" ADD CONSTRAINT "CapabilityProcess_capabilityId_fkey" FOREIGN KEY ("capabilityId") REFERENCES "Capability"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CapabilityProcess" ADD CONSTRAINT "CapabilityProcess_processId_fkey" FOREIGN KEY ("processId") REFERENCES "Process"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CapabilityApplication" ADD CONSTRAINT "CapabilityApplication_capabilityId_fkey" FOREIGN KEY ("capabilityId") REFERENCES "Capability"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CapabilityApplication" ADD CONSTRAINT "CapabilityApplication_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("objectId") ON DELETE CASCADE ON UPDATE CASCADE;

-- D-107: every existing IT system library object becomes an application catalogue entry (same id, so step
-- links, badges and "where used" keep working). Retired systems (soft-deleted) get a row too.
INSERT INTO "Application" ("objectId")
SELECT "id" FROM "RepoObject" WHERE "type" = 'SYSTEM'
ON CONFLICT DO NOTHING;
