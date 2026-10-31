import {
  DEFAULT_IMPORT_SETTINGS,
  SETTING_KEYS,
  importSettingsSchema,
  type ImportSettings,
} from '@processhub/shared';
import type { PrismaService } from '../prisma/prisma.service';

/** Setting `imports` (D-164): welcome e-mail under SSO, AI on imported documents (off by default). */
export async function readImportSettings(prisma: PrismaService): Promise<ImportSettings> {
  const row = await prisma.setting.findUnique({ where: { key: SETTING_KEYS.IMPORTS } });
  const parsed = importSettingsSchema.partial().safeParse(row?.value ?? {});
  return { ...DEFAULT_IMPORT_SETTINGS, ...(parsed.success ? parsed.data : {}) };
}
