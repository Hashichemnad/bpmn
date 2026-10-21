-- CreateEnum
CREATE TYPE "SpaceAccessLevel" AS ENUM ('VIEW', 'EDIT');

-- CreateEnum
CREATE TYPE "SpacePrincipalType" AS ENUM ('USER', 'ROLE', 'DEPARTMENT');

-- CreateEnum
CREATE TYPE "PageLinkTarget" AS ENUM ('PROCESS', 'OBJECT');

-- CreateEnum
CREATE TYPE "GitEntityType" AS ENUM ('PROCESS', 'PAGE');

-- CreateEnum
CREATE TYPE "GitSyncStatus" AS ENUM ('PENDING', 'SUCCESS', 'FAILED');

-- AlterTable
ALTER TABLE "ProcessVersion" ADD COLUMN     "label" TEXT,
ADD COLUMN     "restoredFrom" INTEGER;

-- CreateTable
CREATE TABLE "Space" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL DEFAULT '',
    "nameAr" TEXT NOT NULL DEFAULT '',
    "descriptionEn" TEXT NOT NULL DEFAULT '',
    "descriptionAr" TEXT NOT NULL DEFAULT '',
    "icon" TEXT NOT NULL DEFAULT 'book',
    "ownerId" UUID,
    "departmentId" UUID,
    "viewRestricted" BOOLEAN NOT NULL DEFAULT false,
    "editRestricted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" UUID,
    "updatedById" UUID,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Space_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SpaceGrant" (
    "id" UUID NOT NULL,
    "spaceId" UUID NOT NULL,
    "principalType" "SpacePrincipalType" NOT NULL,
    "principalId" TEXT NOT NULL,
    "access" "SpaceAccessLevel" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SpaceGrant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Page" (
    "id" UUID NOT NULL,
    "spaceId" UUID NOT NULL,
    "parentId" UUID,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "titleEn" TEXT NOT NULL DEFAULT '',
    "titleAr" TEXT NOT NULL DEFAULT '',
    "contentEn" TEXT NOT NULL DEFAULT '',
    "contentAr" TEXT NOT NULL DEFAULT '',
    "dirEn" TEXT NOT NULL DEFAULT 'ltr',
    "dirAr" TEXT NOT NULL DEFAULT 'rtl',
    "textEn" TEXT NOT NULL DEFAULT '',
    "textAr" TEXT NOT NULL DEFAULT '',
    "version" INTEGER NOT NULL DEFAULT 0,
    "searchVector" tsvector,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" UUID,
    "updatedById" UUID,
    "deletedAt" TIMESTAMP(3),
    "deletedById" UUID,
    "deleteBatchId" UUID,

    CONSTRAINT "Page_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PageVersion" (
    "id" UUID NOT NULL,
    "pageId" UUID NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "titleEn" TEXT NOT NULL,
    "titleAr" TEXT NOT NULL,
    "contentEn" TEXT NOT NULL,
    "contentAr" TEXT NOT NULL,
    "dirEn" TEXT NOT NULL,
    "dirAr" TEXT NOT NULL,
    "changeNote" TEXT NOT NULL,
    "label" TEXT,
    "restoredFrom" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" UUID,

    CONSTRAINT "PageVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PageDraft" (
    "pageId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "titleEn" TEXT NOT NULL,
    "titleAr" TEXT NOT NULL,
    "contentEn" TEXT NOT NULL,
    "contentAr" TEXT NOT NULL,
    "dirEn" TEXT NOT NULL,
    "dirAr" TEXT NOT NULL,
    "baseVersion" INTEGER,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PageDraft_pkey" PRIMARY KEY ("pageId","userId")
);

-- CreateTable
CREATE TABLE "PageTemplate" (
    "id" UUID NOT NULL,
    "key" TEXT,
    "nameEn" TEXT NOT NULL DEFAULT '',
    "nameAr" TEXT NOT NULL DEFAULT '',
    "descriptionEn" TEXT NOT NULL DEFAULT '',
    "descriptionAr" TEXT NOT NULL DEFAULT '',
    "contentEn" TEXT NOT NULL DEFAULT '',
    "contentAr" TEXT NOT NULL DEFAULT '',
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" UUID,
    "updatedById" UUID,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "PageTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PageLink" (
    "id" UUID NOT NULL,
    "pageId" UUID NOT NULL,
    "targetType" "PageLinkTarget" NOT NULL,
    "processId" UUID,
    "repoObjectId" UUID,
    "embedded" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" UUID,

    CONSTRAINT "PageLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Attachment" (
    "id" UUID NOT NULL,
    "pageId" UUID NOT NULL,
    "fileName" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "storageKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" UUID,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Attachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GitSyncItem" (
    "id" UUID NOT NULL,
    "entityType" "GitEntityType" NOT NULL,
    "entityId" UUID NOT NULL,
    "status" "GitSyncStatus" NOT NULL DEFAULT 'PENDING',
    "version" INTEGER,
    "paths" TEXT[],
    "removed" BOOLEAN NOT NULL DEFAULT false,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "commitSha" TEXT,
    "commitUrl" TEXT,
    "lastAttemptAt" TIMESTAMP(3),
    "lastSuccessAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GitSyncItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Space_key_key" ON "Space"("key");

-- CreateIndex
CREATE UNIQUE INDEX "SpaceGrant_spaceId_principalType_principalId_key" ON "SpaceGrant"("spaceId", "principalType", "principalId");

-- CreateIndex
CREATE INDEX "Page_spaceId_parentId_sortOrder_idx" ON "Page"("spaceId", "parentId", "sortOrder");

-- CreateIndex
CREATE INDEX "Page_deleteBatchId_idx" ON "Page"("deleteBatchId");

-- CreateIndex
CREATE INDEX "Page_searchVector_idx" ON "Page" USING GIN ("searchVector");

-- CreateIndex
CREATE UNIQUE INDEX "PageVersion_pageId_versionNumber_key" ON "PageVersion"("pageId", "versionNumber");

-- CreateIndex
CREATE UNIQUE INDEX "PageTemplate_key_key" ON "PageTemplate"("key");

-- CreateIndex
CREATE INDEX "PageLink_processId_idx" ON "PageLink"("processId");

-- CreateIndex
CREATE INDEX "PageLink_repoObjectId_idx" ON "PageLink"("repoObjectId");

-- CreateIndex
CREATE UNIQUE INDEX "PageLink_pageId_processId_key" ON "PageLink"("pageId", "processId");

-- CreateIndex
CREATE UNIQUE INDEX "PageLink_pageId_repoObjectId_key" ON "PageLink"("pageId", "repoObjectId");

-- CreateIndex
CREATE UNIQUE INDEX "Attachment_storageKey_key" ON "Attachment"("storageKey");

-- CreateIndex
CREATE INDEX "Attachment_pageId_idx" ON "Attachment"("pageId");

-- CreateIndex
CREATE INDEX "GitSyncItem_status_idx" ON "GitSyncItem"("status");

-- CreateIndex
CREATE UNIQUE INDEX "GitSyncItem_entityType_entityId_key" ON "GitSyncItem"("entityType", "entityId");

-- AddForeignKey
ALTER TABLE "Space" ADD CONSTRAINT "Space_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Space" ADD CONSTRAINT "Space_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpaceGrant" ADD CONSTRAINT "SpaceGrant_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Page" ADD CONSTRAINT "Page_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Page" ADD CONSTRAINT "Page_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Page"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PageVersion" ADD CONSTRAINT "PageVersion_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "Page"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PageDraft" ADD CONSTRAINT "PageDraft_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "Page"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PageDraft" ADD CONSTRAINT "PageDraft_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PageLink" ADD CONSTRAINT "PageLink_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "Page"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PageLink" ADD CONSTRAINT "PageLink_processId_fkey" FOREIGN KEY ("processId") REFERENCES "Process"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PageLink" ADD CONSTRAINT "PageLink_repoObjectId_fkey" FOREIGN KEY ("repoObjectId") REFERENCES "RepoObject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "Page"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Full-text search vector for wiki pages (English and Arabic stemming; titles weigh more than content).
-- Kept as a trigger (not a generated column) so the Prisma schema stays drift-free.
CREATE FUNCTION page_search_vector_update() RETURNS trigger AS $$
BEGIN
  NEW."searchVector" :=
    setweight(to_tsvector('english', coalesce(NEW."titleEn", '')), 'A') ||
    setweight(to_tsvector('arabic', coalesce(NEW."titleAr", '')), 'A') ||
    setweight(to_tsvector('english', coalesce(NEW."textEn", '')), 'B') ||
    setweight(to_tsvector('arabic', coalesce(NEW."textAr", '')), 'B');
  RETURN NEW;
END
$$ LANGUAGE plpgsql;

CREATE TRIGGER page_search_vector
  BEFORE INSERT OR UPDATE OF "titleEn", "titleAr", "textEn", "textAr" ON "Page"
  FOR EACH ROW EXECUTE FUNCTION page_search_vector_update();
