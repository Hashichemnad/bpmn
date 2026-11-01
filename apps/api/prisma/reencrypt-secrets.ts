/**
 * Re-encrypts every stored secret with the current INTEGRATIONS_ENCRYPTION_KEY (key rotation, final
 * session part B, SEC-40; procedure in docs/DEPLOYMENT.md "Key rotation").
 *
 *   1. Put the new key in INTEGRATIONS_ENCRYPTION_KEY and the old one in
 *      INTEGRATIONS_ENCRYPTION_KEY_PREVIOUS, restart the API.
 *   2. docker compose run --rm --entrypoint node api dist/prisma/reencrypt-secrets.js [--check]
 *   3. When it reports 0 values on the previous key, remove INTEGRATIONS_ENCRYPTION_KEY_PREVIOUS.
 *
 * Covers every sealed value: settings (AI key, SSO client secret, SMTP password, Git token, Salesforce
 * secrets, …), users' 2FA secrets and webhook / Teams URLs and signing secrets. `--check` only counts.
 */
import { PrismaClient, type Prisma } from '@prisma/client';
import { SEALED_RE, SecretBox } from '../src/integrations/secret-box';

export interface ReencryptReport {
  checked: number;
  reencrypted: number;
  unreadable: string[];
}

type Walk = (value: unknown, path: string) => unknown;

export async function reencryptSecrets(
  prisma: PrismaClient,
  box: SecretBox,
  dryRun = false,
): Promise<ReencryptReport> {
  const report: ReencryptReport = { checked: 0, reencrypted: 0, unreadable: [] };
  const fix = (value: string, where: string): string => {
    report.checked += 1;
    try {
      if (!box.usesPreviousKey(value)) return value;
    } catch {
      report.unreadable.push(where);
      return value;
    }
    report.reencrypted += 1;
    return dryRun ? value : box.encrypt(box.decrypt(value));
  };
  const walk: Walk = (value, path) => {
    if (typeof value === 'string') return SEALED_RE.test(value) ? fix(value, path) : value;
    if (Array.isArray(value)) return value.map((v, i) => walk(v, `${path}[${i}]`));
    if (value && typeof value === 'object')
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>).map(([k, v]) => [
          k,
          walk(v, `${path}.${k}`),
        ]),
      );
    return value;
  };

  for (const s of await prisma.setting.findMany()) {
    const before = JSON.stringify(s.value);
    const value = walk(s.value, `Setting ${s.key}`);
    if (!dryRun && JSON.stringify(value) !== before)
      await prisma.setting.update({
        where: { key: s.key },
        data: { value: value as Prisma.InputJsonValue },
      });
  }
  const users = await prisma.user.findMany({
    where: { OR: [{ totpSecretSealed: { not: null } }, { totpPendingSealed: { not: null } }] },
    select: { id: true, totpSecretSealed: true, totpPendingSealed: true },
  });
  for (const u of users) {
    const data = {
      totpSecretSealed: u.totpSecretSealed && fix(u.totpSecretSealed, `User ${u.id} 2FA secret`),
      totpPendingSealed:
        u.totpPendingSealed && fix(u.totpPendingSealed, `User ${u.id} pending 2FA secret`),
    };
    if (!dryRun) await prisma.user.update({ where: { id: u.id }, data });
  }
  const hooks = await prisma.webhook.findMany({
    select: { id: true, urlSealed: true, secretSealed: true },
  });
  for (const h of hooks) {
    const data = {
      urlSealed: fix(h.urlSealed, `Webhook ${h.id} URL`),
      secretSealed: h.secretSealed && fix(h.secretSealed, `Webhook ${h.id} secret`),
    };
    if (!dryRun) await prisma.webhook.update({ where: { id: h.id }, data });
  }
  return report;
}

async function main() {
  const key = process.env.INTEGRATIONS_ENCRYPTION_KEY;
  if (!key) throw new Error('INTEGRATIONS_ENCRYPTION_KEY is not set');
  const dryRun = process.argv.includes('--check');
  const prisma = new PrismaClient();
  try {
    const report = await reencryptSecrets(prisma, new SecretBox(key), dryRun);
    console.log(
      `${dryRun ? 'Check' : 'Re-encryption'}: ${report.checked} sealed values, ` +
        `${report.reencrypted} ${dryRun ? 'still on a previous key' : 're-encrypted with the current key'}.`,
    );
    if (report.unreadable.length) {
      console.error(
        `${report.unreadable.length} value(s) cannot be decrypted with any configured key ` +
          '(re-enter them in Settings):',
      );
      for (const w of report.unreadable) console.error(`  ${w}`);
      process.exitCode = 2;
    }
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) void main();
