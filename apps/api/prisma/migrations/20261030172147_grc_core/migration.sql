-- CreateEnum
CREATE TYPE "GrcStatus" AS ENUM ('DRAFT', 'ACTIVE', 'RETIRED');

-- CreateEnum
CREATE TYPE "RiskResponse" AS ENUM ('ACCEPT', 'AVOID', 'MITIGATE', 'TRANSFER');

-- CreateEnum
CREATE TYPE "ControlType" AS ENUM ('PREVENTIVE', 'DETECTIVE', 'CORRECTIVE');

-- CreateEnum
CREATE TYPE "ControlNature" AS ENUM ('MANUAL', 'AUTOMATED', 'IT_DEPENDENT_MANUAL');

-- CreateEnum
CREATE TYPE "ControlFrequency" AS ENUM ('PER_TRANSACTION', 'DAILY', 'WEEKLY', 'MONTHLY', 'QUARTERLY', 'ANNUAL', 'AD_HOC');

-- CreateEnum
CREATE TYPE "ControlEffectiveness" AS ENUM ('EFFECTIVE', 'PARTLY', 'NOT_EFFECTIVE', 'NOT_ASSESSED');

-- CreateEnum
CREATE TYPE "RequirementLevel" AS ENUM ('SOURCE', 'SECTION', 'CLAUSE');

-- CreateEnum
CREATE TYPE "GrcActivityKind" AS ENUM ('CREATED', 'ASSESSMENT', 'STATUS', 'COMMENT');

-- AlterEnum
ALTER TYPE "LinkRelation" ADD VALUE 'REQUIRES';

-- AlterEnum
ALTER TYPE "ObjectType" ADD VALUE 'REQUIREMENT';

-- CreateTable
CREATE TABLE "Risk" (
    "objectId" UUID NOT NULL,
    "category" TEXT NOT NULL,
    "causeEn" TEXT NOT NULL DEFAULT '',
    "causeAr" TEXT NOT NULL DEFAULT '',
    "consequenceEn" TEXT NOT NULL DEFAULT '',
    "consequenceAr" TEXT NOT NULL DEFAULT '',
    "departmentId" UUID,
    "inherentLikelihood" INTEGER NOT NULL,
    "inherentImpact" INTEGER NOT NULL,
    "residualLikelihood" INTEGER,
    "residualImpact" INTEGER,
    "response" "RiskResponse" NOT NULL DEFAULT 'MITIGATE',
    "status" "GrcStatus" NOT NULL DEFAULT 'DRAFT',
    "nextReviewAt" TIMESTAMP(3),
    "lastAssessedAt" TIMESTAMP(3),
    "reminderSentFor" TIMESTAMP(3),

    CONSTRAINT "Risk_pkey" PRIMARY KEY ("objectId")
);

-- CreateTable
CREATE TABLE "Control" (
    "objectId" UUID NOT NULL,
    "controlType" "ControlType" NOT NULL DEFAULT 'PREVENTIVE',
    "nature" "ControlNature" NOT NULL DEFAULT 'MANUAL',
    "frequency" "ControlFrequency" NOT NULL DEFAULT 'PER_TRANSACTION',
    "departmentId" UUID,
    "keyControl" BOOLEAN NOT NULL DEFAULT false,
    "systemId" UUID,
    "effectiveness" "ControlEffectiveness" NOT NULL DEFAULT 'NOT_ASSESSED',
    "status" "GrcStatus" NOT NULL DEFAULT 'DRAFT',
    "nextReviewAt" TIMESTAMP(3),
    "lastAssessedAt" TIMESTAMP(3),
    "reminderSentFor" TIMESTAMP(3),

    CONSTRAINT "Control_pkey" PRIMARY KEY ("objectId")
);

-- CreateTable
CREATE TABLE "Requirement" (
    "objectId" UUID NOT NULL,
    "level" "RequirementLevel" NOT NULL DEFAULT 'SOURCE',
    "parentId" UUID,
    "sourceRef" TEXT NOT NULL DEFAULT '',
    "url" TEXT,
    "departmentId" UUID,
    "effectiveDate" TIMESTAMP(3),
    "status" "GrcStatus" NOT NULL DEFAULT 'ACTIVE',
    "nextReviewAt" TIMESTAMP(3),

    CONSTRAINT "Requirement_pkey" PRIMARY KEY ("objectId")
);

