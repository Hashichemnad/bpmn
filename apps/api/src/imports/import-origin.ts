import type { ImportEntity, ImportOriginDto } from '@processhub/shared';
import type { PrismaService } from '../prisma/prisma.service';

/** The batch (number and source file) that created an entity — the visible "Imported" flag. */
export async function importOrigin(
  prisma: PrismaService,
  entity: ImportEntity,
  id: string,
  batchId: string | null,
): Promise<ImportOriginDto | null> {
  if (!batchId) return null;
  const [batch, item] = await Promise.all([
    prisma.importBatch.findUnique({ where: { id: batchId }, select: { id: true, number: true } }),
    prisma.importItem.findFirst({
      where: { batchId, entityType: entity, entityId: id },
      select: { source: true },
    }),
  ]);
  if (!batch) return null;
  return {
    batchId: batch.id,
    number: `IMP-${String(batch.number).padStart(4, '0')}`,
    source: item?.source ?? '',
  };
}
