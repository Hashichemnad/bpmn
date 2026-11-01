import {
  DEFAULT_IMPORT_SETTINGS,
  SETTING_KEYS,
  importSettingsSchema,
  type ImportSettings,
} from '@processhub/shared';
import { HttpStatus } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service';
import { AppException } from '../common/app-exception';

/** Setting `imports` (D-164): welcome e-mail under SSO, AI on imported documents (off by default). */
export async function readImportSettings(prisma: PrismaService): Promise<ImportSettings> {
  const row = await prisma.setting.findUnique({ where: { key: SETTING_KEYS.IMPORTS } });
  const parsed = importSettingsSchema.partial().safeParse(row?.value ?? {});
  return { ...DEFAULT_IMPORT_SETTINGS, ...(parsed.success ? parsed.data : {}) };
}

/**
 * Every AI feature that sends an item's content to the provider calls this (final session part B,
 * SEC-35): content that came in through the Import Center (Word / PDF / Confluence / Visio …, the
 * "Imported" flag) is only sent while Import settings → "Allow AI on imported documents" is on —
 * off until DOF approves sending it outside the UAE (D-164).
 */
export async function assertAiAllowedOnItem(
  prisma: PrismaService,
  type: 'PROCESS' | 'PAGE' | 'DIAGRAM',
  id: string,
): Promise<void> {
  const select = { importBatchId: true } as const;
  const row =
    type === 'PROCESS'
      ? await prisma.process.findUnique({ where: { id }, select })
      : type === 'PAGE'
        ? await prisma.page.findUnique({ where: { id }, select })
        : await prisma.diagram.findUnique({ where: { id }, select });
  if (!row?.importBatchId) return;
  if ((await readImportSettings(prisma)).allowAiOnImportedDocuments) return;
  throw new AppException(
    HttpStatus.FORBIDDEN,
    'AI_IMPORTS_DISABLED',
    'AI on imported documents is off',
  );
}
