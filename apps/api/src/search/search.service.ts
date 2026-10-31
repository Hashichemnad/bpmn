import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  HIGHLIGHT_END,
  HIGHLIGHT_START,
  PERMISSIONS,
  type SearchHitDto,
  type SearchQuery,
  type SearchResultDto,
} from '@processhub/shared';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthUser } from '../common/auth-user';
import { DocsAccessService } from '../docs/docs-access.service';
import { escapeLike, toPrefixTsQuery } from './search-query';

interface Row {
  type: 'page' | 'process';
  id: string;
  titleEn: string;
  titleAr: string;
  snippet: string | null;
  spaceId: string | null;
  code: string | null;
  authorId: string | null;
  updatedAt: Date;
  rank: number;
}

const HEADLINE = `StartSel=${HIGHLIGHT_START}, StopSel=${HIGHLIGHT_END}, MaxWords=35, MinWords=15, MaxFragments=2, FragmentDelimiter=" … "`;

/** Full-text search over wiki pages and processes (PostgreSQL, English + Arabic stemming). */
@Injectable()
export class SearchService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: DocsAccessService,
  ) {}

  async search(q: SearchQuery, user: AuthUser): Promise<SearchResultDto> {
    const tsq = toPrefixTsQuery(q.q);
    const empty = { items: [], total: 0, page: q.page, pageSize: q.pageSize };
    if (!tsq) return empty;

    const wantPages = q.type !== 'processes' && user.permissions.has(PERMISSIONS.DOCS_READ);
    // Processes have no space; a space filter limits the search to pages.
    const wantProcesses =
      q.type !== 'pages' && !q.spaceId && user.permissions.has(PERMISSIONS.PROCESSES_READ);
    const spaceIds = wantPages ? await this.access.visibleSpaceIds(user) : [];
    const parts: Prisma.Sql[] = [];
    // Phase 1 ranks the matches with indexed search vectors only; snippets (ts_headline, which
    // re-parses the text) are computed in phase 2 for the returned page of hits only.
    if (wantPages && spaceIds.length) {
      parts.push(Prisma.sql`
        SELECT 'page' AS "type", p."id", p."updatedAt", ts_rank(p."searchVector", query) AS "rank"
        FROM "Page" p, q
        WHERE p."deletedAt" IS NULL
          AND p."spaceId" = ANY(${spaceIds}::uuid[])
          AND p."searchVector" @@ query
          ${q.spaceId ? Prisma.sql`AND p."spaceId" = ${q.spaceId}::uuid` : Prisma.empty}
          ${
            q.authorId
              ? Prisma.sql`AND (p."createdById" = ${q.authorId}::uuid OR p."updatedById" = ${q.authorId}::uuid
                  OR EXISTS (SELECT 1 FROM "PageVersion" v WHERE v."pageId" = p."id" AND v."createdById" = ${q.authorId}::uuid))`
              : Prisma.empty
          }`);
    }
    const codePrefix = `${escapeLike(q.q.trim())}%`;
    if (wantProcesses) {
      parts.push(Prisma.sql`
        SELECT 'process' AS "type", p."id", p."updatedAt",
          (ts_rank(p."searchVector", query) + CASE WHEN p."code" ILIKE ${codePrefix} THEN 1 ELSE 0 END)::real AS "rank"
        FROM "Process" p, q
        WHERE p."deletedAt" IS NULL AND (p."searchVector" @@ query OR p."code" ILIKE ${codePrefix})
          ${
            q.authorId
              ? Prisma.sql`AND (p."createdById" = ${q.authorId}::uuid OR p."updatedById" = ${q.authorId}::uuid)`
              : Prisma.empty
          }`);
    }
    if (!parts.length) return empty;

    const union = Prisma.join(parts, ' UNION ALL ');
    const withQuery = Prisma.sql`WITH q AS (SELECT to_tsquery('english', ${tsq}) || to_tsquery('arabic', ${tsq}) AS query)`;
    const [hits, count] = await Promise.all([
      this.prisma.$queryRaw<Pick<Row, 'type' | 'id' | 'rank'>[]>`${withQuery}
        SELECT r."type", r."id", r."rank" FROM (${union}) r
        ORDER BY r."rank" DESC, r."updatedAt" DESC
        LIMIT ${q.pageSize} OFFSET ${(q.page - 1) * q.pageSize}`,
      this.prisma.$queryRaw<{ total: bigint }[]>`${withQuery}
        SELECT count(*) AS total FROM (${union}) r`,
    ]);
    const idsOf = (type: Row['type']) => hits.filter((h) => h.type === type).map((h) => h.id);
    const pageIds = idsOf('page');
    const processIds = idsOf('process');
    const [pageRows, processRows] = await Promise.all([
      pageIds.length
        ? this.prisma.$queryRaw<Omit<Row, 'type' | 'rank'>[]>`${withQuery}
            SELECT p."id", p."titleEn", p."titleAr",
              CASE WHEN p."textEn" <> '' AND to_tsvector('english', p."textEn") @@ query
                THEN ts_headline('english', p."textEn", query, ${HEADLINE})
                ELSE ts_headline('arabic', p."textAr", query, ${HEADLINE}) END AS "snippet",
              p."spaceId", NULL::text AS "code", p."updatedById" AS "authorId", p."updatedAt"
            FROM "Page" p, q WHERE p."id" = ANY(${pageIds}::uuid[])`
        : [],
      processIds.length
        ? this.prisma.$queryRaw<Omit<Row, 'type' | 'rank'>[]>`${withQuery}
            SELECT p."id", p."nameEn" AS "titleEn", p."nameAr" AS "titleAr",
              CASE WHEN p."descriptionEn" <> '' AND to_tsvector('english', p."descriptionEn") @@ query
                THEN ts_headline('english', p."descriptionEn", query, ${HEADLINE})
                ELSE ts_headline('arabic', p."descriptionAr", query, ${HEADLINE}) END AS "snippet",
              NULL::uuid AS "spaceId", p."code", p."updatedById" AS "authorId", p."updatedAt"
            FROM "Process" p, q WHERE p."id" = ANY(${processIds}::uuid[])`
        : [],
    ]);
    const detail = new Map([...pageRows, ...processRows].map((r) => [r.id, r]));
    const rows: Row[] = hits.flatMap((h) => {
      const d = detail.get(h.id);
      return d ? [{ ...d, type: h.type, rank: h.rank }] : [];
    });

    const [spaces, users] = await Promise.all([
      this.prisma.space.findMany({
        where: { id: { in: rows.map((r) => r.spaceId).filter((v): v is string => !!v) } },
        select: { id: true, key: true, nameEn: true, nameAr: true },
      }),
      this.prisma.user.findMany({
        where: { id: { in: rows.map((r) => r.authorId).filter((v): v is string => !!v) } },
        select: { id: true, email: true, nameEn: true, nameAr: true },
      }),
    ]);
    const spaceById = new Map(spaces.map((s) => [s.id, s]));
    const userById = new Map(users.map((u) => [u.id, u]));
    const items: SearchHitDto[] = rows.map((r) => ({
      type: r.type,
      id: r.id,
      titleEn: r.titleEn,
      titleAr: r.titleAr,
      snippet: r.snippet ?? '',
      ...(r.spaceId ? { space: spaceById.get(r.spaceId) } : {}),
      ...(r.code ? { code: r.code } : {}),
      author: r.authorId ? (userById.get(r.authorId) ?? null) : null,
      updatedAt: r.updatedAt.toISOString(),
      rank: Number(r.rank),
    }));
    return { items, total: Number(count[0]?.total ?? 0), page: q.page, pageSize: q.pageSize };
  }
}
