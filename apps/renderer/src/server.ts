/**
 * ProcessHub renderer (Phase 4.4, D-172): an internal HTTP service that draws diagrams and prints
 * HTML to PDF with headless Chromium, for exports and scheduled report e-mails.
 *
 * - Reachable only from the API on an internal Docker network (no internet), protected by a shared
 *   token (RENDERER_TOKEN, compared in constant time).
 * - The page code is the web app's own renderer bundle (`apps/web/render.html`, built into
 *   BUNDLE_DIR) served from disk through request interception; every other request is aborted and
 *   Chromium's proxy points to a closed port, so nothing can leave the container.
 * - Chromium's own sandbox is used when the host allows it (RENDERER_SANDBOX, src/sandbox.ts).
 * - Limits: request body, source size, per-job timeout, concurrency; the browser is recycled after a
 *   number of jobs and relaunched after a crash.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, normalize, sep } from 'node:path';
import { timingSafeEqual } from 'node:crypto';
import { chromium, type Browser, type BrowserContext, type Route } from 'playwright-core';
import { launchWithSandbox, parseSandboxMode } from './sandbox.js';

const env = process.env;
const PORT = Number(env.PORT ?? 3100);
const TOKEN = env.RENDERER_TOKEN ?? '';
const BUNDLE_DIR = normalize(env.BUNDLE_DIR ?? join(process.cwd(), 'bundle'));
const CHROMIUM_PATH =
  env.CHROMIUM_PATH ||
  ['/usr/bin/chromium-browser', '/usr/bin/chromium'].find((p) => existsSync(p)) ||
  undefined;
const MAX_BODY_BYTES = Number(env.RENDERER_MAX_BODY_MB ?? 16) * 1024 * 1024;
const JOB_TIMEOUT_MS = Number(env.RENDERER_JOB_TIMEOUT_MS ?? 45000);
const CONCURRENCY = Math.max(1, Number(env.RENDERER_CONCURRENCY ?? 2));
const RECYCLE_AFTER = Math.max(1, Number(env.RENDERER_RECYCLE_AFTER ?? 200));
const SANDBOX_MODE = parseSandboxMode(env.RENDERER_SANDBOX);
/** Fake origin the bundle is served from (never resolved: requests are intercepted). */
const ORIGIN = 'http://renderer.local';

if (TOKEN.length < 16) {
  console.error('RENDERER_TOKEN must be set (at least 16 characters).');
  process.exit(1);
}

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json',
};

// ---------- browser ----------

const CHROMIUM_ARGS = [
  '--disable-dev-shm-usage',
  '--disable-gpu',
  '--disable-extensions',
  '--disable-background-networking',
  '--no-first-run',
  '--font-render-hinting=none',
  // Defence in depth: anything not intercepted goes to a closed port.
  '--proxy-server=http://127.0.0.1:9',
  '--proxy-bypass-list=<-loopback>',
];

let browser: Browser | null = null;
/** Whether the running browser has Chromium's sandbox (null until the first launch). */
let sandboxActive: boolean | null = null;
let launching: Promise<Browser> | null = null;
let jobsOnBrowser = 0;
let active = 0;
const waiting: (() => void)[] = [];

async function getBrowser(): Promise<Browser> {
  if (browser?.isConnected() && jobsOnBrowser < RECYCLE_AFTER) return browser;
  if (launching) return launching;
  launching = (async () => {
    const old = browser;
    browser = null;
    // Recycled only when idle; running jobs keep their own reference.
    if (old) void old.close().catch(() => undefined);
    // Chromium's own sandbox first (needs user namespaces: deploy/renderer-seccomp.json in Docker);
    // `auto` falls back to --no-sandbox inside the hardened container (D-180, SECURITY.md).
    const launched = await launchWithSandbox(SANDBOX_MODE, (sandbox) =>
      chromium.launch({
        executablePath: CHROMIUM_PATH,
        chromiumSandbox: sandbox,
        args: CHROMIUM_ARGS,
      }),
    );
    const b = launched.value;
    sandboxActive = launched.sandbox;
    b.on('disconnected', () => {
      if (browser === b) browser = null;
    });
    browser = b;
    jobsOnBrowser = 0;
    return b;
  })().finally(() => {
    launching = null;
  });
  return launching;
}

