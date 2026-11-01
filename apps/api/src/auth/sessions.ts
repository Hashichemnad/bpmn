import type { Prisma } from '@prisma/client';

/**
 * Ends every session of a user at once (final session part B, SEC-38): all refresh tokens are
 * revoked and access tokens issued until now stop working (User.sessionsRevokedAt is checked by
 * the user loader on every request).
 */
export async function revokeUserSessions(tx: Prisma.TransactionClient, userId: string) {
  // Whole seconds, like passwordChangedAt: JWT `iat` has second precision; a sign-in right after
  // the revocation (a later second) works.
  const now = new Date(Math.floor(Date.now() / 1000) * 1000);
  await tx.refreshToken.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: now },
  });
  await tx.user.update({ where: { id: userId }, data: { sessionsRevokedAt: now } });
}
