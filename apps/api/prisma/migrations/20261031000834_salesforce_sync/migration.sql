-- AlterTable

-- CreateTable
CREATE TABLE "SalesforceSyncRun" (
    "id" UUID NOT NULL,
    "trigger" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "counts" JSONB NOT NULL DEFAULT '{}',
    "warnings" JSONB NOT NULL DEFAULT '[]',
    "error" TEXT,
    "userId" UUID,

    CONSTRAINT "SalesforceSyncRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SalesforceSyncRun_startedAt_idx" ON "SalesforceSyncRun"("startedAt");
