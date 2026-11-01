import type { ClientRequest } from 'node:http';

/**
 * Overall deadline of an outbound request (final session part B, SEC-41). The `timeout` option of
 * http.request only fires when the socket is idle: a server that trickles one byte every few
 * seconds would keep the request (and a webhook / sync worker) busy until the size limit. The
 * deadline ends the request regardless.
 */
export function withDeadline(req: ClientRequest, ms: number): ClientRequest {
  const timer = setTimeout(() => req.destroy(new Error('timeout')), ms);
  timer.unref();
  req.once('close', () => clearTimeout(timer));
  return req;
}
