import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Readable } from 'node:stream';
import { loadConfig } from '../config/config';
import type { StorageService } from '../storage/storage.service';
import { RendererService, imageSize } from './renderer.service';

class Memory {
  files = new Map<string, Buffer>();
  async put(k: string, d: Buffer) {
    this.files.set(k, d);
  }
  async get(k: string) {
    const f = this.files.get(k);
    if (!f) throw new Error('missing');
    return Readable.from(f);
  }
}

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="200"></svg>';

describe('RendererService (client of the renderer container)', () => {
  let server: Server;
  let url: string;
  const calls: { path: string; token: string | undefined; body: Record<string, unknown> }[] = [];

  beforeAll(async () => {
    server = createServer((req, res) => {
      let raw = '';
      req.on('data', (c: Buffer) => (raw += c.toString()));
      req.on('end', () => {
        calls.push({
          path: req.url ?? '',
          token: req.headers['x-renderer-token'] as string | undefined,
          body: JSON.parse(raw || '{}') as Record<string, unknown>,
        });
        if (req.headers['x-renderer-token'] !== 'renderer-token-123456') {
          res.writeHead(401).end();
        } else if (req.url === '/render') {
          res.writeHead(200, { 'content-type': 'image/svg+xml' }).end(SVG);
        } else if (req.url === '/pdf') {
          res.writeHead(200, { 'content-type': 'application/pdf' }).end('%PDF-1.7');
        } else res.writeHead(404).end();
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise((r) => server.close(r)));

  const make = (env: Record<string, string>, storage = new Memory()) =>
    new RendererService(
      loadConfig({
        DATABASE_URL: 'postgresql://x',
        JWT_ACCESS_SECRET: 'x'.repeat(40),
        ...env,
      }),
      storage as unknown as StorageService,
    );

  it('is off without URL / token and returns null', async () => {
    const r = make({});
    expect(r.enabled()).toBe(false);
    expect(await r.diagram({ kind: 'bpmn', source: '<x/>', locale: 'en', format: 'svg' })).toBe(
      null,
    );
    expect(await r.pdf('<p>x</p>')).toBe(null);
    expect(await r.health()).toBe('OFF');
  });

  it('renders once per input and serves the cache afterwards', async () => {
    const storage = new Memory();
    const r = make({ RENDERER_URL: `${url}/`, RENDERER_TOKEN: 'renderer-token-123456' }, storage);
    calls.length = 0;
    const input = {
      kind: 'bpmn' as const,
      source: '<defs/>',
      locale: 'ar' as const,
      format: 'svg' as const,
    };
    const first = await r.diagram(input);
    expect(first).toMatchObject({ width: 320, height: 200, contentType: 'image/svg+xml' });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ path: '/render', token: 'renderer-token-123456' });
    expect(calls[0].body).toMatchObject({ kind: 'bpmn', locale: 'ar', format: 'svg' });
    expect(storage.files.size).toBe(1);
    // Fresh service, same storage: served from the stored cache, no second call.
    const again = make({ RENDERER_URL: url, RENDERER_TOKEN: 'renderer-token-123456' }, storage);
    expect((await again.diagram(input))?.data.toString()).toBe(SVG);
    expect(calls).toHaveLength(1);
    // Another language is another image.
    expect(r.cacheKey(input)).not.toBe(r.cacheKey({ ...input, locale: 'en' }));
  });

  it('returns null when the renderer refuses (wrong token) and prints PDFs', async () => {
    const wrong = make({ RENDERER_URL: url, RENDERER_TOKEN: 'another-token-1234567' });
    expect(await wrong.diagram({ kind: 'bpmn', source: 'a', locale: 'en', format: 'png' })).toBe(
      null,
    );
    const ok = make({ RENDERER_URL: url, RENDERER_TOKEN: 'renderer-token-123456' });
    expect((await ok.pdf('<p>hi</p>', { landscape: true }))?.toString()).toBe('%PDF-1.7');
    expect(await ok.health()).toBe('DOWN'); // the fake has no /health
  });

  it('reads PNG and SVG sizes', () => {
    const png = Buffer.alloc(24);
    png.writeUInt32BE(640, 16);
    png.writeUInt32BE(480, 20);
    expect(imageSize(png, 'png')).toEqual({ width: 640, height: 480 });
    expect(imageSize(Buffer.from(SVG), 'svg')).toEqual({ width: 320, height: 200 });
  });
});
