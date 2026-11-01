-- Final session part B (SEC-37, SEC-38): "sign out everywhere" and admin session revocation end
-- access tokens issued before this time as well (refresh tokens are revoked at the same moment).
ALTER TABLE "User" ADD COLUMN "sessionsRevokedAt" TIMESTAMP(3);
