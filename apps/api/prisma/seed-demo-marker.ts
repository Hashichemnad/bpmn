import type { Prisma, PrismaClient } from '@prisma/client';
import { SETTING_KEYS, demoInstallationSchema, type DemoInstallation } from '@processhub/shared';
import { DEMO_USERS } from './seed-governance';

/**
 * Records what the demo seed created (D-180) in Setting `system.demo`: the demo users and demo API
 * keys. Administrators see a warning banner while demo data, a demo user or a demo key remains; a
 * Super Admin confirms the removal on the go-live checklist. Re-running the seed keeps the record;
 * anything new it creates puts the warning back.
 */
export async function recordDemoInstallation(
  prisma: PrismaClient,
  created: { apiKeyIds: string[] },
): Promise<DemoInstallation> {
  const domain = process.env.SEED_DEMO_EMAIL_DOMAIN || 'processhub.local';
  const users = await prisma.user.findMany({
    where: { email: { in: DEMO_USERS.map((u) => `${u.key}@${domain}`) } },
    select: { id: true },
  });
  const row = await prisma.setting.findUnique({ where: { key: SETTING_KEYS.DEMO_INSTALLATION } });
  const parsed = row ? demoInstallationSchema.safeParse(row.value) : null;
  const previous = parsed?.success ? parsed.data : null;
  const userIds = [...new Set([...(previous?.userIds ?? []), ...users.map((u) => u.id)])];
  const apiKeyIds = [...new Set([...(previous?.apiKeyIds ?? []), ...created.apiKeyIds])];
  const added =
    !previous ||
    userIds.length > previous.userIds.length ||
    apiKeyIds.length > previous.apiKeyIds.length;
  const value: DemoInstallation = {
    seededAt: previous?.seededAt ?? new Date().toISOString(),
    userIds,
    apiKeyIds,
    clearedAt: added ? null : (previous?.clearedAt ?? null),
    clearedById: added ? null : (previous?.clearedById ?? null),
  };
  const json = value as unknown as Prisma.InputJsonValue;
  await prisma.setting.upsert({
    where: { key: SETTING_KEYS.DEMO_INSTALLATION },
    create: { key: SETTING_KEYS.DEMO_INSTALLATION, value: json },
    update: { value: json },
  });
  return value;
}
