import { Inject, Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { DiagramTheme, Locale } from '@processhub/shared';
import { APP_CONFIG, type AppConfig } from '../config/config';
import { StorageService } from '../storage/storage.service';
import { streamToBuffer } from '../common/streams';

/** Bump when the renderer bundle changes how diagrams look (invalidates the image cache). */
export const RENDER_CACHE_VERSION = 1;

export interface DiagramRenderInput {
  /** bpmn: BPMN XML; graph: JSON content of a value chain, organisation chart or EPC. */
  kind: 'bpmn' | 'graph';
  source: string;
  locale: Locale;
  format: 'svg' | 'png';
  maxWidth?: number;
  theme?: DiagramTheme;
}

export interface RenderedImage {
  data: Buffer;
  contentType: 'image/svg+xml' | 'image/png';
  width: number;
  height: number;
}

/** Width / height of an SVG (root attributes) or a PNG (IHDR chunk). */
export function imageSize(data: Buffer, format: 'svg' | 'png'): { width: number; height: number } {
  if (format === 'png') {
    if (data.length < 24) return { width: 0, height: 0 };
    return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
  }
  const head = data.subarray(0, 4096).toString('utf8');
  const open = /<svg\b[^>]*>/.exec(head)?.[0] ?? '';
  return {
    width: Number(/\swidth="([\d.]+)"/.exec(open)?.[1] ?? 0),
    height: Number(/\sheight="([\d.]+)"/.exec(open)?.[1] ?? 0),
  };
}

/**
 * Client of the internal renderer container (D-172): diagram images (SVG / PNG) and HTML → PDF.
 * Images are cached in the file storage by a hash of everything that affects them, so a published
 * process version is drawn once per language and format. When the renderer is not configured or
 * fails, callers get `null` and degrade (exports show a note instead of the image).
 */
@Injectable()
export class RendererService {
  private readonly logger = new Logger(RendererService.name);
  /** Small in-memory cache in front of the storage (one export draws the same image twice). */
  private readonly memory = new Map<string, RenderedImage>();

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly storage: StorageService,
  ) {}

  enabled(): boolean {
    return !!this.config.RENDERER_URL && !!this.config.RENDERER_TOKEN;
  }

  cacheKey(input: DiagramRenderInput): string {
    const hash = createHash('sha256')
      .update(
        JSON.stringify([
          RENDER_CACHE_VERSION,
          input.kind,
          input.locale,
          input.format,
          input.maxWidth ?? null,
          input.kind === 'graph' ? (input.theme ?? null) : null,
          input.source,
        ]),
      )
      .digest('hex');
    return `render-cache/${hash}.${input.format}`;
  }

  /** The drawn diagram, or null when the renderer is off or failed (logged). */
  async diagram(input: DiagramRenderInput): Promise<RenderedImage | null> {
    if (!this.enabled() || !input.source) return null;
    const key = this.cacheKey(input);
    const contentType = input.format === 'svg' ? 'image/svg+xml' : 'image/png';
    const hit = this.memory.get(key);
    if (hit) return hit;
    try {
      const data = await streamToBuffer(await this.storage.get(key));
      return this.remember(key, { data, contentType, ...imageSize(data, input.format) });
    } catch {
      /* not cached yet */
    }
    try {
      const res = await this.post('/render', input);
      const data = Buffer.from(await res.arrayBuffer());
      const image = { data, contentType, ...imageSize(data, input.format) } as RenderedImage;
      await this.storage.put(key, data, contentType, { generated: true }).catch((e: Error) => {
        this.logger.warn(`Render cache write failed: ${e.message}`);
      });
      return this.remember(key, image);
    } catch (err) {
      this.logger.warn(`Diagram rendering failed: ${(err as Error).message}`);
      return null;
    }
  }

  /** HTML → PDF (A4 / A3), or null when the renderer is off or failed. */
  async pdf(
    html: string,
    opts: { landscape?: boolean; format?: 'A4' | 'A3' } = {},
  ): Promise<Buffer | null> {
    if (!this.enabled()) return null;
    try {
      const res = await this.post('/pdf', { html, ...opts });
      return Buffer.from(await res.arrayBuffer());
    } catch (err) {
      this.logger.warn(`PDF rendering failed: ${(err as Error).message}`);
      return null;
    }
  }

  /** Whether the renderer answers its health check (Settings → Integrations status). */
  async health(): Promise<'OFF' | 'OK' | 'DOWN'> {
    if (!this.enabled()) return 'OFF';
    try {
      const res = await fetch(`${this.config.RENDERER_URL}/health`, {
        signal: AbortSignal.timeout(3000),
      });
      return res.ok ? 'OK' : 'DOWN';
    } catch {
      return 'DOWN';
    }
  }

  private remember(key: string, image: RenderedImage): RenderedImage {
    this.memory.set(key, image);
    if (this.memory.size > 50) this.memory.delete(this.memory.keys().next().value as string);
    return image;
  }

  // The renderer URL comes from the environment only (not from settings users can change), so
  // the SSRF policy for administrator-configured hosts does not apply here.
  private async post(path: string, body: unknown): Promise<Response> {
    const res = await fetch(`${this.config.RENDERER_URL}${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-renderer-token': this.config.RENDERER_TOKEN,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.config.RENDERER_TIMEOUT_MS),
      redirect: 'error',
    });
    if (!res.ok) throw new Error(`renderer answered ${res.status}`);
    return res;
  }
}
