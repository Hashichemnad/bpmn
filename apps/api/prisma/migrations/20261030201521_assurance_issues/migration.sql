-- AlterTable
ALTER TABLE "Department" ADD COLUMN     "managerId" UUID;

-- CreateTable
CREATE TABLE "Issue" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "titleEn" TEXT NOT NULL DEFAULT '',
    "titleAr" TEXT NOT NULL DEFAULT '',
    "descriptionEn" TEXT NOT NULL DEFAULT '',
    "descriptionAr" TEXT NOT NULL DEFAULT '',
    "sourceType" TEXT NOT NULL DEFAULT 'MANUAL',
    "sourceId" UUID,
    "severity" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "ownerId" UUID,
    "dueAt" TIMESTAMP(3),
    "processId" UUID,
    "bpmnElementId" TEXT,
    "riskId" UUID,
    "controlId" UUID,
    "requirementId" UUID,
    "departmentId" UUID,
    "acceptanceJustification" TEXT NOT NULL DEFAULT '',
    "acceptedById" UUID,
    "acceptedAt" TIMESTAMP(3),
    "verifiedById" UUID,
    "verifiedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "dueNotifiedAt" TIMESTAMP(3),
    "overdueNotifiedAt" TIMESTAMP(3),
    "escalatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" UUID,
    "updatedById" UUID,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Issue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IssueAction" (
    "id" UUID NOT NULL,
    "issueId" UUID NOT NULL,
    "titleEn" TEXT NOT NULL DEFAULT '',
    "titleAr" TEXT NOT NULL DEFAULT '',
    "note" TEXT NOT NULL DEFAULT '',
    "ownerId" UUID,
    "dueAt" TIMESTAMP(3),
    "progress" INTEGER NOT NULL DEFAULT 0,
    "completedAt" TIMESTAMP(3),
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "dueNotifiedAt" TIMESTAMP(3),
    "overdueNotifiedAt" TIMESTAMP(3),
    "escalatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" UUID,
    "updatedById" UUID,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "IssueAction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Issue_code_key" ON "Issue"("code");

-- CreateIndex
CREATE INDEX "Issue_status_idx" ON "Issue"("status");

-- CreateIndex
CREATE INDEX "Issue_ownerId_idx" ON "Issue"("ownerId");

-- CreateIndex
CREATE INDEX "Issue_sourceType_sourceId_idx" ON "Issue"("sourceType", "sourceId");

-- CreateIndex
CREATE INDEX "Issue_processId_idx" ON "Issue"("processId");

-- CreateIndex
CREATE INDEX "Issue_controlId_idx" ON "Issue"("controlId");

-- CreateIndex
CREATE INDEX "Issue_riskId_idx" ON "Issue"("riskId");

-- CreateIndex
CREATE INDEX "IssueAction_issueId_idx" ON "IssueAction"("issueId");

-- CreateIndex
CREATE INDEX "IssueAction_ownerId_idx" ON "IssueAction"("ownerId");

-- AddForeignKey
ALTER TABLE "IssueAction" ADD CONSTRAINT "IssueAction_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "Issue"("id") ON DELETE CASCADE ON UPDATE CASCADE;
