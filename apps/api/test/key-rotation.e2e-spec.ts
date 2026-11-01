import { randomBytes } from 'node:crypto';
import { SecretBox } from '../src/integrations/secret-box';
import { reencryptSecrets } from '../prisma/reencrypt-secrets';
import { createApp, createUser, resetDb, type TestContext } from './helpers';

/** Rotation of INTEGRATIONS_ENCRYPTION_KEY (final session part B, SEC-40). */
describe('Encryption key rotation (e2e)', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createApp();
  });
  afterAll(async () => {
    await ctx.app.close();
  });

  it('re-encrypts settings, 2FA secrets and webhooks with the new key', async () => {
    await resetDb(ctx.prisma);
    const oldKey = process.env.INTEGRATIONS_ENCRYPTION_KEY!;
    const newKey = randomBytes(32).toString('base64');
    const old = new SecretBox(oldKey, '');
    const user = await createUser(ctx.prisma, 'admin@test.local', ['SUPER_ADMIN']);
    await ctx.prisma.setting.create({
      data: {
        key: 'notifications.email',
        value: { host: 'smtp.example.com', smtp: { passwordSealed: old.encrypt('smtp-secret') } },
      },
    });
    await ctx.prisma.user.update({
      where: { id: user.id },
      data: { totpSecretSealed: old.encrypt('JBSWY3DPEHPK3PXP') },
    });
    const hook = await ctx.prisma.webhook.create({
      data: {
        kind: 'WEBHOOK',
        name: 'Hook',
        urlSealed: old.encrypt('https://hooks.example.com/x'),
        urlDisplay: 'https://hooks.example.com/…',
        secretSealed: old.encrypt('whsec'),
      },
    });

    const rotated = new SecretBox(newKey, oldKey);
    expect(await reencryptSecrets(ctx.prisma, rotated, true)).toMatchObject({
      checked: 4,
      reencrypted: 4,
      unreadable: [],
    });
    expect(await reencryptSecrets(ctx.prisma, rotated)).toMatchObject({ reencrypted: 4 });
    expect(await reencryptSecrets(ctx.prisma, rotated, true)).toMatchObject({ reencrypted: 0 });

    // Readable with the new key alone; no longer with the old one.
    const only = new SecretBox(newKey, '');
    const setting = await ctx.prisma.setting.findUniqueOrThrow({
      where: { key: 'notifications.email' },
    });
    const sealed = (setting.value as { smtp: { passwordSealed: string } }).smtp.passwordSealed;
    expect(only.decrypt(sealed)).toBe('smtp-secret');
    expect(() => old.decrypt(sealed)).toThrow();
    const u = await ctx.prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(only.decrypt(u.totpSecretSealed!)).toBe('JBSWY3DPEHPK3PXP');
    const h = await ctx.prisma.webhook.findUniqueOrThrow({ where: { id: hook.id } });
    expect(only.decrypt(h.urlSealed)).toBe('https://hooks.example.com/x');
    expect(only.decrypt(h.secretSealed!)).toBe('whsec');

    // A value no configured key opens is reported, not destroyed.
    const stranger = new SecretBox(randomBytes(32).toString('base64'), '');
    await ctx.prisma.webhook.update({
      where: { id: hook.id },
      data: { secretSealed: stranger.encrypt('lost') },
    });
    const report = await reencryptSecrets(ctx.prisma, only);
    expect(report.unreadable).toEqual([`Webhook ${hook.id} secret`]);
  });
});
