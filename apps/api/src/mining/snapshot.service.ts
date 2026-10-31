import { Injectable, Logger } from '@nestjs/common';
import { promisify } from 'node:util';
import { gunzip, gzip } from 'node:zlib';
import type { EventLog } from '@prisma/client';
import { LogDataBuilder, encodeLogData, type MiningEventInput } from '@processhub/shared';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';

const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);

export const snapshotKey = (logId: string, version: number) => `mining/${logId}/v${version}.bin.gz`;

/**
 * Columnar snapshot of a log (D-128): gzip in the file storage, keyed by the data version; a small
 * in-memory cache keeps the last few decoded snapshots for repeated analyses. A missing snapshot
 * (storage restored without it) is rebuilt from the events table.
 */
@Injectable()
export class SnapshotService {
  private readonly logger = new Logger(SnapshotService.name);
  private readonly cache = new Map<string, Uint8Array>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  async save(logId: string, version: number, bytes: Uint8Array): Promise<string> {
    const key = snapshotKey(logId, version);
    const gz = await gzipAsync(bytes, { level: 6 });
    await this.storage.put(key, gz, 'application/gzip');
    this.remember(key, bytes);
    return key;
  }

  private remember(key: string, bytes: Uint8Array) {
    this.cache.delete(key);
    this.cache.set(key, bytes);
    while (this.cache.size > 3) this.cache.delete(this.cache.keys().next().value!);
  }

  /** Binary snapshot of the log's current data version. */
  async load(
    log: Pick<EventLog, 'id' | 'dataVersion' | 'snapshotKey' | 'attributeNames'>,
  ): Promise<Uint8Array> {
    const key = log.snapshotKey ?? snapshotKey(log.id, log.dataVersion);
    const hit = this.cache.get(key);
    if (hit) {
      this.remember(key, hit);
      return hit;
    }
    try {
      const parts: Buffer[] = [];
      for await (const c of await this.storage.get(key)) parts.push(c as Buffer);
      const bytes = new Uint8Array(await gunzipAsync(Buffer.concat(parts)));
      this.remember(key, bytes);
      return bytes;
    } catch (e) {
      this.logger.warn(`Snapshot ${key} missing (${(e as Error).message}); rebuilding from events`);
      return this.rebuild(log);
    }
  }

  /** Reads the events of a log in id order (batches of 20,000) and writes a new snapshot. */
  async rebuild(log: Pick<EventLog, 'id' | 'dataVersion' | 'attributeNames'>): Promise<Uint8Array> {
    const builder = new LogDataBuilder(log.attributeNames);
    let cursor: bigint | undefined;
    for (;;) {
      const rows = await this.prisma.miningEvent.findMany({
        where: { logId: log.id, ...(cursor ? { id: { gt: cursor } } : {}) },
        orderBy: { id: 'asc' },
        take: 20_000,
      });
      if (!rows.length) break;
      for (const r of rows) {
        const e: MiningEventInput = {
          caseId: r.caseId,
          activity: r.activity,
          start: r.startAt?.getTime() ?? null,
          end: r.endAt.getTime(),
          resource: r.resource,
          department: r.department,
          attrs: (r.attributes ?? {}) as Record<string, string>,
        };
        builder.add(e);
      }
      cursor = rows[rows.length - 1].id;
    }
    const bytes = encodeLogData(builder.build());
    await this.save(log.id, log.dataVersion, bytes);
    return bytes;
  }

  async remove(logId: string, version: number) {
    const key = snapshotKey(logId, version);
    this.cache.delete(key);
    await this.storage.remove(key).catch(() => undefined);
  }
}
