-- CreateEnum
CREATE TYPE "ImportBatchStatus" AS ENUM ('UPLOADED', 'PARSING', 'READY', 'APPLYING', 'APPLIED', 'FAILED', 'CANCELLED', 'UNDONE');

-- AlterTable
ALTER TABLE "Diagram" ADD COLUMN     "importBatchId" UUID;

-- AlterTable
ALTER TABLE "Page" ADD COLUMN     "importBatchId" UUID;

-- AlterTable
ALTER TABLE "Process" ADD COLUMN     "importBatchId" UUID;

-- AlterTable
ALTER TABLE "RepoObject" ADD COLUMN     "importBatchId" UUID;

-- CreateTable
CREATE TABLE "ImportBatch" (
    "id" UUID NOT NULL,
    "number" SERIAL NOT NULL,
    "kind" TEXT NOT NULL,
    "status" "ImportBatchStatus" NOT NULL DEFAULT 'UPLOADED',
    "note" TEXT NOT NULL DEFAULT '',
    "options" JSONB NOT NULL DEFAULT '{}',
    "preview" JSONB,
    "summary" JSONB,
    "result" JSONB,
    "progress" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "message" TEXT NOT NULL DEFAULT '',
    "jobId" UUID,
    "error" TEXT,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "parsedAt" TIMESTAMP(3),
    "appliedAt" TIMESTAMP(3),
    "appliedById" UUID,
    "undoneAt" TIMESTAMP(3),
    "undoneById" UUID,

    CONSTRAINT "ImportBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportFile" (
    "id" UUID NOT NULL,
    "batchId" UUID NOT NULL,
    "fileName" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImportFile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportItem" (
    "id" UUID NOT NULL,
    "batchId" UUID NOT NULL,
    "ref" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" UUID,
    "outcome" TEXT NOT NULL,
    "externalKey" TEXT NOT NULL DEFAULT '',
    "key" TEXT NOT NULL DEFAULT '',
    "nameEn" TEXT NOT NULL DEFAULT '',
    "nameAr" TEXT NOT NULL DEFAULT '',
    "source" TEXT NOT NULL DEFAULT '',
    "error" TEXT,
    "before" JSONB,
    "after" JSONB,
    "seq" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImportItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ImportBatch_number_key" ON "ImportBatch"("number");

-- CreateIndex
CREATE INDEX "ImportBatch_kind_createdAt_idx" ON "ImportBatch"("kind", "createdAt");

-- CreateIndex
CREATE INDEX "ImportBatch_status_idx" ON "ImportBatch"("status");

-- CreateIndex
CREATE UNIQUE INDEX "ImportFile_storageKey_key" ON "ImportFile"("storageKey");

-- CreateIndex
CREATE INDEX "ImportFile_batchId_idx" ON "ImportFile"("batchId");

-- CreateIndex
CREATE INDEX "ImportItem_batchId_seq_idx" ON "ImportItem"("batchId", "seq");

-- CreateIndex
CREATE INDEX "ImportItem_entityType_entityId_idx" ON "ImportItem"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "ImportItem_entityType_externalKey_idx" ON "ImportItem"("entityType", "externalKey");

-- CreateIndex
CREATE INDEX "Diagram_importBatchId_idx" ON "Diagram"("importBatchId");

-- CreateIndex
CREATE INDEX "Page_importBatchId_idx" ON "Page"("importBatchId");

-- CreateIndex
CREATE INDEX "Process_importBatchId_idx" ON "Process"("importBatchId");

-- CreateIndex
CREATE INDEX "RepoObject_importBatchId_idx" ON "RepoObject"("importBatchId");

-- AddForeignKey
ALTER TABLE "ImportFile" ADD CONSTRAINT "ImportFile_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "ImportBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportItem" ADD CONSTRAINT "ImportItem_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "ImportBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;
