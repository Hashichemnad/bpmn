-- Phase 3: governance workflow (M8) and Knowledge Portal (M9).
-- CreateEnum
CREATE TYPE "ContentType" AS ENUM ('PROCESS', 'PAGE');

-- CreateEnum
CREATE TYPE "ReviewStatus" AS ENUM ('IN_PROGRESS', 'APPROVED', 'CHANGES_REQUESTED', 'REJECTED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "ReviewTaskStatus" AS ENUM ('PENDING', 'APPROVED', 'CHANGES_REQUESTED', 'REJECTED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "FeedbackKind" AS ENUM ('IMPROVEMENT', 'OUTDATED');

-- CreateEnum
CREATE TYPE "FeedbackStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'DONE');

-- CreateEnum
CREATE TYPE "EmailStatus" AS ENUM ('PENDING', 'SENT', 'FAILED', 'SKIPPED');

-- AlterTable
ALTER TABLE "Page" ADD COLUMN     "nextReviewAt" TIMESTAMP(3),
ADD COLUMN     "ownerId" UUID,
ADD COLUMN     "status" "ProcessStatus" NOT NULL DEFAULT 'DRAFT',
ADD COLUMN     "workflowId" UUID;

-- AlterTable
ALTER TABLE "Process" ADD COLUMN     "nextReviewAt" TIMESTAMP(3),
ADD COLUMN     "workflowId" UUID;

-- AlterTable
ALTER TABLE "Space" ADD COLUMN     "workflowId" UUID;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "notificationPrefs" JSONB NOT NULL DEFAULT '{}';

-- CreateTable
CREATE TABLE "Workflow" (
    "id" UUID NOT NULL,
    "nameEn" TEXT NOT NULL DEFAULT '',
    "nameAr" TEXT NOT NULL DEFAULT '',
    "descriptionEn" TEXT NOT NULL DEFAULT '',
    "descriptionAr" TEXT NOT NULL DEFAULT '',
    "steps" JSONB NOT NULL,
    "autoPublish" BOOLEAN NOT NULL DEFAULT false,
    "isTemplate" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" UUID,
    "updatedById" UUID,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Workflow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Review" (
    "id" UUID NOT NULL,
    "entityType" "ContentType" NOT NULL,
    "entityId" UUID NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "status" "ReviewStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "workflowId" UUID,
    "workflowNameEn" TEXT NOT NULL DEFAULT '',
    "workflowNameAr" TEXT NOT NULL DEFAULT '',
    "steps" JSONB NOT NULL,
    "autoPublish" BOOLEAN NOT NULL DEFAULT false,
    "currentStep" INTEGER NOT NULL DEFAULT 0,
    "note" TEXT NOT NULL DEFAULT '',
    "submittedById" UUID,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dueAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "overdueNotifiedAt" TIMESTAMP(3),

    CONSTRAINT "Review_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReviewTask" (
    "id" UUID NOT NULL,
    "reviewId" UUID NOT NULL,
    "stepIndex" INTEGER NOT NULL,
    "assigneeId" UUID NOT NULL,
    "status" "ReviewTaskStatus" NOT NULL DEFAULT 'PENDING',
    "comment" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReviewTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Publication" (
    "id" UUID NOT NULL,
    "entityType" "ContentType" NOT NULL,
    "entityId" UUID NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "versionLabel" TEXT,
    "code" TEXT,
    "titleEn" TEXT NOT NULL DEFAULT '',
    "titleAr" TEXT NOT NULL DEFAULT '',
    "descriptionEn" TEXT NOT NULL DEFAULT '',
    "descriptionAr" TEXT NOT NULL DEFAULT '',
    "textEn" TEXT NOT NULL DEFAULT '',
    "textAr" TEXT NOT NULL DEFAULT '',
    "searchVector" tsvector GENERATED ALWAYS AS (
        setweight(to_tsvector('english'::regconfig, coalesce("code", '') || ' ' || "titleEn"), 'A') ||
        setweight(to_tsvector('arabic'::regconfig, "titleAr"), 'A') ||
        setweight(to_tsvector('english'::regconfig, "descriptionEn"), 'B') ||
        setweight(to_tsvector('arabic'::regconfig, "descriptionAr"), 'B') ||
        setweight(to_tsvector('english'::regconfig, "textEn"), 'C') ||
        setweight(to_tsvector('arabic'::regconfig, "textAr"), 'C')
    ) STORED,
    "reviewId" UUID,
    "approvedAt" TIMESTAMP(3),
    "approverIds" UUID[],
    "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedById" UUID,
    "current" BOOLEAN NOT NULL DEFAULT true,
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "Publication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PublishedLink" (
    "id" UUID NOT NULL,
    "publicationId" UUID NOT NULL,
    "bpmnElementId" TEXT NOT NULL,
    "repoObjectId" UUID NOT NULL,
    "relation" "LinkRelation" NOT NULL,

    CONSTRAINT "PublishedLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Comment" (
    "id" UUID NOT NULL,
    "entityType" "ContentType" NOT NULL,
    "entityId" UUID NOT NULL,
    "parentId" UUID,
    "bpmnElementId" TEXT,
    "body" TEXT NOT NULL,
    "mentionIds" UUID[],
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "editedAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "resolvedById" UUID,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Comment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "entityType" "ContentType",
    "entityId" UUID,
    "params" JSONB NOT NULL DEFAULT '{}',
    "link" TEXT,
    "actorId" UUID,
    "inApp" BOOLEAN NOT NULL DEFAULT true,
    "readAt" TIMESTAMP(3),
    "emailStatus" "EmailStatus",
    "emailError" TEXT,
    "dedupeKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Feedback" (
    "id" UUID NOT NULL,
    "entityType" "ContentType" NOT NULL,
    "entityId" UUID NOT NULL,
    "kind" "FeedbackKind" NOT NULL,
    "message" TEXT NOT NULL,
    "status" "FeedbackStatus" NOT NULL DEFAULT 'OPEN',
    "reply" TEXT,
    "repliedAt" TIMESTAMP(3),
    "repliedById" UUID,
    "assigneeId" UUID,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Feedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserJobRole" (
    "userId" UUID NOT NULL,
    "repoObjectId" UUID NOT NULL,

    CONSTRAINT "UserJobRole_pkey" PRIMARY KEY ("userId","repoObjectId")
);

-- CreateIndex
CREATE INDEX "Review_entityType_entityId_idx" ON "Review"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "Review_status_idx" ON "Review"("status");

-- CreateIndex
CREATE INDEX "ReviewTask_assigneeId_status_idx" ON "ReviewTask"("assigneeId", "status");

-- CreateIndex
CREATE INDEX "ReviewTask_reviewId_idx" ON "ReviewTask"("reviewId");

-- CreateIndex
CREATE INDEX "Publication_entityType_entityId_idx" ON "Publication"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "Publication_current_publishedAt_idx" ON "Publication"("current", "publishedAt");

-- CreateIndex
-- At most one current publication per item.
CREATE UNIQUE INDEX "Publication_one_current_idx" ON "Publication"("entityType", "entityId") WHERE "current";

-- CreateIndex
CREATE INDEX "Publication_searchVector_idx" ON "Publication" USING GIN ("searchVector");

-- CreateIndex
CREATE INDEX "PublishedLink_publicationId_idx" ON "PublishedLink"("publicationId");

-- CreateIndex
CREATE INDEX "PublishedLink_repoObjectId_idx" ON "PublishedLink"("repoObjectId");

-- CreateIndex
CREATE INDEX "Comment_entityType_entityId_idx" ON "Comment"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "Comment_parentId_idx" ON "Comment"("parentId");

-- CreateIndex
CREATE INDEX "Notification_userId_readAt_idx" ON "Notification"("userId", "readAt");

-- CreateIndex
CREATE INDEX "Notification_createdAt_idx" ON "Notification"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Notification_userId_dedupeKey_key" ON "Notification"("userId", "dedupeKey");

-- CreateIndex
CREATE INDEX "Feedback_assigneeId_status_idx" ON "Feedback"("assigneeId", "status");

-- CreateIndex
CREATE INDEX "Feedback_createdById_idx" ON "Feedback"("createdById");

-- CreateIndex
CREATE INDEX "Feedback_entityType_entityId_idx" ON "Feedback"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "UserJobRole_repoObjectId_idx" ON "UserJobRole"("repoObjectId");

-- AddForeignKey
ALTER TABLE "Process" ADD CONSTRAINT "Process_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "Workflow"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Space" ADD CONSTRAINT "Space_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "Workflow"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Page" ADD CONSTRAINT "Page_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Page" ADD CONSTRAINT "Page_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "Workflow"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewTask" ADD CONSTRAINT "ReviewTask_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "Review"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Publication" ADD CONSTRAINT "Publication_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "Review"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PublishedLink" ADD CONSTRAINT "PublishedLink_publicationId_fkey" FOREIGN KEY ("publicationId") REFERENCES "Publication"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Comment" ADD CONSTRAINT "Comment_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Comment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserJobRole" ADD CONSTRAINT "UserJobRole_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserJobRole" ADD CONSTRAINT "UserJobRole_repoObjectId_fkey" FOREIGN KEY ("repoObjectId") REFERENCES "RepoObject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

