-- CreateEnum
CREATE TYPE "ApiKeyContent" AS ENUM ('PUBLISHED', 'WORKSPACE');

-- CreateTable
CREATE TABLE "ApiKey" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "prefix" TEXT NOT NULL,
    "secretHash" TEXT NOT NULL,
    "ownerId" UUID NOT NULL,
    "scopes" TEXT[],
    "content" "ApiKeyContent" NOT NULL DEFAULT 'PUBLISHED',
    "departmentIds" UUID[],
    "ipAllowList" TEXT[],
    "rateLimitPerMinute" INTEGER NOT NULL DEFAULT 120,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "revokedById" UUID,
    "rotatedAt" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),
    "lastUsedIp" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" UUID,
    "updatedById" UUID,

    CONSTRAINT "ApiKey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApiKeyUsage" (
    "id" UUID NOT NULL,
    "keyId" UUID NOT NULL,
    "method" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "status" INTEGER NOT NULL,
    "durationMs" INTEGER NOT NULL,
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApiKeyUsage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ApiKey_prefix_key" ON "ApiKey"("prefix");

-- CreateIndex
CREATE INDEX "ApiKey_ownerId_idx" ON "ApiKey"("ownerId");

-- CreateIndex
CREATE INDEX "ApiKeyUsage_keyId_createdAt_idx" ON "ApiKeyUsage"("keyId", "createdAt");

-- CreateIndex
CREATE INDEX "ApiKeyUsage_createdAt_idx" ON "ApiKeyUsage"("createdAt");

-- AddForeignKey
ALTER TABLE "ApiKeyUsage" ADD CONSTRAINT "ApiKeyUsage_keyId_fkey" FOREIGN KEY ("keyId") REFERENCES "ApiKey"("id") ON DELETE CASCADE ON UPDATE CASCADE;
