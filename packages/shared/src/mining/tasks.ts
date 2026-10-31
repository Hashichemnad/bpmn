import { analyseLog, type AnalysisRequest } from './analysis';
import { heuristicsMiner, netToStructure, type HeuristicsOptions } from './heuristics';
import { decodeLogData, encodeLogData, sortRawLog, summariseLog, type RawLog } from './log-data';

/**
 * CPU-heavy mining work run in worker threads by the API (D-128). Every task takes a structured
 * clone-able input and a progress callback and returns a structured clone-able result. New
 * analyses register here, so the worker script never changes.
 */
export type ProgressFn = (value: number, message?: string) => void;

const TASKS = {
  /** Sorts the events of an import; returns the binary snapshot and the counts. */
  prepareLog: (input: { raw: RawLog }) => {
    const log = sortRawLog(input.raw);
    return { bytes: encodeLogData(log), summary: summariseLog(log) };
  },
  /** Map, variants, statistics, bottlenecks of the filtered log. */
  analyse: (
    input: { bytes: Uint8Array; request: Partial<AnalysisRequest> },
    progress: ProgressFn,
  ) => analyseLog(decodeLogData(input.bytes), input.request, (v) => progress(v, 'analyse')),
  /** Heuristics miner and the BPMN structure of the net. */
  discover: (input: { bytes: Uint8Array; options: Partial<HeuristicsOptions> }) => {
    const net = heuristicsMiner(decodeLogData(input.bytes), input.options);
    return { net, structure: netToStructure(net) };
  },
  /** Health check of the worker set-up. */
  ping: (input: { bytes?: Uint8Array }) => ({
    ok: true,
    events: input.bytes ? decodeLogData(input.bytes).act.length : 0,
  }),
} satisfies Record<string, (input: never, progress: ProgressFn) => unknown>;

export type MiningTaskName = keyof typeof TASKS;
export type MiningTaskInput<K extends MiningTaskName> = Parameters<(typeof TASKS)[K]>[0];
export type MiningTaskResult<K extends MiningTaskName> = Awaited<ReturnType<(typeof TASKS)[K]>>;

export function runMiningTask<K extends MiningTaskName>(
  task: K,
  input: MiningTaskInput<K>,
  progress: ProgressFn,
): MiningTaskResult<K> | Promise<MiningTaskResult<K>> {
  const fn = TASKS[task] as unknown as (i: unknown, p: ProgressFn) => MiningTaskResult<K>;
  if (!fn) throw new Error(`Unknown mining task ${String(task)}`);
  return fn(input, progress);
}
