-- CreateTable
CREATE TABLE "AiProposal" (
    "id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "sourceType" TEXT NOT NULL,
    "sourceId" UUID NOT NULL,
    "batchId" UUID,
    "titleEn" TEXT NOT NULL DEFAULT '',
    "titleAr" TEXT NOT NULL DEFAULT '',
    "payload" JSONB,
    "error" TEXT,
    "resultType" TEXT,
    "resultId" UUID,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedById" UUID,
    "decidedAt" TIMESTAMP(3),

    CONSTRAINT "AiProposal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AiProposal_status_kind_idx" ON "AiProposal"("status", "kind");

-- CreateIndex
CREATE INDEX "AiProposal_sourceType_sourceId_idx" ON "AiProposal"("sourceType", "sourceId");

-- CreateIndex
CREATE INDEX "AiProposal_batchId_idx" ON "AiProposal"("batchId");
