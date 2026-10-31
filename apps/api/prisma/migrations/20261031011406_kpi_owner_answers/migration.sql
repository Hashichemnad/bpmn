-- AlterEnum
ALTER TYPE "KpiFrequency" ADD VALUE 'SEMI_ANNUAL';

-- AlterTable

-- AlterTable
ALTER TABLE "SalesforceSyncRun" ADD COLUMN     "configuredById" UUID;
