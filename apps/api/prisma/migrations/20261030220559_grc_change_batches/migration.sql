-- AlterTable
ALTER TABLE "GrcChange" ADD COLUMN     "batchId" UUID;

-- CreateIndex
CREATE INDEX "GrcChange_batchId_idx" ON "GrcChange"("batchId");
