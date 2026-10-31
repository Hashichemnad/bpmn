import { analyseLog, type AnalysisRequest } from './analysis';
import { heuristicsMiner, netToStructure, type HeuristicsOptions } from './heuristics';
import { parseBpmnGraph } from '../bpmn-graph';
import type { KpiFrequency, MiningMetric } from '../kpi';
import { miningKpiSeries } from './kpis';
import { checkConformance, type ConformanceRequest } from './conformance';
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
  /** Token-based replay of the log on a BPMN model (activity → element mapping). */
  conformance: (
    input: {
      bytes: Uint8Array;
      bpmnXml: string;
      mapping: Record<string, string | null>;
      request: Partial<ConformanceRequest>;
    },
    progress: ProgressFn,
  ) =>
    checkConformance(
      decodeLogData(input.bytes),
      parseBpmnGraph(input.bpmnXml),
      input.mapping,
      input.request,
      (v) => progress(v, 'replay'),
    ),
  /** Values per period of KPIs calculated from the log. */
  miningKpis: (input: {
    bytes: Uint8Array;
    kpis: { id: string; metric: MiningMetric; frequency: KpiFrequency }[];
    slaByActivity: Record<string, number>;
  }) => {
    const log = decodeLogData(input.bytes);
    return input.kpis.map((k) => ({
      id: k.id,
      values: miningKpiSeries(log, k.metric, k.frequency, input.slaByActivity),
    }));
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
