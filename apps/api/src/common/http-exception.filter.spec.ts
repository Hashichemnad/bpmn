import { Prisma } from '@prisma/client';
import { describeForLog } from './http-exception.filter';
import { scrubSecrets } from '../audit/audit.service';

describe('Secrets stay out of logs and audit entries (SEC-45)', () => {
  it('logs Prisma errors without their query arguments', () => {
    const err = new Prisma.PrismaClientValidationError(
      'Invalid `prisma.user.update()` invocation: { passwordHash: "$argon2id$v=19$secret" }',
      { clientVersion: '6' },
    );
    const line = describeForLog(err);
    expect(line).toContain('PrismaClientValidationError');
    expect(line).not.toContain('argon2id');
    expect(describeForLog(new Error('plain failure'))).toContain('plain failure');
  });

  it('removes secret keys and sealed values from audit summaries', () => {
    const sealed = 'v1.AAAAAAAAAAAAAAAA.BBBBBBBBBBBBBBBBBBBBBB.CCCC';
    expect(
      scrubSecrets({
        host: 'smtp.example.com',
        privateKeySealed: sealed,
        credentialChanged: true,
        changes: { mystery: { from: sealed, to: 'ok' } },
      }),
    ).toEqual({
      host: 'smtp.example.com',
      credentialChanged: true,
      changes: { mystery: { to: 'ok' } },
    });
  });
});