-- CreateTable
CREATE TABLE "RiskControl" (
    "riskId" UUID NOT NULL,
    "controlId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" UUID,

    CONSTRAINT "RiskControl_pkey" PRIMARY KEY ("riskId","controlId")
);

-- CreateTable
CREATE TABLE "RequirementControl" (
    "requirementId" UUID NOT NULL,
    "controlId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" UUID,

    CONSTRAINT "RequirementControl_pkey" PRIMARY KEY ("requirementId","controlId")
);

-- CreateTable
CREATE TABLE "GrcActivity" (
    "id" UUID NOT NULL,
    "objectId" UUID NOT NULL,
    "kind" "GrcActivityKind" NOT NULL,
    "changes" JSONB NOT NULL DEFAULT '{}',
    "comment" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" UUID,

    CONSTRAINT "GrcActivity_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Risk_status_idx" ON "Risk"("status");

-- CreateIndex
CREATE INDEX "Risk_departmentId_idx" ON "Risk"("departmentId");

-- CreateIndex
CREATE INDEX "Risk_nextReviewAt_idx" ON "Risk"("nextReviewAt");

-- CreateIndex
CREATE INDEX "Control_status_idx" ON "Control"("status");

-- CreateIndex
CREATE INDEX "Control_departmentId_idx" ON "Control"("departmentId");

-- CreateIndex
CREATE INDEX "Control_nextReviewAt_idx" ON "Control"("nextReviewAt");

-- CreateIndex
CREATE INDEX "Requirement_parentId_idx" ON "Requirement"("parentId");

-- CreateIndex
CREATE INDEX "Requirement_status_idx" ON "Requirement"("status");

-- CreateIndex
CREATE INDEX "RiskControl_controlId_idx" ON "RiskControl"("controlId");

-- CreateIndex
CREATE INDEX "RequirementControl_controlId_idx" ON "RequirementControl"("controlId");

-- CreateIndex
CREATE INDEX "GrcActivity_objectId_createdAt_idx" ON "GrcActivity"("objectId", "createdAt");

-- AddForeignKey
ALTER TABLE "Risk" ADD CONSTRAINT "Risk_objectId_fkey" FOREIGN KEY ("objectId") REFERENCES "RepoObject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Risk" ADD CONSTRAINT "Risk_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Control" ADD CONSTRAINT "Control_objectId_fkey" FOREIGN KEY ("objectId") REFERENCES "RepoObject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Control" ADD CONSTRAINT "Control_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Control" ADD CONSTRAINT "Control_systemId_fkey" FOREIGN KEY ("systemId") REFERENCES "RepoObject"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Requirement" ADD CONSTRAINT "Requirement_objectId_fkey" FOREIGN KEY ("objectId") REFERENCES "RepoObject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Requirement" ADD CONSTRAINT "Requirement_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Requirement"("objectId") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Requirement" ADD CONSTRAINT "Requirement_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiskControl" ADD CONSTRAINT "RiskControl_riskId_fkey" FOREIGN KEY ("riskId") REFERENCES "Risk"("objectId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiskControl" ADD CONSTRAINT "RiskControl_controlId_fkey" FOREIGN KEY ("controlId") REFERENCES "Control"("objectId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequirementControl" ADD CONSTRAINT "RequirementControl_requirementId_fkey" FOREIGN KEY ("requirementId") REFERENCES "Requirement"("objectId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequirementControl" ADD CONSTRAINT "RequirementControl_controlId_fkey" FOREIGN KEY ("controlId") REFERENCES "Control"("objectId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GrcActivity" ADD CONSTRAINT "GrcActivity_objectId_fkey" FOREIGN KEY ("objectId") REFERENCES "RepoObject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GrcActivity" ADD CONSTRAINT "GrcActivity_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Library objects of type RISK / CONTROL created before Phase 4.1 (attributes only) get a register
-- entry with neutral defaults, so every RISK / CONTROL object has its details row (D-089).
INSERT INTO "Risk" ("objectId", "category", "inherentLikelihood", "inherentImpact", "status")
SELECT "id", 'OPERATIONAL', 3, 3, 'ACTIVE' FROM "RepoObject" WHERE "type" = 'RISK';

INSERT INTO "Control" ("objectId", "status")
SELECT "id", 'ACTIVE' FROM "RepoObject" WHERE "type" = 'CONTROL';
