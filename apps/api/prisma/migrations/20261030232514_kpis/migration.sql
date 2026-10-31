-- CreateEnum
CREATE TYPE "KpiDirection" AS ENUM ('HIGHER_IS_BETTER', 'LOWER_IS_BETTER');

-- CreateEnum
CREATE TYPE "KpiFrequency" AS ENUM ('MONTHLY', 'QUARTERLY', 'ANNUAL');

-- CreateEnum
CREATE TYPE "KpiDataSource" AS ENUM ('MANUAL', 'EXCEL', 'SALESFORCE', 'CALCULATED');

-- CreateEnum
CREATE TYPE "KpiStatus" AS ENUM ('DRAFT', 'ACTIVE', 'RETIRED');

-- AlterTable

-- CreateTable
CREATE TABLE "Kpi" (
    "objectId" UUID NOT NULL,
    "formulaEn" TEXT NOT NULL DEFAULT '',
    "formulaAr" TEXT NOT NULL DEFAULT '',
    "unit" TEXT NOT NULL DEFAULT '',
    "direction" "KpiDirection" NOT NULL DEFAULT 'HIGHER_IS_BETTER',
    "frequency" "KpiFrequency" NOT NULL DEFAULT 'MONTHLY',
    "target" DOUBLE PRECISION,
    "greenThreshold" DOUBLE PRECISION,
    "redThreshold" DOUBLE PRECISION,
    "baseline" DOUBLE PRECISION,
    "baselinePeriod" TEXT,
    "departmentId" UUID,
    "dataSource" "KpiDataSource" NOT NULL DEFAULT 'MANUAL',
    "status" "KpiStatus" NOT NULL DEFAULT 'ACTIVE',
    "calculatedMetric" TEXT,
    "calculatedProcessId" UUID,
    "salesforceId" TEXT,
    "salesforceUrl" TEXT,
    "lastSyncedAt" TIMESTAMP(3),
    "lockedFields" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "reminderSentFor" TEXT,

    CONSTRAINT "Kpi_pkey" PRIMARY KEY ("objectId")
);

-- CreateTable
CREATE TABLE "KpiPeriodTarget" (
    "kpiId" UUID NOT NULL,
    "period" TEXT NOT NULL,
    "target" DOUBLE PRECISION,
    "greenThreshold" DOUBLE PRECISION,
    "redThreshold" DOUBLE PRECISION,

    CONSTRAINT "KpiPeriodTarget_pkey" PRIMARY KEY ("kpiId","period")
);

