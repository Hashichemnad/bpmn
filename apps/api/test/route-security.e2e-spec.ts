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
      'GET /auth/invitations/:token',
      'GET /auth/options',
      'GET /auth/sso/callback',
      'GET /auth/sso/start',
      'GET /health',
      'GET /settings/logo',
      'GET /settings/public',
      'POST /auth/invitations/accept',
      'POST /auth/login',
      'POST /auth/login/mfa',
      'POST /auth/login/mfa/setup',
      'POST /auth/login/mfa/setup/confirm',
      'POST /auth/logout',
      'POST /auth/refresh',
    ]);
  });

  it('every public API route (/api/public/v1) is read-only and needs the listed API key scope', () => {
    const publicApi = routes
      .filter((r) => r.path.startsWith('/api/public/'))
      .map((r) => `${r.method} ${r.path.replace('/api/public/v1', '')} ${r.access}`)
      .sort();
    // Changing this list is a security decision: update docs/integrations/API.md as well.
    expect(publicApi).toEqual(
      [
        'GET /applications apikey:ea:read',
        'GET /capabilities apikey:ea:read',
        'GET /controls apikey:grc:read',
        'GET /diagrams apikey:diagrams:read',
        'GET /diagrams/:id apikey:diagrams:read',
        'GET /diagrams/:id/svg apikey:diagrams:read',
        'GET /kpis apikey:kpis:read',
        'GET /kpis/:id/measurements apikey:kpis:read',
        'GET /me apikey:any',
        'GET /objects apikey:objects:read',
        'GET /pages apikey:pages:read',
        'GET /pages/:id apikey:pages:read',
        'GET /process-house apikey:processes:read',
        'GET /processes apikey:processes:read',
        'GET /processes/:id apikey:processes:read',
        'GET /processes/:id/bpmn apikey:processes:read',
        'GET /processes/:id/svg apikey:processes:read',
        'GET /processes/:id/versions apikey:processes:read',
        'GET /reporting apikey:reporting:read',
        'GET /reporting/:table apikey:reporting:read',
        'GET /requirements apikey:grc:read',
        'GET /risks apikey:grc:read',
        'GET /spaces apikey:pages:read',
        'GET /workflow/cases apikey:workflow:cases:read',
        'GET /workflow/statistics apikey:workflow:read',
      ].sort(),
    );
    // API key routes exist only under the public prefix, and nothing else lives there.
    expect(
      routes.filter((r) => r.access.startsWith('apikey:') !== r.path.startsWith('/api/public/')),
    ).toEqual([]);
  });

  it('every body, query and path parameter passes through a validation pipe', () => {
    const unvalidated = routes.flatMap((r) =>
      r.inputs.filter((i) => !i.validated).map((i) => `${r.method} ${r.path} ${i.kind}`),
    );
    // Uploads are checked in the service (allow-list, magic bytes, size) and by multer limits.
    expect(unvalidated.sort()).toEqual([
      'POST /audits/findings/:id/files file',
      'POST /audits/items/:id/files file',
      'POST /control-tests/:id/files file',
      'POST /ea/import/:kind file',
      'POST /grc/import/:kind file',
      'POST /issues/:id/files file',
      'POST /issues/actions/:id/files file',
      'POST /kpis/import/:kind file',
      'POST /kpis/measurements/:measurementId/files file',
      'POST /mining/logs/upload file',
      'POST /pages/:id/attachments file',
      'POST /settings/logo file',
      'POST /surveys/responses/:id/files file',
      'POST /workflow/files file',
    ]);
  });

  it('password and session routes have the stricter login rate limit', () => {
    const strict = routes
      .filter((r) => r.rateLimit === 'login')
      .map((r) => `${r.method} ${r.path}`)
      .sort();
    expect(strict).toEqual([
      'GET /auth/invitations/:token',
      'GET /auth/sso/callback',
      'GET /auth/sso/start',
      'POST /auth/change-password',
      'POST /auth/invitations/accept',
      'POST /auth/login',
      'POST /auth/login/mfa',
      'POST /auth/login/mfa/setup',
      'POST /auth/login/mfa/setup/confirm',
      'POST /auth/mfa/disable',
      'POST /auth/mfa/enable',
      'POST /auth/mfa/recovery-codes',
      'POST /auth/mfa/setup',
      'POST /auth/refresh',
    ]);
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
