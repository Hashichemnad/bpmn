import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { ImportIssue, ImportKind } from '@processhub/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../storage/storage.service';
import type { ApplyContext, Importer, ParseContext, ParsedItem } from '../importer';
import { ImportFileError, openSafeZip, sha256, type SafeZip } from '../safe-upload';
import {
  PACKAGE_FORMAT,
  PACKAGE_TABLES,
  PACKAGE_VERSION,
  USER_ROLES_FILE,
  delegate,
  type PackageTable,
} from '../repository-package';
import { issue } from './tabular';

type Row = Record<string, unknown>;
type AnyDelegate = {
  createMany(args: { data: Row[]; skipDuplicates?: boolean }): Promise<{ count: number }>;
  findMany(args?: unknown): Promise<Row[]>;
};

interface Manifest {
  format: string;
  version: number;
  createdAt: string;
  organisation: string;
  counts: Record<string, number>;
  files: { path: string; sha256: string; bytes: number }[];
}

/** JSON columns per model (a JSON null must be written as DbNull). */
const JSON_FIELDS = new Map(
  Prisma.dmmf.datamodel.models.map((m) => [
    m.name,
    new Set(m.fields.filter((f) => f.kind === 'scalar' && f.type === 'Json').map((f) => f.name)),
  ]),
);

/**
 * Restores a full export package into an empty installation (M15 step 7, D-163; Super Admin):
 * manifest and checksums verified, the target must have no processes, pages, diagrams or library
 * objects yet; tables are written in foreign-key order with their ids, users are matched by
 * e-mail (no passwords — they sign in through an invitation or SSO), attachments go back to storage.
 */
@Injectable()
export class PackageImporter implements Importer {
  readonly kinds: ImportKind[] = ['PACKAGE'];

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  private async open(data: Buffer, file: string): Promise<{ zip: SafeZip; manifest: Manifest }> {
    const zip = await openSafeZip(data, file);
    if (!zip.has('manifest.json')) throw new ImportFileError('NOT_A_PACKAGE', { file });
    let manifest: Manifest;
    try {
      manifest = JSON.parse(await zip.readText('manifest.json')) as Manifest;
    } catch {
      throw new ImportFileError('NOT_A_PACKAGE', { file });
    }
    if (manifest.format !== PACKAGE_FORMAT) throw new ImportFileError('NOT_A_PACKAGE', { file });
    if (manifest.version > PACKAGE_VERSION)
      throw new ImportFileError('PACKAGE_VERSION', { version: manifest.version });
    return { zip, manifest };
  }

  async parse(ctx: ParseContext) {
    const f = ctx.files[0];
    const { zip, manifest } = await this.open(f.data, f.fileName);
    const issues: ImportIssue[] = [];
    // Checksums of the data and attachment files (the readable copies are not needed for a restore).
    let n = 0;
    const needed = manifest.files.filter(
      (x) => x.path.startsWith('data/') || x.path.startsWith('files/'),
    );
    for (const x of needed) {
      if (++n % 50 === 0) await ctx.progress(n / needed.length, x.path);
      if (!zip.has(x.path) || sha256(await zip.read(x.path)) !== x.sha256)
        throw new ImportFileError('PACKAGE_CHECKSUM', { path: x.path });
    }
    const [processes, pages, diagrams, objects] = await Promise.all([
      this.prisma.process.count({ where: { deletedAt: null } }),
      this.prisma.page.count({ where: { deletedAt: null } }),
      this.prisma.diagram.count({ where: { deletedAt: null } }),
      this.prisma.repoObject.count({ where: { deletedAt: null } }),
    ]);
    const notEmpty = processes + pages + diagrams + objects > 0;
    if (notEmpty)
      issues.push(issue('ERROR', 'TARGET_NOT_EMPTY', { processes, pages, diagrams, objects }));
    const items: ParsedItem[] = [...PACKAGE_TABLES.map((t) => t.model), 'UserRole'].map(
      (model, i) => ({
        ref: `table:${model}`,
        entity: 'MODULE_ROWS',
        key: model,
        nameEn: model,
        nameAr: model,
        action: 'CREATE',
        matchId: null,
        matchBy: null,
        source: `${f.fileName} › data/${model}.json`,
        issues: notEmpty
          ? [issue('ERROR', 'TARGET_NOT_EMPTY', { processes, pages, diagrams, objects })]
          : [],
        changes: [],
        suggestions: [],
        skip: false,
        facts: { rows: manifest.counts[model] ?? 0 },
        order: model === 'UserRole' ? 1.5 : i,
      }),
    );
    return {
      items,
      issues: [
        issue('WARNING', 'PACKAGE_INFO', {
          organisation: manifest.organisation,
          date: manifest.createdAt.slice(0, 10),
        }),
      ],
    };
  }

