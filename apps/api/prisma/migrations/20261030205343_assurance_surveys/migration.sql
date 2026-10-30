-- CreateTable
CREATE TABLE "Questionnaire" (
    "id" UUID NOT NULL,
    "titleEn" TEXT NOT NULL DEFAULT '',
    "titleAr" TEXT NOT NULL DEFAULT '',
    "descriptionEn" TEXT NOT NULL DEFAULT '',
    "descriptionAr" TEXT NOT NULL DEFAULT '',
    "purpose" TEXT NOT NULL DEFAULT 'GENERAL',
    "definition" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" UUID,
    "updatedById" UUID,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Questionnaire_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SurveyCampaign" (
    "id" UUID NOT NULL,
    "questionnaireId" UUID,
    "titleEn" TEXT NOT NULL DEFAULT '',
    "titleAr" TEXT NOT NULL DEFAULT '',
    "purpose" TEXT NOT NULL DEFAULT 'GENERAL',
    "descriptionEn" TEXT NOT NULL DEFAULT '',
    "descriptionAr" TEXT NOT NULL DEFAULT '',
    "definition" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "audience" JSONB NOT NULL DEFAULT '{}',
    "startAt" TIMESTAMP(3),
    "endAt" TIMESTAMP(3),
    "reminderDaysBefore" INTEGER NOT NULL DEFAULT 3,
    "processId" UUID,
    "departmentId" UUID,
    "launchedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" UUID,
    "updatedById" UUID,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "SurveyCampaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SurveyResponse" (
    "id" UUID NOT NULL,
    "campaignId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'SENT',
    "answers" JSONB NOT NULL DEFAULT '{}',
    "score" DOUBLE PRECISION,
    "maxScore" DOUBLE PRECISION,
    "openedAt" TIMESTAMP(3),
    "submittedAt" TIMESTAMP(3),
    "reminderSentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SurveyResponse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SurveyProposal" (
    "id" UUID NOT NULL,
    "campaignId" UUID NOT NULL,
    "responseId" UUID NOT NULL,
    "questionId" TEXT NOT NULL,
    "objectId" UUID NOT NULL,
    "field" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "decidedById" UUID,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SurveyProposal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SurveyCampaign_status_endAt_idx" ON "SurveyCampaign"("status", "endAt");

-- CreateIndex
CREATE INDEX "SurveyCampaign_processId_idx" ON "SurveyCampaign"("processId");

-- CreateIndex
CREATE INDEX "SurveyResponse_userId_status_idx" ON "SurveyResponse"("userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "SurveyResponse_campaignId_userId_key" ON "SurveyResponse"("campaignId", "userId");

-- CreateIndex
CREATE INDEX "SurveyProposal_campaignId_status_idx" ON "SurveyProposal"("campaignId", "status");

-- CreateIndex
CREATE INDEX "SurveyProposal_objectId_idx" ON "SurveyProposal"("objectId");

-- AddForeignKey
ALTER TABLE "SurveyCampaign" ADD CONSTRAINT "SurveyCampaign_questionnaireId_fkey" FOREIGN KEY ("questionnaireId") REFERENCES "Questionnaire"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SurveyResponse" ADD CONSTRAINT "SurveyResponse_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "SurveyCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SurveyProposal" ADD CONSTRAINT "SurveyProposal_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "SurveyCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;
