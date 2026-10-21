import { useCallback, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { aiKeys, runAi, useAiStatus } from '@/api/ai';
import { useAuth } from '@/auth/AuthProvider';

/** The assistant's availability for the current user; every ✨ AI entry point checks it. */
export function useAi() {
  const { user } = useAuth();
  const status = useAiStatus(!!user);
  return { available: !!status.data?.available, status: status.data };
}

/**
 * State of one streamed AI request: running, characters received (structured output), streamed
 * text (free text), error. Starting a new request cancels the previous one.
 */
export function useAiRun<T>() {
  const qc = useQueryClient();
  const [running, setRunning] = useState(false);
  const [chars, setChars] = useState(0);
  const [text, setText] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [result, setResult] = useState<T | null>(null);
  const controller = useRef<AbortController | null>(null);

  const run = useCallback(
    async (path: string, body: unknown): Promise<T | null> => {
      controller.current?.abort();
      const ctrl = new AbortController();
      controller.current = ctrl;
      setRunning(true);
      setChars(0);
      setText('');
      setError(null);
      setResult(null);
      try {
        const res = await runAi<T>(path, body, {
          signal: ctrl.signal,
          onProgress: setChars,
          onDelta: (d) => setText((prev) => prev + d),
        });
        if (ctrl.signal.aborted) return null;
        setResult(res);
        return res;
      } catch (err) {
        if (!ctrl.signal.aborted) setError(err);
        return null;
      } finally {
        if (controller.current === ctrl) {
          setRunning(false);
          controller.current = null;
        }
        // The daily counter changed.
        void qc.invalidateQueries({ queryKey: aiKeys.status });
      }
    },
    [qc],
  );

  const cancel = useCallback(() => {
    controller.current?.abort();
    controller.current = null;
    setRunning(false);
  }, []);

  const reset = useCallback(() => {
    cancel();
    setText('');
    setError(null);
    setResult(null);
    setChars(0);
  }, [cancel]);

  return { run, cancel, reset, running, chars, text, error, result, setResult };
}
