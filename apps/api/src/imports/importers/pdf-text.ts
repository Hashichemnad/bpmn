import { Worker } from 'node:worker_threads';

/**
 * Text of a PDF per page, extracted with pdf.js (unpdf) in a separate worker thread: no `eval`
 * (`isEvalSupported: false`), a memory limit and a timeout, so a hostile PDF cannot block or
 * exhaust the API process. Resolves `null` when the PDF cannot be read.
 */
export function extractPdfText(data: Buffer, timeoutMs = 30_000): Promise<string[] | null> {
  const unpdf = require.resolve('unpdf');
  const code = `
    const { parentPort, workerData } = require('node:worker_threads');
    (async () => {
      try {
        const { getDocumentProxy, extractText } = require(workerData.unpdf);
        const pdf = await getDocumentProxy(new Uint8Array(workerData.data), {
          isEvalSupported: false,
          useSystemFonts: false,
          disableFontFace: true,
          verbosity: 0,
        });
        const { text } = await extractText(pdf, { mergePages: false });
        parentPort.postMessage({ ok: true, pages: text });
      } catch (e) {
        parentPort.postMessage({ ok: false, error: String((e && e.message) || e) });
      }
    })();
  `;
  return new Promise((resolve) => {
    const worker = new Worker(code, {
      eval: true,
      workerData: { unpdf, data },
      resourceLimits: { maxOldGenerationSizeMb: 256, maxYoungGenerationSizeMb: 64 },
    });
    const timer = setTimeout(() => {
      void worker.terminate();
      resolve(null);
    }, timeoutMs);
    worker.once('message', (m: { ok: boolean; pages?: string[] }) => {
      clearTimeout(timer);
      void worker.terminate();
      resolve(m.ok ? (m.pages ?? []) : null);
    });
    worker.once('error', () => {
      clearTimeout(timer);
      resolve(null);
    });
  });
}
