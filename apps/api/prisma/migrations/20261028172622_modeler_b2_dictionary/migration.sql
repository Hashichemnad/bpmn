-- Modeler design B2, Part 1: dictionary terms (D-083).
-- CreateEnum
CREATE TYPE "ObjectStatus" AS ENUM ('DRAFT', 'APPROVED');

-- AlterEnum
ALTER TYPE "LinkRelation" ADD VALUE 'NAMED';

-- AlterEnum
ALTER TYPE "ObjectType" ADD VALUE 'TERM';

-- DropIndex
DROP INDEX "RepoObject_type_idx";

-- AlterTable
ALTER TABLE "RepoObject" ADD COLUMN     "approvedAt" TIMESTAMP(3),
ADD COLUMN     "approvedById" UUID,
ADD COLUMN     "category" TEXT,
ADD COLUMN     "ownerId" UUID,
ADD COLUMN     "status" "ObjectStatus" NOT NULL DEFAULT 'APPROVED',
ADD COLUMN     "synonymsAr" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "synonymsEn" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateIndex
CREATE INDEX "RepoObject_type_status_idx" ON "RepoObject"("type", "status");

-- AddForeignKey
ALTER TABLE "RepoObject" ADD CONSTRAINT "RepoObject_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