async function serveBundle(route: Route): Promise<void> {
  const url = new URL(route.request().url());
  if (url.origin !== ORIGIN) return route.abort('blockedbyclient');
  const path = normalize(join(BUNDLE_DIR, decodeURIComponent(url.pathname)));
  if (!path.startsWith(BUNDLE_DIR + sep)) return route.abort('accessdenied');
  try {
    const body = await readFile(path);
    return route.fulfill({
      status: 200,
      body,
      headers: { 'content-type': TYPES[extname(path)] ?? 'application/octet-stream' },
    });
  } catch {
    return route.fulfill({ status: 404, body: 'not found' });
  }
}

async function withContext<T>(fn: (ctx: BrowserContext) => Promise<T>): Promise<T> {
  if (active >= CONCURRENCY) await new Promise<void>((r) => waiting.push(r));
  active++;
  let ctx: BrowserContext | null = null;
  let timer: NodeJS.Timeout | undefined;
  try {
    const b = await getBrowser();
    jobsOnBrowser++;
    ctx = await b.newContext({
      viewport: { width: 1600, height: 1000 },
      offline: false,
      serviceWorkers: 'block',
      acceptDownloads: false,
    });
    await ctx.route('**/*', serveBundle);
    const current = ctx;
    return await Promise.race([
      fn(current),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('timeout')), JOB_TIMEOUT_MS);
      }),
    ]);
  } finally {
    clearTimeout(timer);
    if (ctx) await ctx.close().catch(() => undefined);
    active--;
    waiting.shift()?.();
  }
}

// ---------- jobs ----------

interface RenderBody {
  kind: 'bpmn' | 'graph';
  source: string;
  locale: 'en' | 'ar';
  format: 'svg' | 'png';
  maxWidth?: number;
  theme?: unknown;
}

function parseRender(raw: unknown): RenderBody {
  const b = raw as Partial<RenderBody>;
  if (!b || typeof b !== 'object') throw new BadRequest('body');
  if (b.kind !== 'bpmn' && b.kind !== 'graph') throw new BadRequest('kind');
  if (typeof b.source !== 'string' || !b.source || b.source.length > 10 * 1024 * 1024)
    throw new BadRequest('source');
  if (b.locale !== 'en' && b.locale !== 'ar') throw new BadRequest('locale');
  if (b.format !== 'svg' && b.format !== 'png') throw new BadRequest('format');
  if (
    b.maxWidth !== undefined &&
    !(Number.isInteger(b.maxWidth) && b.maxWidth >= 100 && b.maxWidth <= 6000)
  )
    throw new BadRequest('maxWidth');
  if (b.theme !== undefined && (typeof b.theme !== 'object' || b.theme === null))
    throw new BadRequest('theme');
  return {
    kind: b.kind,
    source: b.source,
    locale: b.locale,
    format: b.format,
    maxWidth: b.maxWidth,
    theme: b.theme,
  };
}

interface RenderResult {
  data: string;
  width: number;
  height: number;
}

async function render(req: RenderBody): Promise<RenderResult> {
  return withContext(async (ctx) => {
    const page = await ctx.newPage();
    await page.goto(`${ORIGIN}/render.html`, { waitUntil: 'load' });
    await page.waitForFunction(
      () => (window as unknown as { phRenderReady?: boolean }).phRenderReady === true,
    );
    return page.evaluate(
      (r) => (window as unknown as { phRender: (x: unknown) => Promise<RenderResult> }).phRender(r),
      req as unknown as Record<string, unknown>,
    );
  });
}

interface PdfBody {
  html: string;
  landscape?: boolean;
  format?: 'A4' | 'A3';
}

function parsePdf(raw: unknown): PdfBody {
  const b = raw as Partial<PdfBody>;
  if (!b || typeof b !== 'object') throw new BadRequest('body');
  if (typeof b.html !== 'string' || !b.html || b.html.length > 15 * 1024 * 1024)
    throw new BadRequest('html');
  if (b.format !== undefined && b.format !== 'A4' && b.format !== 'A3')
    throw new BadRequest('format');
  return { html: b.html, landscape: b.landscape === true, format: b.format ?? 'A4' };
}

let fontLinks: string | null = null;

