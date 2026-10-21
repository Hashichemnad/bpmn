import { Logger } from '@nestjs/common';
import type { Request, Response } from 'express';
import type { AiStreamEvent } from '@processhub/shared';
import { AppException } from '../common/app-exception';
import { AiError } from './providers/types';

export interface SseChannel {
  /** Text as the model writes it. */
  delta(text: string): void;
  /** Characters of structured output received so far. */
  progress(chars: number): void;
  /** Aborted when the browser goes away (cancels the provider call). */
  signal: AbortSignal;
}

const logger = new Logger('AiStream');

/**
 * Streams one AI request as Server-Sent Events: `delta` / `progress` while the model works,
 * then one `result` or `error`. Errors carry a code only (translated in the browser); the
 * provider's raw message and the API key never reach the client.
 */
export async function streamSse<T>(
  req: Request,
  res: Response,
  work: (channel: SseChannel) => Promise<T>,
): Promise<void> {
  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  // nginx: do not buffer the stream.
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const controller = new AbortController();
  let closed = false;
  req.on('close', () => {
    if (!res.writableEnded) {
      closed = true;
      controller.abort();
    }
  });
  const send = <E extends AiStreamEvent<T>>(event: E['event'], data: E['data']) => {
    if (closed || res.writableEnded) return;
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };
  // Comment lines keep proxies from closing an idle connection while the model thinks.
  const keepAlive = setInterval(() => !closed && res.write(': keep-alive\n\n'), 15_000);
  let lastProgress = 0;

  try {
    const result = await work({
      delta: (text) => send('delta', { text }),
      progress: (chars) => {
        if (chars - lastProgress < 200) return;
        lastProgress = chars;
        send('progress', { chars });
      },
      signal: controller.signal,
    });
    send('result', result);
  } catch (err) {
    if (err instanceof AiError) {
      send('error', { code: err.code, message: err.code });
    } else if (err instanceof AppException) {
      const body = err.getResponse() as { code: string; message: string; details?: unknown };
      send('error', { code: body.code as never, message: body.message, details: body.details });
    } else {
      logger.error(`AI request failed: ${(err as Error).stack ?? String(err)}`);
      send('error', { code: 'ERROR', message: 'Unexpected error' });
    }
  } finally {
    clearInterval(keepAlive);
    res.end();
  }
}