-- CreateTable
CREATE TABLE "KpiMeasurement" (
    "id" UUID NOT NULL,
    "kpiId" UUID NOT NULL,
    "period" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "comment" TEXT NOT NULL DEFAULT '',
    "source" "KpiDataSource" NOT NULL DEFAULT 'MANUAL',
    "salesforceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" UUID,
    "updatedById" UUID,

    CONSTRAINT "KpiMeasurement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StrategicObjective" (
    "id" UUID NOT NULL,
    "code" TEXT,
    "nameEn" TEXT NOT NULL DEFAULT '',
    "nameAr" TEXT NOT NULL DEFAULT '',
    "descriptionEn" TEXT NOT NULL DEFAULT '',
    "descriptionAr" TEXT NOT NULL DEFAULT '',
    "parentId" UUID,
    "ownerId" UUID,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "salesforceId" TEXT,
    "lastSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" UUID,
    "updatedById" UUID,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "StrategicObjective_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KpiObjective" (
    "kpiId" UUID NOT NULL,
    "objectiveId" UUID NOT NULL,

    CONSTRAINT "KpiObjective_pkey" PRIMARY KEY ("kpiId","objectiveId")
);

-- CreateTable
CREATE TABLE "KpiCapability" (
    "kpiId" UUID NOT NULL,
    "capabilityId" UUID NOT NULL,

    CONSTRAINT "KpiCapability_pkey" PRIMARY KEY ("kpiId","capabilityId")
);

-- CreateTable
CREATE TABLE "KpiRisk" (
    "kpiId" UUID NOT NULL,
    "riskId" UUID NOT NULL,

    CONSTRAINT "KpiRisk_pkey" PRIMARY KEY ("kpiId","riskId")
);

-- CreateIndex
CREATE UNIQUE INDEX "Kpi_salesforceId_key" ON "Kpi"("salesforceId");

-- CreateIndex
CREATE INDEX "Kpi_status_idx" ON "Kpi"("status");

-- CreateIndex
CREATE INDEX "Kpi_departmentId_idx" ON "Kpi"("departmentId");

-- CreateIndex
CREATE INDEX "KpiMeasurement_kpiId_periodStart_idx" ON "KpiMeasurement"("kpiId", "periodStart");

-- CreateIndex
CREATE UNIQUE INDEX "KpiMeasurement_kpiId_period_key" ON "KpiMeasurement"("kpiId", "period");

-- CreateIndex
CREATE UNIQUE INDEX "StrategicObjective_salesforceId_key" ON "StrategicObjective"("salesforceId");

-- CreateIndex
CREATE INDEX "StrategicObjective_parentId_sortOrder_idx" ON "StrategicObjective"("parentId", "sortOrder");

-- CreateIndex
CREATE INDEX "KpiObjective_objectiveId_idx" ON "KpiObjective"("objectiveId");

-- CreateIndex
CREATE INDEX "KpiCapability_capabilityId_idx" ON "KpiCapability"("capabilityId");

-- CreateIndex
CREATE INDEX "KpiRisk_riskId_idx" ON "KpiRisk"("riskId");

-- AddForeignKey
ALTER TABLE "Kpi" ADD CONSTRAINT "Kpi_objectId_fkey" FOREIGN KEY ("objectId") REFERENCES "RepoObject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Kpi" ADD CONSTRAINT "Kpi_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Kpi" ADD CONSTRAINT "Kpi_calculatedProcessId_fkey" FOREIGN KEY ("calculatedProcessId") REFERENCES "Process"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KpiPeriodTarget" ADD CONSTRAINT "KpiPeriodTarget_kpiId_fkey" FOREIGN KEY ("kpiId") REFERENCES "Kpi"("objectId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KpiMeasurement" ADD CONSTRAINT "KpiMeasurement_kpiId_fkey" FOREIGN KEY ("kpiId") REFERENCES "Kpi"("objectId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StrategicObjective" ADD CONSTRAINT "StrategicObjective_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "StrategicObjective"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StrategicObjective" ADD CONSTRAINT "StrategicObjective_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KpiObjective" ADD CONSTRAINT "KpiObjective_kpiId_fkey" FOREIGN KEY ("kpiId") REFERENCES "Kpi"("objectId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KpiObjective" ADD CONSTRAINT "KpiObjective_objectiveId_fkey" FOREIGN KEY ("objectiveId") REFERENCES "StrategicObjective"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KpiCapability" ADD CONSTRAINT "KpiCapability_kpiId_fkey" FOREIGN KEY ("kpiId") REFERENCES "Kpi"("objectId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KpiCapability" ADD CONSTRAINT "KpiCapability_capabilityId_fkey" FOREIGN KEY ("capabilityId") REFERENCES "Capability"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KpiRisk" ADD CONSTRAINT "KpiRisk_kpiId_fkey" FOREIGN KEY ("kpiId") REFERENCES "Kpi"("objectId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KpiRisk" ADD CONSTRAINT "KpiRisk_riskId_fkey" FOREIGN KEY ("riskId") REFERENCES "Risk"("objectId") ON DELETE CASCADE ON UPDATE CASCADE;

-- D-111: every existing KPI library object becomes a KPI (same id, so its step links keep working).
INSERT INTO "Kpi" ("objectId", "status")
SELECT "id", 'ACTIVE' FROM "RepoObject" WHERE "type" = 'KPI'
ON CONFLICT DO NOTHING;
