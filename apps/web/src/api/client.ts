import { CSRF_COOKIE, CSRF_HEADER, type ApiErrorBody } from '@processhub/shared';

export const API_BASE = '/api/v1';

/** Error thrown for non-2xx responses; `code` is translated via errors.json. */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

function readCookie(name: string): string | null {
  const match = document.cookie.split('; ').find((c) => c.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.slice(name.length + 1)) : null;
}

let csrfPromise: Promise<string> | null = null;

async function csrfToken(): Promise<string> {
  const existing = readCookie(CSRF_COOKIE);
  if (existing) return existing;
  csrfPromise ??= fetch(`${API_BASE}/auth/csrf`, { credentials: 'same-origin' })
    .then((r) => r.json() as Promise<{ csrfToken: string }>)
    .then((b) => b.csrfToken)
    .finally(() => {
      csrfPromise = null;
    });
  return csrfPromise;
}

let refreshPromise: Promise<boolean> | null = null;

/** Single-flight refresh: concurrent 401s share one refresh request. */
function refreshSession(): Promise<boolean> {
  refreshPromise ??= (async () => {
    const res = await fetch(`${API_BASE}/auth/refresh`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { [CSRF_HEADER]: await csrfToken() },
    });
    return res.ok;
  })().finally(() => {
    refreshPromise = null;
  });
  return refreshPromise;
}

type Listener = () => void;
const sessionExpiredListeners = new Set<Listener>();
export function onSessionExpired(fn: Listener): () => void {
  sessionExpiredListeners.add(fn);
  return () => sessionExpiredListeners.delete(fn);
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined | null>;
  /** Skip the automatic refresh-and-retry on 401. */
  noRefresh?: boolean;
  signal?: AbortSignal;
}

function buildUrl(path: string, query?: RequestOptions['query']): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query ?? {})) {
    if (v !== undefined && v !== null && v !== '') params.set(k, String(v));
  }
  const qs = params.toString();
  return `${API_BASE}${path}${qs ? `?${qs}` : ''}`;
}

export async function api<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const method = opts.method ?? 'GET';
  const headers: Record<string, string> = { Accept: 'application/json' };
  let body: BodyInit | undefined;
  if (opts.body instanceof FormData) body = opts.body;
  else if (opts.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(opts.body);
  }
  if (method !== 'GET') headers[CSRF_HEADER] = await csrfToken();

  const res = await fetch(buildUrl(path, opts.query), {
    method,
    headers,
    body,
    credentials: 'same-origin',
    signal: opts.signal,
  });

  if (res.status === 401 && !opts.noRefresh && !path.startsWith('/auth/')) {
    if (await refreshSession()) return api<T>(path, { ...opts, noRefresh: true });
    sessionExpiredListeners.forEach((fn) => fn());
  }
  if (!res.ok) {
    let err: Partial<ApiErrorBody> = {};
    try {
      err = (await res.json()) as ApiErrorBody;
    } catch {
      /* non-JSON error */
    }
    throw new ApiError(res.status, err.code ?? 'ERROR', err.message ?? res.statusText, err.details);
  }
  if (res.status === 204) return undefined as T;
  const type = res.headers.get('content-type') ?? '';
  return (type.includes('application/json') ? res.json() : res.text()) as Promise<T>;
}

/** One Server-Sent Event of a streamed request. */
export interface StreamEvent {
  event: string;
  data: unknown;
}

/**
 * POSTs JSON and reads a Server-Sent Events response (AI requests). Errors before the stream
 * starts (403, 429, …) are thrown as ApiError like `api()`; events are passed to `onEvent`.
 */
export async function apiStream(
  path: string,
  body: unknown,
  onEvent: (e: StreamEvent) => void,
  signal?: AbortSignal,
  retried = false,
): Promise<void> {
  const res = await fetch(buildUrl(path), {
    method: 'POST',
    headers: {
      Accept: 'text/event-stream',
      'Content-Type': 'application/json',
      [CSRF_HEADER]: await csrfToken(),
    },
    body: JSON.stringify(body),
    credentials: 'same-origin',
    signal,
  });
  if (res.status === 401 && !retried) {
    if (await refreshSession()) return apiStream(path, body, onEvent, signal, true);
    sessionExpiredListeners.forEach((fn) => fn());
  }
  if (!res.ok || !res.body) {
    let err: Partial<ApiErrorBody> = {};
    try {
      err = (await res.json()) as ApiErrorBody;
    } catch {
      /* non-JSON error */
    }
    throw new ApiError(res.status, err.code ?? 'ERROR', err.message ?? res.statusText, err.details);
  }
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    let end: number;
    while ((end = buffer.indexOf('\n\n')) >= 0) {
      const block = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      let event = 'message';
      const data: string[] = [];
      for (const line of block.split('\n')) {
        if (line.startsWith('event: ')) event = line.slice(7);
        else if (line.startsWith('data: ')) data.push(line.slice(6));
      }
      if (data.length) onEvent({ event, data: JSON.parse(data.join('\n')) });
    }
  }
}

/** A file returned by the API (reports and exports). */
export interface DownloadedFile {
  blob: Blob;
  fileName: string;
}

/** File name from `Content-Disposition` (RFC 5987 `filename*` first). */
export function dispositionFileName(header: string | null, fallback: string): string {
  const star = /filename\*=UTF-8''([^;]+)/i.exec(header ?? '')?.[1];
  if (star) {
    try {
      return decodeURIComponent(star);
    } catch {
      /* malformed: use the fallback */
    }
  }
  return /filename="([^"]+)"/i.exec(header ?? '')?.[1] ?? fallback;
}

/** Like `api()`, but returns the response body as a file (with its name). */
export async function apiDownload(
  path: string,
  opts: RequestOptions = {},
  fallbackName = 'download',
): Promise<DownloadedFile> {
  const method = opts.method ?? 'GET';
  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  if (method !== 'GET') headers[CSRF_HEADER] = await csrfToken();
  const res = await fetch(buildUrl(path, opts.query), {
    method,
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    credentials: 'same-origin',
    signal: opts.signal,
  });
  if (res.status === 401 && !opts.noRefresh) {
    if (await refreshSession())
      return apiDownload(path, { ...opts, noRefresh: true }, fallbackName);
    sessionExpiredListeners.forEach((fn) => fn());
  }
  if (!res.ok) {
    let err: Partial<ApiErrorBody> = {};
    try {
      err = (await res.json()) as ApiErrorBody;
    } catch {
      /* non-JSON error */
    }
    throw new ApiError(res.status, err.code ?? 'ERROR', err.message ?? res.statusText, err.details);
  }
  return {
    blob: await res.blob(),
    fileName: dispositionFileName(res.headers.get('content-disposition'), fallbackName),
  };
}