  async apply(ctx: ApplyContext, items: ParsedItem[]) {
    const [file] = await ctx.files();
    const { zip } = await this.open(file.data, file.fileName);
    const ids = new Map<string, string>();
    const remap = (row: Row, t: PackageTable | null): Row => {
      const out: Row = {};
      const json = t ? JSON_FIELDS.get(t.model) : undefined;
      for (const [k, v] of Object.entries(row)) {
        let val: unknown = typeof v === 'string' && ids.has(v) && k !== 'id' ? ids.get(v) : v;
        if (t?.nullOnImport?.includes(k)) val = null;
        if (val === null && json?.has(k)) val = Prisma.DbNull;
        out[k] = val;
      }
      return out;
    };
    const read = async (path: string) =>
      zip.has(path) ? (JSON.parse(await zip.readText(path)) as Row[]) : [];
    for (const item of items) {
      const model = item.key;
      await ctx.step(item, async (tx) => {
        if (model === 'UserRole') {
          const roles = new Map((await tx.role.findMany()).map((r) => [r.key, r.id]));
          const rows = (await read(USER_ROLES_FILE)) as { userId: string; roleKey: string }[];
          const data = rows
            .map((r) => ({ userId: ids.get(r.userId) ?? r.userId, roleId: roles.get(r.roleKey) }))
            .filter((r): r is { userId: string; roleId: string } => !!r.roleId);
          const res = await tx.userRole.createMany({ data, skipDuplicates: true });
          return {
            entity: 'MODULE_ROWS',
            entityId: null,
            outcome: 'CREATED',
            key: model,
            after: { rows: res.count },
          };
        }
        const t = PACKAGE_TABLES.find((x) => x.model === model)!;
        const d = (tx as unknown as Record<string, AnyDelegate>)[delegate(model)];
        let rows = await read(`data/${model}.json`);
        if (t.matchBy) {
          const existing = await d.findMany({
            where: { [t.matchBy]: { in: rows.map((r) => r[t.matchBy!]) } },
          });
          const byKey = new Map(
            existing.map((e) => [String(e[t.matchBy!]).toLowerCase(), e.id as string]),
          );
          rows = rows.filter((r) => {
            const hit = byKey.get(String(r[t.matchBy!]).toLowerCase());
            if (hit) ids.set(r.id as string, hit);
            return !hit;
          });
        }
        if (model === 'User') rows = rows.map((r) => ({ ...r, passwordHash: '' }));
        if (model === 'Setting') {
          for (const r of rows)
            await tx.setting.upsert({
              where: { key: r.key as string },
              create: {
                key: r.key as string,
                value: r.value as Prisma.InputJsonValue,
                updatedById: ctx.actor.id,
              },
              update: { value: r.value as Prisma.InputJsonValue, updatedById: ctx.actor.id },
            });
          return {
            entity: 'MODULE_ROWS',
            entityId: null,
            outcome: 'CREATED',
            key: model,
            after: { rows: rows.length },
          };
        }
        let count = 0;
        for (let i = 0; i < rows.length; i += 500) {
          const res = await d.createMany({
            data: rows.slice(i, i + 500).map((r) => remap(r, t)),
            skipDuplicates: true,
          });
          count += res.count;
        }
        if (model === 'Attachment')
          for (const a of rows as { id: string; storageKey: string; contentType: string }[]) {
            const path = `files/attachments/${a.id}`;
            if (zip.has(path))
              await this.storage.put(a.storageKey, await zip.read(path), a.contentType);
          }
        return {
          entity: 'MODULE_ROWS',
          entityId: null,
          outcome: 'CREATED',
          key: model,
          after: { rows: count },
        };
      });
    }
  }
}
