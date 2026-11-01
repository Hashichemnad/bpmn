import type { PrismaClient } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { nextReportRun } from '@processhub/shared';
import { SecretBox } from '../src/integrations/secret-box';
import { generateApiKey } from '../src/public-api/api-keys.service';

/**
 * Phase 4.4 demo data (demo installations only, once): a read-only API key for published content,
 * a webhook to the local test receiver of docker-compose.yml, a switched-off Teams channel and a
 * weekly KPI report e-mail for the performance officer.
 *
 * The demo API key is random (D-180): generated here, shown once in the seed output (`docker
 * compose logs migrate`) and never written anywhere else. Nothing is created unless
 * SEED_DEMO_DATA=true — in production without it, there is never a demo key.
 */
export function demoSeedAllowed(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.SEED_DEMO_DATA === 'true';
}

export interface IntegrationsDemoResult {
  apiKeyIds: string[];
  /** The demo key, only for the caller to print once (tests read it; never stored in clear). */
  apiKey: string | null;
}

export async function seedIntegrationsDemo(
  prisma: PrismaClient,
  adminId: string | null,
  log: (line: string) => void = console.log,
): Promise<IntegrationsDemoResult> {
  const none: IntegrationsDemoResult = { apiKeyIds: [], apiKey: null };
  if (!demoSeedAllowed()) return none;
  if (await prisma.apiKey.count()) return none;
  const domain = process.env.SEED_DEMO_EMAIL_DOMAIN || 'processhub.local';
  const owner =
    (await prisma.user.findUnique({ where: { email: `owner@${domain}` } }))?.id ?? adminId;
  if (!owner) return none;
  const gen = generateApiKey();
  const apiKey = await prisma.apiKey.create({
    data: {
      name: 'Demo – intranet (published content)',
      description: 'Demo installations only. Revoke it before go-live.',
      prefix: gen.prefix,
      secretHash: gen.hash,
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
        secretSealed: box.encrypt(`whsec_${randomBytes(32).toString('base64url')}`),
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

  const perf = await prisma.user.findUnique({ where: { email: `performance@${domain}` } });
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
  log(
    'Seeded Phase 4.4 demo integrations: API key, webhook, Teams channel (off), KPI report e-mail.',
  );
  log(
    [
      '',
      '==================== Demo API key (shown only once) ====================',
      `  ${gen.secret}`,
      '  Read-only, published content. Demo installations only: revoke it in',
      '  Settings → Integrations → API keys before go-live (docs/DEPLOYMENT.md).',
      '========================================================================',
      '',
    ].join('\n'),
  );
  return { apiKeyIds: [apiKey.id], apiKey: gen.secret };
}
