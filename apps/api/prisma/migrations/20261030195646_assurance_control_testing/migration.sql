-- AlterTable
ALTER TABLE "Control" ADD COLUMN     "lastTestedAt" TIMESTAMP(3),
ADD COLUMN     "operatingEffectiveness" "ControlEffectiveness" NOT NULL DEFAULT 'NOT_ASSESSED';

-- CreateTable
CREATE TABLE "ControlTestPlan" (
    "id" UUID NOT NULL,
    "controlId" UUID NOT NULL,
    "testType" TEXT NOT NULL,
    "procedure" JSONB NOT NULL DEFAULT '[]',
    "sampleSize" INTEGER NOT NULL DEFAULT 1,
    "frequency" TEXT NOT NULL,
    "testerId" UUID,
    "testerRoleKey" TEXT,
    "reviewerId" UUID,
    "reviewerRoleKey" TEXT,
    "nextDueAt" TIMESTAMP(3),
    "leadDays" INTEGER NOT NULL DEFAULT 30,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" UUID,
    "updatedById" UUID,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "ControlTestPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ControlTest" (
    "id" UUID NOT NULL,
    "planId" UUID,
    "controlId" UUID NOT NULL,
    "testType" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PLANNED',
    "origin" TEXT NOT NULL DEFAULT 'MANUAL',
    "procedure" JSONB NOT NULL DEFAULT '[]',
    "sampleSize" INTEGER NOT NULL DEFAULT 1,
    "testerId" UUID,
    "testerRoleKey" TEXT,
    "reviewerId" UUID,
    "reviewerRoleKey" TEXT,
    "samples" JSONB NOT NULL DEFAULT '[]',
    "conclusion" TEXT,
    "testerComment" TEXT NOT NULL DEFAULT '',
    "reviewComment" TEXT NOT NULL DEFAULT '',
    "executedById" UUID,
    "reviewedById" UUID,
    "startedAt" TIMESTAMP(3),
    "submittedAt" TIMESTAMP(3),
    "reviewedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "dueNotifiedAt" TIMESTAMP(3),
    "overdueNotifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" UUID,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "ControlTest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssuranceFile" (
    "id" UUID NOT NULL,
    "ownerType" TEXT NOT NULL,
    "ownerId" UUID NOT NULL,
    "fileName" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "storageKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" UUID,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "AssuranceFile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssuranceEvent" (
    "id" UUID NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "changes" JSONB NOT NULL DEFAULT '{}',
    "comment" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" UUID,

    CONSTRAINT "AssuranceEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ControlTestPlan_controlId_idx" ON "ControlTestPlan"("controlId");

-- CreateIndex
CREATE INDEX "ControlTestPlan_active_nextDueAt_idx" ON "ControlTestPlan"("active", "nextDueAt");

-- CreateIndex
CREATE INDEX "ControlTest_controlId_idx" ON "ControlTest"("controlId");

-- CreateIndex
CREATE INDEX "ControlTest_planId_dueAt_idx" ON "ControlTest"("planId", "dueAt");

-- CreateIndex
CREATE INDEX "ControlTest_status_dueAt_idx" ON "ControlTest"("status", "dueAt");

-- CreateIndex
CREATE INDEX "ControlTest_testerId_idx" ON "ControlTest"("testerId");

-- CreateIndex
CREATE INDEX "ControlTest_reviewerId_idx" ON "ControlTest"("reviewerId");

-- CreateIndex
CREATE UNIQUE INDEX "AssuranceFile_storageKey_key" ON "AssuranceFile"("storageKey");

-- CreateIndex
CREATE INDEX "AssuranceFile_ownerType_ownerId_idx" ON "AssuranceFile"("ownerType", "ownerId");

-- CreateIndex
CREATE INDEX "AssuranceEvent_entityType_entityId_createdAt_idx" ON "AssuranceEvent"("entityType", "entityId", "createdAt");

-- AddForeignKey
ALTER TABLE "ControlTestPlan" ADD CONSTRAINT "ControlTestPlan_controlId_fkey" FOREIGN KEY ("controlId") REFERENCES "Control"("objectId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ControlTest" ADD CONSTRAINT "ControlTest_planId_fkey" FOREIGN KEY ("planId") REFERENCES "ControlTestPlan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ControlTest" ADD CONSTRAINT "ControlTest_controlId_fkey" FOREIGN KEY ("controlId") REFERENCES "Control"("objectId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssuranceEvent" ADD CONSTRAINT "AssuranceEvent_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
