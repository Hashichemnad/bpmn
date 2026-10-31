-- CreateEnum
CREATE TYPE "DiagramType" AS ENUM ('VALUE_CHAIN', 'ORG_CHART', 'DMN', 'EPC', 'SIPOC');

-- AlterEnum
ALTER TYPE "ContentType" ADD VALUE 'DIAGRAM';

-- CreateTable
CREATE TABLE "Diagram" (
    "id" UUID NOT NULL,
    "type" "DiagramType" NOT NULL,
    "code" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL DEFAULT '',
    "nameAr" TEXT NOT NULL DEFAULT '',
    "descriptionEn" TEXT NOT NULL DEFAULT '',
    "descriptionAr" TEXT NOT NULL DEFAULT '',
    "status" "ProcessStatus" NOT NULL DEFAULT 'DRAFT',
    "processId" UUID,
    "ownerId" UUID,
    "departmentId" UUID,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "workflowId" UUID,
    "nextReviewAt" TIMESTAMP(3),
    "aiGenerated" BOOLEAN NOT NULL DEFAULT false,
    "content" TEXT NOT NULL,
    "contentUpdatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "contentUpdatedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" UUID,
    "updatedById" UUID,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Diagram_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DiagramVersion" (
    "id" UUID NOT NULL,
    "diagramId" UUID NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "changeNote" TEXT NOT NULL,
    "label" TEXT,
    "restoredFrom" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" UUID,

    CONSTRAINT "DiagramVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DiagramLink" (
    "id" UUID NOT NULL,
    "diagramId" UUID NOT NULL,
    "elementId" TEXT NOT NULL,
    "repoObjectId" UUID NOT NULL,
    "relation" "LinkRelation" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" UUID,

    CONSTRAINT "DiagramLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Diagram_type_idx" ON "Diagram"("type");

-- CreateIndex
CREATE INDEX "Diagram_processId_idx" ON "Diagram"("processId");

-- CreateIndex
CREATE INDEX "Diagram_code_idx" ON "Diagram"("code");

-- CreateIndex
CREATE UNIQUE INDEX "DiagramVersion_diagramId_versionNumber_key" ON "DiagramVersion"("diagramId", "versionNumber");

-- CreateIndex
CREATE INDEX "DiagramLink_repoObjectId_idx" ON "DiagramLink"("repoObjectId");

-- CreateIndex
CREATE UNIQUE INDEX "DiagramLink_diagramId_elementId_repoObjectId_relation_key" ON "DiagramLink"("diagramId", "elementId", "repoObjectId", "relation");

-- AddForeignKey
ALTER TABLE "Diagram" ADD CONSTRAINT "Diagram_processId_fkey" FOREIGN KEY ("processId") REFERENCES "Process"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Diagram" ADD CONSTRAINT "Diagram_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Diagram" ADD CONSTRAINT "Diagram_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Diagram" ADD CONSTRAINT "Diagram_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "Workflow"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiagramVersion" ADD CONSTRAINT "DiagramVersion_diagramId_fkey" FOREIGN KEY ("diagramId") REFERENCES "Diagram"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiagramLink" ADD CONSTRAINT "DiagramLink_diagramId_fkey" FOREIGN KEY ("diagramId") REFERENCES "Diagram"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiagramLink" ADD CONSTRAINT "DiagramLink_repoObjectId_fkey" FOREIGN KEY ("repoObjectId") REFERENCES "RepoObject"("id") ON DELETE CASCADE ON UPDATE CASCADE;
