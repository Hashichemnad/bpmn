-- CreateEnum
CREATE TYPE "EventLogSource" AS ENUM ('FILE', 'PROCESSHUB');

-- CreateEnum
CREATE TYPE "EventLogStatus" AS ENUM ('DRAFT', 'IMPORTING', 'READY', 'FAILED', 'DELETING');

-- CreateEnum
CREATE TYPE "MiningJobStatus" AS ENUM ('QUEUED', 'RUNNING', 'DONE', 'FAILED', 'CANCELLED');


-- CreateTable
CREATE TABLE "EventLog" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL DEFAULT '',
    "nameAr" TEXT NOT NULL DEFAULT '',
    "descriptionEn" TEXT NOT NULL DEFAULT '',
    "descriptionAr" TEXT NOT NULL DEFAULT '',
    "source" "EventLogSource" NOT NULL DEFAULT 'FILE',
    "status" "EventLogStatus" NOT NULL DEFAULT 'DRAFT',
    "processId" UUID,
    "ownerId" UUID,
    "departmentId" UUID,
    "fileKey" TEXT,
    "fileName" TEXT,
    "fileFormat" TEXT,
    "fileSize" INTEGER,
    "mapping" JSONB,
    "timeZone" TEXT NOT NULL DEFAULT 'Asia/Dubai',
    "pseudonymised" BOOLEAN NOT NULL DEFAULT false,
    "dataVersion" INTEGER NOT NULL DEFAULT 0,
    "snapshotKey" TEXT,
    "periodStart" TIMESTAMP(3),
    "periodEnd" TIMESTAMP(3),
    "caseCount" INTEGER NOT NULL DEFAULT 0,
    "eventCount" INTEGER NOT NULL DEFAULT 0,
    "activityCount" INTEGER NOT NULL DEFAULT 0,
    "resourceCount" INTEGER NOT NULL DEFAULT 0,
    "hasStartTimes" BOOLEAN NOT NULL DEFAULT false,
    "attributeNames" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "importReport" JSONB,
    "importedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" UUID,
    "updatedById" UUID,

    CONSTRAINT "EventLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventLogGrant" (
    "logId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" UUID,

    CONSTRAINT "EventLogGrant_pkey" PRIMARY KEY ("logId","userId")
);

-- CreateTable
CREATE TABLE "MiningEvent" (
    "id" BIGSERIAL NOT NULL,
    "logId" UUID NOT NULL,
    "caseId" TEXT NOT NULL,
    "activity" TEXT NOT NULL,
    "startAt" TIMESTAMP(3),
    "endAt" TIMESTAMP(3) NOT NULL,
    "resource" TEXT,
    "department" TEXT,
    "attributes" JSONB,

    CONSTRAINT "MiningEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MiningActivity" (
    "logId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "eventCount" INTEGER NOT NULL DEFAULT 0,
    "caseCount" INTEGER NOT NULL DEFAULT 0,
    "bpmnElementId" TEXT,
    "match" TEXT,

    CONSTRAINT "MiningActivity_pkey" PRIMARY KEY ("logId","name")
);

-- CreateTable
CREATE TABLE "MiningJob" (
    "id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "status" "MiningJobStatus" NOT NULL DEFAULT 'QUEUED',
    "progress" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "message" TEXT NOT NULL DEFAULT '',
    "logId" UUID,
    "scenarioId" UUID,
    "params" JSONB,
    "result" JSONB,
    "error" TEXT,
    "cancelRequested" BOOLEAN NOT NULL DEFAULT false,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "MiningJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MiningResultCache" (
    "key" TEXT NOT NULL,
    "logId" UUID NOT NULL,
    "dataVersion" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "result" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MiningResultCache_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "MiningMappingTemplate" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "mapping" JSONB NOT NULL,
    "ownerId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MiningMappingTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MiningFilterPreset" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "logId" UUID,
    "name" TEXT NOT NULL,
    "filters" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MiningFilterPreset_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EventLog_processId_idx" ON "EventLog"("processId");

-- CreateIndex
CREATE INDEX "EventLog_ownerId_idx" ON "EventLog"("ownerId");

-- CreateIndex
CREATE INDEX "EventLog_departmentId_idx" ON "EventLog"("departmentId");

-- CreateIndex
CREATE INDEX "EventLogGrant_userId_idx" ON "EventLogGrant"("userId");

-- CreateIndex
CREATE INDEX "MiningEvent_logId_caseId_endAt_idx" ON "MiningEvent"("logId", "caseId", "endAt");

-- CreateIndex
CREATE INDEX "MiningEvent_logId_activity_idx" ON "MiningEvent"("logId", "activity");

-- CreateIndex
CREATE INDEX "MiningJob_status_createdAt_idx" ON "MiningJob"("status", "createdAt");

-- CreateIndex
CREATE INDEX "MiningJob_logId_idx" ON "MiningJob"("logId");

-- CreateIndex
CREATE INDEX "MiningJob_scenarioId_idx" ON "MiningJob"("scenarioId");

-- CreateIndex
CREATE INDEX "MiningResultCache_logId_idx" ON "MiningResultCache"("logId");

-- CreateIndex
CREATE INDEX "MiningMappingTemplate_ownerId_idx" ON "MiningMappingTemplate"("ownerId");

-- CreateIndex
CREATE INDEX "MiningFilterPreset_userId_logId_idx" ON "MiningFilterPreset"("userId", "logId");

-- AddForeignKey
ALTER TABLE "EventLog" ADD CONSTRAINT "EventLog_processId_fkey" FOREIGN KEY ("processId") REFERENCES "Process"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventLog" ADD CONSTRAINT "EventLog_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventLog" ADD CONSTRAINT "EventLog_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventLogGrant" ADD CONSTRAINT "EventLogGrant_logId_fkey" FOREIGN KEY ("logId") REFERENCES "EventLog"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventLogGrant" ADD CONSTRAINT "EventLogGrant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MiningActivity" ADD CONSTRAINT "MiningActivity_logId_fkey" FOREIGN KEY ("logId") REFERENCES "EventLog"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MiningJob" ADD CONSTRAINT "MiningJob_logId_fkey" FOREIGN KEY ("logId") REFERENCES "EventLog"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MiningResultCache" ADD CONSTRAINT "MiningResultCache_logId_fkey" FOREIGN KEY ("logId") REFERENCES "EventLog"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MiningMappingTemplate" ADD CONSTRAINT "MiningMappingTemplate_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MiningFilterPreset" ADD CONSTRAINT "MiningFilterPreset_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MiningFilterPreset" ADD CONSTRAINT "MiningFilterPreset_logId_fkey" FOREIGN KEY ("logId") REFERENCES "EventLog"("id") ON DELETE CASCADE ON UPDATE CASCADE;
