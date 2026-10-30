-- CreateTable
CREATE TABLE "GrcChange" (
    "id" UUID NOT NULL,
    "objectId" UUID NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "proposed" JSONB NOT NULL,
    "fields" JSONB NOT NULL,
    "comment" TEXT NOT NULL DEFAULT '',
    "workflowId" UUID,
    "workflowNameEn" TEXT NOT NULL DEFAULT '',
    "workflowNameAr" TEXT NOT NULL DEFAULT '',
    "steps" JSONB NOT NULL,
    "currentStep" INTEGER NOT NULL DEFAULT 0,
    "submittedById" UUID,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "GrcChange_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GrcChangeTask" (
    "id" UUID NOT NULL,
    "changeId" UUID NOT NULL,
    "stepIndex" INTEGER NOT NULL,
    "assigneeId" UUID NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "comment" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GrcChangeTask_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GrcChange_objectId_status_idx" ON "GrcChange"("objectId", "status");

-- CreateIndex
CREATE INDEX "GrcChange_status_idx" ON "GrcChange"("status");

-- CreateIndex
CREATE INDEX "GrcChangeTask_assigneeId_status_idx" ON "GrcChangeTask"("assigneeId", "status");

-- CreateIndex
CREATE INDEX "GrcChangeTask_changeId_idx" ON "GrcChangeTask"("changeId");

-- AddForeignKey
ALTER TABLE "GrcChange" ADD CONSTRAINT "GrcChange_objectId_fkey" FOREIGN KEY ("objectId") REFERENCES "RepoObject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GrcChangeTask" ADD CONSTRAINT "GrcChangeTask_changeId_fkey" FOREIGN KEY ("changeId") REFERENCES "GrcChange"("id") ON DELETE CASCADE ON UPDATE CASCADE;
