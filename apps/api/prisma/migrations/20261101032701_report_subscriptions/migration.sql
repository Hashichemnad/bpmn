-- CreateTable
CREATE TABLE "ReportSubscription" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "report" TEXT NOT NULL,
    "filters" JSONB NOT NULL DEFAULT '{}',
    "format" TEXT NOT NULL DEFAULT 'LINK',
    "frequency" TEXT NOT NULL DEFAULT 'WEEKLY',
    "weekday" INTEGER NOT NULL DEFAULT 7,
    "monthDay" INTEGER NOT NULL DEFAULT 1,
    "time" TEXT NOT NULL DEFAULT '07:00',
    "skipHolidays" BOOLEAN NOT NULL DEFAULT true,
    "locale" TEXT,
    "audience" TEXT NOT NULL DEFAULT 'SELF',
    "roleId" UUID,
    "audienceDepartmentId" UUID,
    "ownerId" UUID NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "nextRunAt" TIMESTAMP(3),
    "lastRunAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" UUID,
    "updatedById" UUID,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "ReportSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReportDelivery" (
    "id" UUID NOT NULL,
    "subscriptionId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "status" TEXT NOT NULL,
    "error" TEXT,
    "format" TEXT NOT NULL,
    "attached" BOOLEAN NOT NULL DEFAULT false,
    "fileKey" TEXT,
    "fileName" TEXT,
    "contentType" TEXT,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReportDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReportUnsubscribe" (
    "subscriptionId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReportUnsubscribe_pkey" PRIMARY KEY ("subscriptionId","userId")
);

-- CreateIndex
CREATE INDEX "ReportSubscription_active_nextRunAt_idx" ON "ReportSubscription"("active", "nextRunAt");

-- CreateIndex
CREATE INDEX "ReportSubscription_ownerId_idx" ON "ReportSubscription"("ownerId");

-- CreateIndex
CREATE INDEX "ReportDelivery_subscriptionId_createdAt_idx" ON "ReportDelivery"("subscriptionId", "createdAt");

-- CreateIndex
CREATE INDEX "ReportDelivery_userId_createdAt_idx" ON "ReportDelivery"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "ReportDelivery" ADD CONSTRAINT "ReportDelivery_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "ReportSubscription"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportUnsubscribe" ADD CONSTRAINT "ReportUnsubscribe_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "ReportSubscription"("id") ON DELETE CASCADE ON UPDATE CASCADE;
