import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { collectRoutes, routeTable, type RouteInfo } from './route-inventory';

const SECURITY_DOC = join(__dirname, '../../../docs/SECURITY.md');
const START = '<!-- route-table:start -->';
const END = '<!-- route-table:end -->';

/** Table rows without the column padding Prettier adds. */
const normalise = (table: string) =>
  table
    .trim()
    .split('\n')
    .map((line) =>
      line
        .split('|')
        .map((cell) => (/^\s*:?-+:?\s*$/.test(cell) ? '---' : cell.trim()))
        .join('|'),
    )
    .join('\n');

/** Every route must explicitly declare who may call it (deny-by-default guard). */
describe('Route security declarations', () => {
  let routes: RouteInfo[];

  beforeAll(async () => {
    routes = await collectRoutes();
  });

  it('every controller method declares Public, permissions or Authenticated', () => {
    expect(routes.length).toBeGreaterThan(40);
    expect(routes.filter((r) => r.access === 'NONE')).toEqual([]);
    const publicRoutes = routes
      .filter((r) => r.access === 'public')
      .map((r) => `${r.method} ${r.path}`)
      .sort();
    expect(publicRoutes).toEqual([
      'GET /auth/csrf',
      'GET /health',
      'GET /settings/logo',
      'GET /settings/public',
      'POST /auth/login',
      'POST /auth/logout',
      'POST /auth/refresh',
    ]);
  });

  it('every body, query and path parameter passes through a validation pipe', () => {
    const unvalidated = routes.flatMap((r) =>
      r.inputs.filter((i) => !i.validated).map((i) => `${r.method} ${r.path} ${i.kind}`),
    );
    // Uploads are checked in the service (allow-list, magic bytes, size) and by multer limits.
    expect(unvalidated.sort()).toEqual([
      'POST /pages/:id/attachments file',
      'POST /settings/logo file',
    ]);
  });

  it('password and session routes have the stricter login rate limit', () => {
    const strict = routes
      .filter((r) => r.rateLimit === 'login')
      .map((r) => `${r.method} ${r.path}`)
      .sort();
    expect(strict).toEqual(['POST /auth/change-password', 'POST /auth/login', 'POST /auth/refresh']);
    expect(routes.filter((r) => r.rateLimit === 'skip').map((r) => r.path)).toEqual(['/health']);
  });

  it('docs/SECURITY.md lists every endpoint with its guards (UPDATE_SECURITY_DOC=1 rewrites it)', () => {
    const doc = readFileSync(SECURITY_DOC, 'utf8');
    const start = doc.indexOf(START);
    const end = doc.indexOf(END);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const table = routeTable(routes);
    if (process.env.UPDATE_SECURITY_DOC === '1') {
      writeFileSync(
        SECURITY_DOC,
        `${doc.slice(0, start + START.length)}\n\n${table}\n\n${doc.slice(end)}`,
      );
      return;
    }
    expect(normalise(doc.slice(start + START.length, end))).toEqual(normalise(table));
  });
});
