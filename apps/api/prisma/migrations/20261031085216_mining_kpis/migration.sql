-- AlterEnum
ALTER TYPE "KpiDataSource" ADD VALUE 'EVENT_LOG';

-- AlterTable
ALTER TABLE "Kpi" ADD COLUMN     "miningLogId" UUID;


-- AddForeignKey
ALTER TABLE "Kpi" ADD CONSTRAINT "Kpi_miningLogId_fkey" FOREIGN KEY ("miningLogId") REFERENCES "EventLog"("id") ON DELETE SET NULL ON UPDATE CASCADE;