/** <link> tags of the bundle's CSS (the self-hosted Inter and IBM Plex Sans Arabic fonts). */
async function fontsHead(): Promise<string> {
  if (fontLinks !== null) return fontLinks;
  const manifest = JSON.parse(
    await readFile(join(BUNDLE_DIR, '.vite', 'manifest.json'), 'utf8'),
  ) as Record<string, { css?: string[]; isEntry?: boolean }>;
  const css = Object.values(manifest).flatMap((e) => (e.isEntry ? (e.css ?? []) : []));
  fontLinks = css.map((f) => `<link rel="stylesheet" href="${ORIGIN}/${f}">`).join('');
  return fontLinks;
}

async function pdf(req: PdfBody): Promise<Buffer> {
  const head =
    // Scripts never run in documents printed to PDF.
    `<meta http-equiv="Content-Security-Policy" content="script-src 'none'; object-src 'none'">` +
    (await fontsHead());
  const html = /<head[^>]*>/i.test(req.html)
    ? req.html.replace(/<head[^>]*>/i, (m) => `${m}${head}`)
    : `<!doctype html><html><head>${head}</head><body>${req.html}</body></html>`;
  return withContext(async (ctx) => {
    const page = await ctx.newPage();
    await page.setContent(html, { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    return page.pdf({
      format: req.format,
      landscape: req.landscape,
      printBackground: true,
      margin: { top: '12mm', bottom: '14mm', left: '12mm', right: '12mm' },
    });
  });
}

// ---------- HTTP ----------

class BadRequest extends Error {}

function authorised(req: IncomingMessage): boolean {
  const header = req.headers['x-renderer-token'];
  if (typeof header !== 'string') return false;
  const a = Buffer.from(header);
  const b = Buffer.from(TOKEN);
  return a.length === b.length && timingSafeEqual(a, b);
}

function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY_BYTES) {
        reject(new BadRequest('too large'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new BadRequest('json'));
      }
    });
    req.on('error', reject);
  });
}

function send(
  res: ServerResponse,
  status: number,
  body: string | Buffer,
  type: string,
  extra: Record<string, string> = {},
) {
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store', ...extra });
  res.end(body);
}

const server = createServer((req, res) => {
  void (async () => {
    try {
      if (req.method === 'GET' && req.url === '/health') {
        return send(
          res,
          200,
          JSON.stringify({ status: 'ok', sandbox: sandboxActive, sandboxMode: SANDBOX_MODE }),
          'application/json',
        );
      }
      if (req.method !== 'POST' || (req.url !== '/render' && req.url !== '/pdf')) {
        return send(res, 404, '{"error":"not found"}', 'application/json');
      }
      if (!authorised(req)) return send(res, 401, '{"error":"unauthorised"}', 'application/json');
      const body = await readBody(req);
      if (req.url === '/render') {
        const job = parseRender(body);
        const out = await render(job);
        const dims = { 'x-width': String(out.width), 'x-height': String(out.height) };
        return job.format === 'svg'
          ? send(res, 200, out.data, 'image/svg+xml; charset=utf-8', dims)
          : send(res, 200, Buffer.from(out.data, 'base64'), 'image/png', dims);
      }
      return send(res, 200, await pdf(parsePdf(body)), 'application/pdf');
    } catch (err) {
      if (err instanceof BadRequest) {
        return send(
          res,
          400,
          JSON.stringify({ error: 'bad request', field: err.message }),
          'application/json',
        );
      }
      const message = (err as Error).message ?? 'error';
      console.error(`render failed: ${message.slice(0, 300)}`);
      if (!res.headersSent)
        send(
          res,
          message === 'timeout' ? 504 : 500,
          '{"error":"render failed"}',
          'application/json',
        );
    }
  })();
});
server.requestTimeout = JOB_TIMEOUT_MS + 15000;
server.listen(PORT, () => {
  console.warn(`ProcessHub renderer listening on ${PORT} (sandbox mode ${SANDBOX_MODE})`);
  // Warm-up: starts Chromium now, so /health reports the sandbox state and the first job is fast.
  getBrowser().then(
    () => console.warn(`Chromium started, sandbox ${sandboxActive ? 'on' : 'OFF'}`),
    (err: Error) => console.error(`Chromium could not start: ${err.message.split('\n')[0]}`),
  );
});

const shutdown = () => {
  server.close();
  void (browser?.close() ?? Promise.resolve()).finally(() => process.exit(0));
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
