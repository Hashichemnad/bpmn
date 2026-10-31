import { dirname, join } from 'node:path';
import { Worker } from 'node:worker_threads';
import { runMiningTask, type MiningTaskName } from '@processhub/shared';

/**
 * Runs a CPU-heavy mining task (`runMiningTask` of the shared package) in a worker thread (D-128),
 * so the API keeps answering requests while 1 M events are analysed or a simulation runs. The
 * worker is an inline script that loads the compiled shared package — the same under ts-node, Jest
 * and the production image. Abort terminates the worker.
 */

/** Compiled entry of the shared package (resolved via its package.json, never a TS source mapping). */
const SHARED_ENTRY = join(
  dirname(require.resolve('@processhub/shared/package.json')),
  'dist/index.js',
);

const WORKER_SOURCE = `
const { parentPort, workerData } = require('node:worker_threads');
const shared = require(workerData.entry);
const progress = (value, message) => parentPort.postMessage({ type: 'progress', value, message: message || '' });
Promise.resolve()
  .then(() => shared.runMiningTask(workerData.task, workerData.input, progress))
  .then((result) => parentPort.postMessage({ type: 'done', result }))
  .catch((err) => parentPort.postMessage({ type: 'error', message: String((err && err.message) || err) }));
`;

export class MiningAbortError extends Error {
  constructor() {
    super('CANCELLED');
  }
}

export interface WorkerOptions {
  signal?: AbortSignal;
  onProgress?: (value: number, message: string) => void;
  /** false = run in the calling thread (MINING_WORKERS=false, debugging). */
  useWorker?: boolean;
  /** Heap limit of the worker in MB. */
  maxHeapMb?: number;
}

export async function runInWorker<T>(
  task: MiningTaskName,
  input: unknown,
  opts: WorkerOptions = {},
): Promise<T> {
  if (opts.signal?.aborted) throw new MiningAbortError();
  if (opts.useWorker === false) {
    return (await runMiningTask(task, input as never, (v, m) => {
      if (opts.signal?.aborted) throw new MiningAbortError();
      opts.onProgress?.(v, m ?? '');
    })) as T;
  }
  return new Promise<T>((resolve, reject) => {
    const worker = new Worker(WORKER_SOURCE, {
      eval: true,
      workerData: { entry: SHARED_ENTRY, task, input },
      resourceLimits: { maxOldGenerationSizeMb: opts.maxHeapMb ?? 2048 },
    });
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      opts.signal?.removeEventListener('abort', onAbort);
      fn();
      void worker.terminate();
    };
    const onAbort = () => finish(() => reject(new MiningAbortError()));
    opts.signal?.addEventListener('abort', onAbort);
    worker.on('message', (msg: { type: string; value?: number; message?: string; result?: T }) => {
      if (msg.type === 'progress') opts.onProgress?.(msg.value ?? 0, msg.message ?? '');
      else if (msg.type === 'done') finish(() => resolve(msg.result as T));
      else if (msg.type === 'error') finish(() => reject(new Error(msg.message)));
    });
    worker.on('error', (err) => finish(() => reject(err)));
    worker.on('exit', (code) => {
      if (!settled) finish(() => reject(new Error(`Mining worker stopped (exit code ${code})`)));
    });
  });
}
