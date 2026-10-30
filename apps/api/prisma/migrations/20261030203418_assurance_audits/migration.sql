-- CreateTable
CREATE TABLE "AuditEngagement" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "titleEn" TEXT NOT NULL DEFAULT '',
    "titleAr" TEXT NOT NULL DEFAULT '',
    "objectiveEn" TEXT NOT NULL DEFAULT '',
    "objectiveAr" TEXT NOT NULL DEFAULT '',
    "scopeEn" TEXT NOT NULL DEFAULT '',
    "scopeAr" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'PLANNED',
    "leadId" UUID,
    "teamIds" UUID[],
    "plannedStart" TIMESTAMP(3),
    "plannedEnd" TIMESTAMP(3),
    "actualStart" TIMESTAMP(3),
    "actualEnd" TIMESTAMP(3),
    "processIds" UUID[],
    "departmentIds" UUID[],
    "riskIds" UUID[],
    "controlIds" UUID[],
    "requirementIds" UUID[],
    "summaryEn" TEXT NOT NULL DEFAULT '',
    "summaryAr" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" UUID,
    "updatedById" UUID,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "AuditEngagement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditWorkItem" (
    "id" UUID NOT NULL,
    "engagementId" UUID NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "titleEn" TEXT NOT NULL DEFAULT '',
    "titleAr" TEXT NOT NULL DEFAULT '',
    "procedure" JSONB NOT NULL DEFAULT '[]',
    "controlId" UUID,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "result" TEXT,
    "notes" TEXT NOT NULL DEFAULT '',
    "assigneeId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" UUID,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "AuditWorkItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditFinding" (
    "id" UUID NOT NULL,
    "engagementId" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "titleEn" TEXT NOT NULL DEFAULT '',
    "titleAr" TEXT NOT NULL DEFAULT '',
    "rating" TEXT NOT NULL,
    "conditionEn" TEXT NOT NULL DEFAULT '',
    "conditionAr" TEXT NOT NULL DEFAULT '',
    "criteriaEn" TEXT NOT NULL DEFAULT '',
    "criteriaAr" TEXT NOT NULL DEFAULT '',
    "requirementId" UUID,
    "causeEn" TEXT NOT NULL DEFAULT '',
    "causeAr" TEXT NOT NULL DEFAULT '',
    "effectEn" TEXT NOT NULL DEFAULT '',
    "effectAr" TEXT NOT NULL DEFAULT '',
    "recommendationEn" TEXT NOT NULL DEFAULT '',
    "recommendationAr" TEXT NOT NULL DEFAULT '',
    "processId" UUID,
    "bpmnElementId" TEXT,
    "riskId" UUID,
    "controlId" UUID,
    "workItemId" UUID,
    "responseStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "responseOwnerId" UUID,
    "agreedActionEn" TEXT NOT NULL DEFAULT '',
    "agreedActionAr" TEXT NOT NULL DEFAULT '',
    "targetDate" TIMESTAMP(3),
    "responseComment" TEXT NOT NULL DEFAULT '',
    "respondedAt" TIMESTAMP(3),
    "respondedById" UUID,
    "issueId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" UUID,
    "updatedById" UUID,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "AuditFinding_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AuditEngagement_code_key" ON "AuditEngagement"("code");

-- CreateIndex
CREATE INDEX "AuditEngagement_year_status_idx" ON "AuditEngagement"("year", "status");

-- CreateIndex
CREATE INDEX "AuditWorkItem_engagementId_idx" ON "AuditWorkItem"("engagementId");

-- CreateIndex
CREATE INDEX "AuditFinding_responseOwnerId_idx" ON "AuditFinding"("responseOwnerId");

-- CreateIndex
CREATE UNIQUE INDEX "AuditFinding_engagementId_code_key" ON "AuditFinding"("engagementId", "code");

-- AddForeignKey
ALTER TABLE "AuditWorkItem" ADD CONSTRAINT "AuditWorkItem_engagementId_fkey" FOREIGN KEY ("engagementId") REFERENCES "AuditEngagement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditFinding" ADD CONSTRAINT "AuditFinding_engagementId_fkey" FOREIGN KEY ("engagementId") REFERENCES "AuditEngagement"("id") ON DELETE CASCADE ON UPDATE CASCADE;
