-- Absolute session limit (D-165): sign-in time of each refresh-token family.
ALTER TABLE "RefreshToken" ADD COLUMN "sessionStartedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Existing sessions: the oldest token of the family approximates the sign-in time.
UPDATE "RefreshToken" r
SET "sessionStartedAt" = f.started
FROM (SELECT "familyId", MIN("createdAt") AS started FROM "RefreshToken" GROUP BY "familyId") f
WHERE r."familyId" = f."familyId";
