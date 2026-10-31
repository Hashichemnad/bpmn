import type { Prisma } from '@prisma/client';
import type {
  ImportColumnDto,
  ImportEntity,
  ImportFieldDto,
  ImportIssue,
  ImportKind,
  ImportOptions,
  ImportPreviewItem,
  Locale,
} from '@processhub/shared';
import type { AuthUser } from '../common/auth-user';
import type { ExcelFile } from '../common/excel';
import type { SniffedType } from './safe-upload';

/** An uploaded file of the batch, loaded from storage and checked (safe-upload). */
export interface LoadedImportFile {
  id: string;
  fileName: string;
  ext: string;
  type: SniffedType;
  data: Buffer;
}

/** A preview item plus the importer's own payload (kept on the batch, never sent to the browser). */
export interface ParsedItem extends ImportPreviewItem {
  data?: unknown;
  /** Items created before this one in the same batch (parents first). */
  order?: number;
}

export interface ParseContext {
  batchId: string;
  batchNumber: string;
  kind: ImportKind;
  options: ImportOptions;
  actor: AuthUser;
  files: LoadedImportFile[];
  progress(value: number, message?: string): Promise<void>;
  /**
   * Entities written by earlier applied batches, by external key (re-import, D-156): returns
   * externalKey → entity id for entities that still exist.
   */
  previous(entity: ImportEntity, keys: string[]): Promise<Map<string, string>>;
}

export interface ParseOutput {
  items: ParsedItem[];
  columns?: ImportColumnDto[];
  fields?: ImportFieldDto[];
  issues?: ImportIssue[];
}

/** What one apply step wrote. */
export interface StepRecord {
  entity: ImportEntity;
  entityId: string | null;
  outcome: 'CREATED' | 'UPDATED' | 'SKIPPED';
  externalKey?: string;
  key?: string;
  nameEn?: string;
  nameAr?: string;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
}

export interface ApplyContext {
  batchId: string;
  batchNumber: string;
  kind: ImportKind;
  options: ImportOptions;
  actor: AuthUser;
  /** Files of the batch (loaded lazily on the first call). */
  files(): Promise<LoadedImportFile[]>;
  /**
   * Applies one preview item in its own transaction: the callback writes the entities and returns
   * what it wrote; the ImportItem rows and audit entries are written in the same transaction. A
   * failure is recorded as FAILED and the batch continues; cancellation stops the loop.
   */
  step(
    item: ParsedItem,
    fn: (tx: Prisma.TransactionClient) => Promise<StepRecord | StepRecord[]>,
  ): Promise<StepRecord[] | null>;
  progress(value: number, message?: string): Promise<void>;
}

export interface ApplyOutput {
  /** Counts of an existing module import (GRC / EA / KPI). */
  module?: { rows: number; created: number; updated: number; pending?: number };
}

/** An import kind's parser and writer (registered in ImportRegistry). */
export interface Importer {
  readonly kinds: readonly ImportKind[];
  parse(ctx: ParseContext): Promise<ParseOutput>;
  /** `items`: not skipped, no errors, action CREATE / UPDATE; sorted by `order`. */
  /** `all`: every preview item (also skipped ones, e.g. matched library objects). */
  apply(ctx: ApplyContext, items: ParsedItem[], all: ParsedItem[]): Promise<ApplyOutput | void>;
  template?(kind: ImportKind, locale: Locale): Promise<ExcelFile>;
}

export const IMPORTER = Symbol('IMPORTER');
