-- CreateEnum
CREATE TYPE "WorkflowCaseStatus" AS ENUM ('RUNNING', 'COMPLETED', 'CANCELLED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "WorkflowTaskStatus" AS ENUM ('OPEN', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "WorkflowJobStatus" AS ENUM ('PENDING', 'RUNNING', 'DONE', 'FAILED', 'CANCELLED');

-- AlterEnum
ALTER TYPE "EventLogSource" ADD VALUE 'WORKFLOW';

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "outOfOfficeFrom" DATE,
ADD COLUMN     "outOfOfficeTo" DATE,
ADD COLUMN     "substituteId" UUID;

-- CreateTable
CREATE TABLE "WorkflowProcessConfig" (
    "processId" UUID NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "casePrefix" TEXT NOT NULL,
    "startMode" TEXT NOT NULL DEFAULT 'ALL',
    "startRoles" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "startDepartmentIds" UUID[] DEFAULT ARRAY[]::UUID[],
    "allowWithdraw" BOOLEAN NOT NULL DEFAULT true,
    "monitorUserIds" UUID[] DEFAULT ARRAY[]::UUID[],
    "retentionDays" INTEGER,
    "eventLog" BOOLEAN NOT NULL DEFAULT true,
    "pseudonymiseLog" BOOLEAN NOT NULL DEFAULT false,
    "eventLogId" UUID,
    "activeDefinitionId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" UUID,
    "updatedById" UUID,

    CONSTRAINT "WorkflowProcessConfig_pkey" PRIMARY KEY ("processId")
);

-- CreateTable
CREATE TABLE "WorkflowDefinition" (
    "id" UUID NOT NULL,
    "processId" UUID NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "versionLabel" TEXT,
    "bpmnXml" TEXT NOT NULL,
    "model" JSONB NOT NULL,
    "decisions" JSONB NOT NULL DEFAULT '{}',
    "deployedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deployedById" UUID,

    CONSTRAINT "WorkflowDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkflowCase" (
    "id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "definitionId" UUID NOT NULL,
    "processId" UUID NOT NULL,
    "status" "WorkflowCaseStatus" NOT NULL DEFAULT 'RUNNING',
    "outcome" TEXT,
    "errorCode" TEXT,
    "titleEn" TEXT NOT NULL DEFAULT '',
    "titleAr" TEXT NOT NULL DEFAULT '',
    "initiatorId" UUID,
    "departmentId" UUID,
    "variables" JSONB NOT NULL DEFAULT '{}',
    "state" JSONB NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,
    "stuck" BOOLEAN NOT NULL DEFAULT false,
    "parentCaseId" UUID,
    "parentTokenId" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "closedReason" TEXT,
    "closedById" UUID,
    "dataPurgedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkflowCase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkflowTask" (
    "id" UUID NOT NULL,
    "caseId" UUID NOT NULL,
    "tokenId" TEXT NOT NULL,
    "elementId" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL DEFAULT '',
    "nameAr" TEXT NOT NULL DEFAULT '',
    "approval" BOOLEAN NOT NULL DEFAULT false,
    "status" "WorkflowTaskStatus" NOT NULL DEFAULT 'OPEN',
    "assigneeId" UUID,
    "onBehalfOfId" UUID,
    "dueAt" TIMESTAMP(3),
    "draft" JSONB,
    "data" JSONB,
    "decision" TEXT,
    "comment" TEXT,
    "completedAt" TIMESTAMP(3),
    "completedById" UUID,
    "version" INTEGER NOT NULL DEFAULT 0,
    "reminderSentAt" TIMESTAMP(3),
    "escalatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkflowTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkflowTaskCandidate" (
    "taskId" UUID NOT NULL,
    "userId" UUID NOT NULL,

    CONSTRAINT "WorkflowTaskCandidate_pkey" PRIMARY KEY ("taskId","userId")
);

-- CreateTable
CREATE TABLE "WorkflowJob" (
    "id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "caseId" UUID,
    "definitionId" UUID,
    "tokenId" TEXT,
    "elementId" TEXT,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "status" "WorkflowJobStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "error" TEXT,
    "data" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkflowJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkflowEvent" (
    "id" UUID NOT NULL,
    "caseId" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "elementId" TEXT,
    "tokenId" TEXT,
    "userId" UUID,
    "data" JSONB NOT NULL DEFAULT '{}',
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkflowEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkflowFile" (
    "id" UUID NOT NULL,
    "caseId" UUID,
    "taskId" UUID,
    "kind" TEXT NOT NULL DEFAULT 'UPLOAD',
    "name" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "storageKey" TEXT NOT NULL,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkflowFile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkflowCaseComment" (
    "id" UUID NOT NULL,
    "caseId" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "mentionIds" UUID[],
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkflowCaseComment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkflowCaseCounter" (
    "prefix" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "last" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "WorkflowCaseCounter_pkey" PRIMARY KEY ("prefix","year")
);

-- CreateIndex
CREATE UNIQUE INDEX "WorkflowDefinition_processId_versionNumber_key" ON "WorkflowDefinition"("processId", "versionNumber");

-- CreateIndex
CREATE UNIQUE INDEX "WorkflowCase_number_key" ON "WorkflowCase"("number");

-- CreateIndex
CREATE INDEX "WorkflowCase_processId_status_idx" ON "WorkflowCase"("processId", "status");

-- CreateIndex
CREATE INDEX "WorkflowCase_initiatorId_startedAt_idx" ON "WorkflowCase"("initiatorId", "startedAt");

-- CreateIndex
CREATE INDEX "WorkflowCase_status_stuck_idx" ON "WorkflowCase"("status", "stuck");

-- CreateIndex
CREATE INDEX "WorkflowCase_parentCaseId_idx" ON "WorkflowCase"("parentCaseId");

-- CreateIndex
CREATE INDEX "WorkflowCase_departmentId_idx" ON "WorkflowCase"("departmentId");

-- CreateIndex
CREATE INDEX "WorkflowTask_assigneeId_status_idx" ON "WorkflowTask"("assigneeId", "status");

-- CreateIndex
CREATE INDEX "WorkflowTask_caseId_idx" ON "WorkflowTask"("caseId");

-- CreateIndex
CREATE INDEX "WorkflowTask_status_dueAt_idx" ON "WorkflowTask"("status", "dueAt");

-- CreateIndex
CREATE INDEX "WorkflowTaskCandidate_userId_idx" ON "WorkflowTaskCandidate"("userId");

-- CreateIndex
CREATE INDEX "WorkflowJob_status_dueAt_idx" ON "WorkflowJob"("status", "dueAt");

-- CreateIndex
CREATE INDEX "WorkflowJob_caseId_tokenId_idx" ON "WorkflowJob"("caseId", "tokenId");

-- CreateIndex
CREATE INDEX "WorkflowJob_definitionId_idx" ON "WorkflowJob"("definitionId");

-- CreateIndex
CREATE INDEX "WorkflowEvent_caseId_at_idx" ON "WorkflowEvent"("caseId", "at");

-- CreateIndex
CREATE INDEX "WorkflowEvent_type_at_idx" ON "WorkflowEvent"("type", "at");

-- CreateIndex
CREATE INDEX "WorkflowFile_caseId_idx" ON "WorkflowFile"("caseId");

-- CreateIndex
CREATE INDEX "WorkflowFile_createdById_caseId_idx" ON "WorkflowFile"("createdById", "caseId");

-- CreateIndex
CREATE INDEX "WorkflowCaseComment_caseId_createdAt_idx" ON "WorkflowCaseComment"("caseId", "createdAt");

-- AddForeignKey
ALTER TABLE "WorkflowProcessConfig" ADD CONSTRAINT "WorkflowProcessConfig_processId_fkey" FOREIGN KEY ("processId") REFERENCES "Process"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowDefinition" ADD CONSTRAINT "WorkflowDefinition_processId_fkey" FOREIGN KEY ("processId") REFERENCES "Process"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowCase" ADD CONSTRAINT "WorkflowCase_definitionId_fkey" FOREIGN KEY ("definitionId") REFERENCES "WorkflowDefinition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowCase" ADD CONSTRAINT "WorkflowCase_processId_fkey" FOREIGN KEY ("processId") REFERENCES "Process"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowTask" ADD CONSTRAINT "WorkflowTask_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "WorkflowCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowTaskCandidate" ADD CONSTRAINT "WorkflowTaskCandidate_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "WorkflowTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowEvent" ADD CONSTRAINT "WorkflowEvent_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "WorkflowCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowFile" ADD CONSTRAINT "WorkflowFile_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "WorkflowCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowCaseComment" ADD CONSTRAINT "WorkflowCaseComment_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "WorkflowCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;
