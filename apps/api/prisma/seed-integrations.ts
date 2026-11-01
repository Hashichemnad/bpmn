import type { PrismaClient } from '@prisma/client';
import { createHash } from 'node:crypto';
import { nextReportRun } from '@processhub/shared';
import { SecretBox } from '../src/integrations/secret-box';

/**
 * Phase 4.4 demo data (demo installations only, once): a read-only API key for published content
 * (the key is printed in README "Demo integrations" — demo installations only, never production),
 * a webhook to the local test receiver of docker-compose.yml, a switched-off Teams channel and a
 * weekly KPI report e-mail for the performance officer.
 */
export const DEMO_API_KEY = 'phk_DemoKey00001_ProcessHubDemoKeyForPublishedContentOnly000';

export async function seedIntegrationsDemo(prisma: PrismaClient, adminId: string | null) {
  if (await prisma.apiKey.count()) return;
  const owner =
    (await prisma.user.findUnique({ where: { email: 'owner@processhub.local' } }))?.id ?? adminId;
  if (!owner) return;
  await prisma.apiKey.create({
    data: {
      name: 'Demo – intranet (published content)',
      description: 'Demo installations only. Revoke it before go-live.',
      prefix: DEMO_API_KEY.split('_')[1],
      secretHash: createHash('sha256').update(DEMO_API_KEY).digest('hex'),
      ownerId: owner,
      scopes: ['processes:read', 'pages:read', 'diagrams:read', 'objects:read', 'kpis:read'],
      content: 'PUBLISHED',
      rateLimitPerMinute: 120,
      expiresAt: new Date(Date.now() + 365 * 86_400_000),
      createdById: adminId,
    },
  });

  const key = process.env.INTEGRATIONS_ENCRYPTION_KEY;
  if (key && Buffer.from(key, 'base64').length === 32) {
    const box = new SecretBox(key);
    await prisma.webhook.create({
      data: {
        kind: 'WEBHOOK',
        name: 'Demo – local test receiver',
        urlSealed: box.encrypt('http://webhook-receiver:8090/demo'),
        urlDisplay: 'http://webhook-receiver:8090/demo',
        secretSealed: box.encrypt('whsec_DemoSecretForTheLocalTestReceiverOnly0000000'),
        events: ['process.published', 'review.approved', 'workflow.case.completed', 'kpi.red'],
        createdById: adminId,
      },
    });
    await prisma.webhook.create({
      data: {
        kind: 'TEAMS',
        name: 'Demo – Process office channel (switched off)',
        urlSealed: box.encrypt(
          'https://prod-00.westeurope.logic.azure.com/workflows/demo/triggers/manual/paths/invoke?sig=demo',
        ),
        urlDisplay:
          'https://prod-00.westeurope.logic.azure.com/workflows/demo/triggers/manual/paths/invoke?…',
        events: ['process.published', 'review.submitted'],
        language: 'BOTH',
        active: false,
        createdById: adminId,
      },
    });
  } else {
    console.warn('INTEGRATIONS_ENCRYPTION_KEY not set — demo webhook and Teams channel skipped.');
  }

  const perf = await prisma.user.findUnique({ where: { email: 'performance@processhub.local' } });
  if (perf) {
    const schedule = {
      frequency: 'WEEKLY' as const,
      weekday: 7,
      monthDay: 1,
      time: '07:00',
      skipHolidays: true,
    };
    await prisma.reportSubscription.create({
      data: {
        name: 'Weekly KPI dashboard',
        report: 'KPI_DASHBOARD',
        format: 'LINK',
        ...schedule,
        ownerId: perf.id,
        createdById: perf.id,
        nextRunAt: nextReportRun(schedule, new Date()),
      },
    });
  }
  console.log(
    'Seeded Phase 4.4 demo integrations: API key, webhook, Teams channel (off), KPI report e-mail.',
  );
}
