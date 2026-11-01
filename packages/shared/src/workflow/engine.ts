import { evaluateFeel, toFeel } from './feel';
import {
  isApprovalNode,
  type ApprovalOutcome,
  type WfFlow,
  type WfNode,
  type WorkflowModel,
} from './model';

/**
 * The workflow engine (D-144): a pure, synchronous function from (model, state, variables, command) to
 * a new state, new variables and a list of effects. The API runs it inside one database transaction and
 * turns the effects into rows (tasks, timer jobs, notifications, timeline events). No I/O here.
 *
 * Tokens: READY (being moved), WAITING (user task, timer, asynchronous step, called process), JOIN
 * (arrived at a parallel / inclusive join), FAILED (incident: needs a retry).
 */

export type TokenStatus = 'READY' | 'WAITING' | 'JOIN' | 'FAILED';
export interface Token {
  id: string;
  nodeId: string;
  status: TokenStatus;
  /** Flow the token arrived by (joins). */
  via: string | null;
  incident?: { code: string; message: string } | null;
}

export interface CaseState {
  tokens: Token[];
  seq: number;
}

export type EndKind = 'NORMAL' | 'TERMINATE' | 'ERROR';

export type EngineCommand =
  | { type: 'START'; startNodeId: string }
  | { type: 'COMPLETE_TASK'; tokenId: string; decision?: ApprovalOutcome | null }
  | { type: 'TIMER_FIRED'; tokenId: string; nodeId: string }
  | { type: 'JOB_DONE'; tokenId: string; variables?: Record<string, unknown> }
  | { type: 'JOB_FAILED'; tokenId: string; code: string; message: string }
  | {
      type: 'CHILD_COMPLETED';
      tokenId: string;
      endKind: EndKind;
      errorCode?: string | null;
      variables?: Record<string, unknown>;
    }
  | { type: 'RETRY'; tokenId: string };

export type EngineEffect =
  | { type: 'CREATE_TASK'; tokenId: string; nodeId: string }
  | { type: 'CANCEL_TASK'; tokenId: string }
  | {
      type: 'SCHEDULE_TIMER';
      /** Token waiting at the timer (intermediate) or at the host activity (boundary). */
      tokenId: string;
      nodeId: string;
    }
  | { type: 'CANCEL_TIMERS'; tokenId: string }
  | { type: 'RUN_JOB'; tokenId: string; nodeId: string; kind: 'DOCUMENT' | 'CALL' }
  | { type: 'CANCEL_CHILD'; tokenId: string }
  | { type: 'NOTIFY'; tokenId: string; nodeId: string }
  | { type: 'INCIDENT'; tokenId: string; nodeId: string; code: string; message: string }
  | { type: 'ACTIVITY'; phase: 'START' | 'END' | 'CANCEL'; tokenId: string; nodeId: string }
  | { type: 'FLOW'; flowId: string }
  | { type: 'CASE_ENDED'; kind: EndKind; errorCode: string | null; nodeId: string | null };

export interface EngineServices {
  /** Business rule task: evaluate the linked decision; throws on failure. */
  decide?(node: WfNode, vars: Record<string, unknown>): Record<string, unknown>;
}

export interface EngineStepResult {
  state: CaseState;
  vars: Record<string, unknown>;
  effects: EngineEffect[];
  ended: { kind: EndKind; errorCode: string | null } | null;
}

/** Largest serialised size of a case's variables (final session part B, SEC-28). */
export const MAX_VARIABLES_BYTES = 1_000_000;
const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * Copies values into the case variables: object internals are never used as names (SEC-33) and the
 * result must stay within MAX_VARIABLES_BYTES, otherwise the step fails (incident) and nothing is
 * changed.
 */
export function assignVariables(target: Record<string, unknown>, values: Record<string, unknown>) {
  const merged: Record<string, unknown> = { ...target };
  for (const [k, v] of Object.entries(values)) if (!UNSAFE_KEYS.has(k)) merged[k] = v;
  if (JSON.stringify(merged).length > MAX_VARIABLES_BYTES)
    throw Object.assign(new Error('Case variables exceed the size limit'), {
      code: 'VARIABLES_TOO_LARGE',
    });
  for (const [k, v] of Object.entries(values)) if (!UNSAFE_KEYS.has(k)) target[k] = v;
}

export class EngineError extends Error {
  constructor(
    public readonly code:
      'TOKEN_NOT_FOUND' | 'TOKEN_NOT_WAITING' | 'UNKNOWN_NODE' | 'CASE_ENDED' | 'INVALID_COMMAND',
    message: string,
  ) {
    super(message);
    this.name = 'EngineError';
  }
}

export const EMPTY_STATE: CaseState = { tokens: [], seq: 0 };
const MAX_STEPS = 5000;

/** Elements the engine waits at until something external happens. */
const WAIT_ACTIVITIES = new Set(['userTask', 'callActivity']);

class Run {
  state: CaseState;
  vars: Record<string, unknown>;
  effects: EngineEffect[] = [];
  queue: Token[] = [];
  ended: EngineStepResult['ended'] = null;
  steps = 0;
  private reach = new Map<string, Set<string>>();

  constructor(
    private readonly model: WorkflowModel,
    state: CaseState,
    vars: Record<string, unknown>,
    private readonly services: EngineServices,
  ) {
    this.state = { tokens: state.tokens.map((t) => ({ ...t })), seq: state.seq };
    this.vars = { ...vars };
  }

  node(id: string): WfNode {
    const n = this.model.nodes[id];
    if (!n) throw new EngineError('UNKNOWN_NODE', `Unknown element ${id}`);
    return n;
  }
  flow(id: string): WfFlow {
    return this.model.flows[id];
  }
  newToken(nodeId: string, via: string | null): Token {
    const t: Token = { id: `t${++this.state.seq}`, nodeId, status: 'READY', via };
    this.state.tokens.push(t);
    return t;
  }
  token(id: string): Token {
    const t = this.state.tokens.find((x) => x.id === id);
    if (!t) throw new EngineError('TOKEN_NOT_FOUND', `Token ${id} not found`);
    return t;
  }
  remove(t: Token) {
    this.state.tokens = this.state.tokens.filter((x) => x !== t);
  }
  effect(e: EngineEffect) {
    this.effects.push(e);
  }

  // ---------- Driving ----------

  drain() {
    for (;;) {
      while (this.queue.length) {
        if (this.ended) return;
        if (++this.steps > MAX_STEPS) {
          const t = this.queue.shift()!;
          this.fail(t, 'LOOP', 'Too many steps without waiting (endless loop?)');
          this.queue = [];
          return;
        }
        const t = this.queue.shift()!;
        if (!this.state.tokens.includes(t) || t.status !== 'READY') continue;
        this.arrive(t);
      }
      if (this.ended) return;
      if (!this.fireInclusiveJoins()) break;
    }
    if (!this.ended && this.state.tokens.length === 0) this.endCase('NORMAL', null, null);
  }

  arrive(t: Token) {
    const n = this.node(t.nodeId);
    switch (n.type) {
      case 'startEvent':
        return this.leave(t, n);
      case 'intermediateThrowEvent':
        return this.leave(t, n);
      case 'endEvent':
        return this.end(t, n);
      case 'intermediateCatchEvent':
        if (n.eventKind === 'timer') {
          t.status = 'WAITING';
          this.effect({ type: 'SCHEDULE_TIMER', tokenId: t.id, nodeId: n.id });
          return;
        }
        return this.leave(t, n);
      case 'userTask':
        t.status = 'WAITING';
        this.effect({ type: 'ACTIVITY', phase: 'START', tokenId: t.id, nodeId: n.id });
        this.effect({ type: 'CREATE_TASK', tokenId: t.id, nodeId: n.id });
        this.armBoundaryTimers(t, n);
        return;
      case 'callActivity':
        t.status = 'WAITING';
        this.effect({ type: 'ACTIVITY', phase: 'START', tokenId: t.id, nodeId: n.id });
        this.effect({ type: 'RUN_JOB', tokenId: t.id, nodeId: n.id, kind: 'CALL' });
        this.armBoundaryTimers(t, n);
        return;
      case 'businessRuleTask':
        return this.runBusinessRule(t, n);
      case 'sendTask':
        this.effect({ type: 'ACTIVITY', phase: 'START', tokenId: t.id, nodeId: n.id });
        this.effect({ type: 'NOTIFY', tokenId: t.id, nodeId: n.id });
        this.effect({ type: 'ACTIVITY', phase: 'END', tokenId: t.id, nodeId: n.id });
        return this.leave(t, n);
      case 'serviceTask':
        return this.runService(t, n);
      case 'exclusiveGateway':
        return this.leave(t, n);
      case 'parallelGateway':
      case 'inclusiveGateway':
        if (n.incoming.length > 1) {
          t.status = 'JOIN';
          if (n.type === 'parallelGateway') this.tryParallelJoin(n);
          return;
        }
        return this.leave(t, n);
      default:
        return this.fail(t, 'UNSUPPORTED', `Element type ${n.type} cannot be executed`);
    }
  }

  runBusinessRule(t: Token, n: WfNode) {
    this.effect({ type: 'ACTIVITY', phase: 'START', tokenId: t.id, nodeId: n.id });
    try {
      if (!this.services.decide) throw new Error('No decision service');
      const out = this.services.decide(n, this.vars);
      assignVariables(this.vars, out);
    } catch (e) {
      const err = e as { code?: string; message?: string };
      return this.throwError(t, n, err.code ?? 'DECISION_FAILED', err.message ?? String(e), true);
    }
    this.effect({ type: 'ACTIVITY', phase: 'END', tokenId: t.id, nodeId: n.id });
    this.leave(t, n);
  }

  runService(t: Token, n: WfNode) {
    this.effect({ type: 'ACTIVITY', phase: 'START', tokenId: t.id, nodeId: n.id });
    if (n.exec.kind === 'SET_DATA') {
      try {
        // Evaluated on a copy; the case variables change only when the result stays within the size
        // limit (SEC-28), so an incident never stores an oversized value.
        const next: Record<string, unknown> = { ...this.vars };
        for (const a of n.exec.set)
          assignVariables(next, { [a.key]: evaluateFeel(a.expression, next) });
        assignVariables(this.vars, next);
      } catch (e) {
        return this.throwError(t, n, 'SET_DATA_FAILED', (e as Error).message, true);
      }
      this.effect({ type: 'ACTIVITY', phase: 'END', tokenId: t.id, nodeId: n.id });
      return this.leave(t, n);
    }
    if (n.exec.kind === 'GENERATE_DOCUMENT') {
      t.status = 'WAITING';
      this.effect({ type: 'RUN_JOB', tokenId: t.id, nodeId: n.id, kind: 'DOCUMENT' });
      this.armBoundaryTimers(t, n);
      return;
    }
    this.fail(t, 'UNSUPPORTED', `Service task ${n.id} has no kind`);
  }

  armBoundaryTimers(t: Token, n: WfNode) {
    for (const b of this.model.boundaries[n.id] ?? []) {
      const bn = this.node(b);
      if (bn.eventKind === 'timer')
        this.effect({ type: 'SCHEDULE_TIMER', tokenId: t.id, nodeId: b });
    }
  }

  /** Leaves an activity / event / gateway along its outgoing flows. */
  leave(t: Token, n: WfNode, decision?: ApprovalOutcome | null) {
    const flows = this.chooseFlows(t, n, decision);
    if (flows === null) return;
    if (!flows.length) {
      // Nothing to follow: the token ends here (implicit end).
      this.remove(t);
      return;
    }
    flows.forEach((f, i) => {
      this.effect({ type: 'FLOW', flowId: f.id });
      const target = f.to;
      if (i === 0) {
        t.nodeId = target;
        t.via = f.id;
        t.status = 'READY';
        this.queue.push(t);
      } else this.queue.push(this.newToken(target, f.id));
    });
  }

  cond(f: WfFlow): boolean {
    if (!f.condition) return true;
    try {
      return evaluateFeel(f.condition, this.vars) === true;
    } catch {
      return false;
    }
  }

  /** Flows to follow, [] for none (implicit end), null after an incident. */
  chooseFlows(t: Token, n: WfNode, decision?: ApprovalOutcome | null): WfFlow[] | null {
    const out = n.outgoing.map((id) => this.flow(id)).filter(Boolean);
    if (!out.length) return [];
    const def = n.defaultFlow ? out.find((f) => f.id === n.defaultFlow) : undefined;
    const rest = out.filter((f) => f !== def);
    if (n.type === 'parallelGateway') return out;
    if (n.type === 'exclusiveGateway') {
      const hit = rest.find((f) => this.cond(f));
      if (hit) return [hit];
      if (def) return [def];
      this.fail(
        t,
        'NO_PATH',
        `No condition of gateway ${n.id} is true and there is no default flow`,
      );
      return null;
    }
    if (n.type === 'inclusiveGateway') {
      const hits = rest.filter((f) => this.cond(f));
      if (hits.length) return hits;
      if (def) return [def];
      this.fail(
        t,
        'NO_PATH',
        `No condition of gateway ${n.id} is true and there is no default flow`,
      );
      return null;
    }
    // Activities and events: approval outcomes, then conditional / unconditional flows.
    if (isApprovalNode(n) && out.some((f) => f.exec.outcome)) {
      const byOutcome = out.filter((f) => f.exec.outcome && f.exec.outcome === decision);
      if (byOutcome.length) return byOutcome;
      const unmarked = out.filter((f) => !f.exec.outcome);
      if (unmarked.length) return unmarked;
      this.fail(t, 'NO_PATH', `No flow of ${n.id} is mapped to the decision ${decision ?? '—'}`);
      return null;
    }
    const hits = rest.filter((f) => this.cond(f));
    if (hits.length) return hits;
    if (def) return [def];
    this.fail(t, 'NO_PATH', `No outgoing flow of ${n.id} can be taken`);
    return null;
  }

  end(t: Token, n: WfNode) {
    this.remove(t);
    if (n.eventKind === 'terminate') return this.terminate('TERMINATE', null, n.id);
    if (n.eventKind === 'error') return this.terminate('ERROR', n.errorCode, n.id);
  }

  /** Ends the case now: every other token is removed and its work cancelled. */
  terminate(kind: EndKind, errorCode: string | null, nodeId: string | null) {
    for (const o of [...this.state.tokens]) this.cancelToken(o);
    this.endCase(kind, errorCode, nodeId);
  }

  endCase(kind: EndKind, errorCode: string | null, nodeId: string | null) {
    if (this.ended) return;
    this.ended = { kind, errorCode };
    this.queue = [];
    this.effect({ type: 'CASE_ENDED', kind, errorCode, nodeId });
  }

  cancelToken(o: Token) {
    const n = this.model.nodes[o.nodeId];
    if (o.status === 'WAITING' && n) {
      if (n.type === 'userTask') this.effect({ type: 'CANCEL_TASK', tokenId: o.id });
      if (n.type === 'callActivity') this.effect({ type: 'CANCEL_CHILD', tokenId: o.id });
      this.effect({ type: 'CANCEL_TIMERS', tokenId: o.id });
      if (WAIT_ACTIVITIES.has(n.type) || n.type === 'serviceTask')
        this.effect({ type: 'ACTIVITY', phase: 'CANCEL', tokenId: o.id, nodeId: n.id });
    }
    this.remove(o);
  }

  /**
   * An error at a step: an error boundary event of the step catches it (matching error code, or any
   * code when the boundary has none); otherwise a technical error becomes an incident and a modelled
   * error (error end event of a called process) ends this case with the same error.
   */
  throwError(t: Token, n: WfNode, code: string, message: string, technical: boolean) {
    const handler = (this.model.boundaries[n.id] ?? [])
      .map((b) => this.node(b))
      .find((b) => b.eventKind === 'error' && (!b.errorCode || b.errorCode === code));
    if (handler) {
      if (t.status === 'WAITING') this.effect({ type: 'CANCEL_TIMERS', tokenId: t.id });
      this.effect({ type: 'ACTIVITY', phase: 'CANCEL', tokenId: t.id, nodeId: n.id });
      this.vars.error = { code, message: message.slice(0, 500) };
      t.nodeId = handler.id;
      t.via = null;
      t.incident = null;
      t.status = 'READY';
      return this.leave(t, handler);
    }
    if (technical) return this.fail(t, code, message);
    this.remove(t);
    this.terminate('ERROR', code, n.id);
  }

  fail(t: Token, code: string, message: string) {
    t.status = 'FAILED';
    t.incident = { code, message: message.slice(0, 1000) };
    this.effect({
      type: 'INCIDENT',
      tokenId: t.id,
      nodeId: t.nodeId,
      code,
      message: t.incident.message,
    });
  }

  // ---------- Joins ----------

  tryParallelJoin(n: WfNode) {
    const waiting = this.state.tokens.filter((x) => x.nodeId === n.id && x.status === 'JOIN');
    const byFlow = new Map<string, Token>();
    for (const w of waiting) if (w.via && !byFlow.has(w.via)) byFlow.set(w.via, w);
    if (!n.incoming.every((f) => byFlow.has(f))) return;
    const [keep, ...drop] = n.incoming.map((f) => byFlow.get(f)!);
    for (const d of drop) this.remove(d);
    keep.status = 'READY';
    this.leave(keep, n);
  }

  /** Nodes reachable from `from` (excluding paths through `stopAt`). */
  reachable(from: string, stopAt: string): Set<string> {
    const key = `${from}>${stopAt}`;
    const hit = this.reach.get(key);
    if (hit) return hit;
    const seen = new Set<string>();
    const stack = [from];
    while (stack.length) {
      const id = stack.pop()!;
      const n = this.model.nodes[id];
      if (!n) continue;
      const nexts = [
        ...n.outgoing.map((f) => this.model.flows[f]?.to),
        ...(this.model.boundaries[id] ?? []),
      ];
      for (const nx of nexts) {
        if (!nx || seen.has(nx)) continue;
        seen.add(nx);
        if (nx !== stopAt) stack.push(nx);
      }
    }
    this.reach.set(key, seen);
    return seen;
  }

  /** Inclusive joins fire when no other token can still reach them. */
  fireInclusiveJoins(): boolean {
    let fired = false;
    const joins = new Set(
      this.state.tokens
        .filter(
          (x) => x.status === 'JOIN' && this.model.nodes[x.nodeId]?.type === 'inclusiveGateway',
        )
        .map((x) => x.nodeId),
    );
    for (const id of joins) {
      const others = this.state.tokens.filter((x) => !(x.nodeId === id && x.status === 'JOIN'));
      if (others.some((o) => o.nodeId === id || this.reachable(o.nodeId, id).has(id))) continue;
      const [keep, ...drop] = this.state.tokens.filter(
        (x) => x.nodeId === id && x.status === 'JOIN',
      );
      for (const d of drop) this.remove(d);
      keep.status = 'READY';
      this.leave(keep, this.node(id));
      fired = true;
    }
    return fired;
  }

  // ---------- Commands ----------

  waiting(tokenId: string, types: string[]): { t: Token; n: WfNode } {
    const t = this.token(tokenId);
    const n = this.node(t.nodeId);
    if (t.status !== 'WAITING' || !types.includes(n.type))
      throw new EngineError(
        'TOKEN_NOT_WAITING',
        `Token ${tokenId} is not waiting at a ${types.join('/')}`,
      );
    return { t, n };
  }

  run(cmd: EngineCommand) {
    switch (cmd.type) {
      case 'START': {
        const n = this.node(cmd.startNodeId);
        if (n.type !== 'startEvent') throw new EngineError('INVALID_COMMAND', 'Not a start event');
        this.queue.push(this.newToken(n.id, null));
        break;
      }
      case 'COMPLETE_TASK': {
        const { t, n } = this.waiting(cmd.tokenId, ['userTask']);
        if (isApprovalNode(n)) this.vars.decision = cmd.decision ?? 'APPROVE';
        this.effect({ type: 'CANCEL_TIMERS', tokenId: t.id });
        this.effect({ type: 'ACTIVITY', phase: 'END', tokenId: t.id, nodeId: n.id });
        t.status = 'READY';
        this.leave(t, n, isApprovalNode(n) ? (cmd.decision ?? 'APPROVE') : null);
        break;
      }
      case 'TIMER_FIRED': {
        const t = this.state.tokens.find((x) => x.id === cmd.tokenId);
        // Idempotent: the token moved on (task completed, timer already fired) → nothing to do.
        if (!t || t.status !== 'WAITING') return;
        const timerNode = this.node(cmd.nodeId);
        if (timerNode.type === 'intermediateCatchEvent') {
          if (t.nodeId !== timerNode.id) return;
          t.status = 'READY';
          this.leave(t, timerNode);
          break;
        }
        if (timerNode.type === 'boundaryEvent') {
          if (timerNode.attachedTo !== t.nodeId) return;
          const host = this.node(t.nodeId);
          if (timerNode.cancelActivity) {
            if (host.type === 'userTask') this.effect({ type: 'CANCEL_TASK', tokenId: t.id });
            if (host.type === 'callActivity') this.effect({ type: 'CANCEL_CHILD', tokenId: t.id });
            this.effect({ type: 'CANCEL_TIMERS', tokenId: t.id });
            this.effect({ type: 'ACTIVITY', phase: 'CANCEL', tokenId: t.id, nodeId: host.id });
            t.nodeId = timerNode.id;
            t.via = null;
            t.status = 'READY';
            this.leave(t, timerNode);
          } else {
            const nt = this.newToken(timerNode.id, null);
            this.leave(nt, timerNode);
          }
          break;
        }
        throw new EngineError('INVALID_COMMAND', `${cmd.nodeId} is not a timer event`);
      }
      case 'JOB_DONE': {
        const { t, n } = this.waiting(cmd.tokenId, ['serviceTask']);
        Object.assign(this.vars, cmd.variables ?? {});
        this.effect({ type: 'CANCEL_TIMERS', tokenId: t.id });
        this.effect({ type: 'ACTIVITY', phase: 'END', tokenId: t.id, nodeId: n.id });
        t.status = 'READY';
        this.leave(t, n);
        break;
      }
      case 'JOB_FAILED': {
        const { t, n } = this.waiting(cmd.tokenId, ['serviceTask', 'callActivity']);
        this.throwError(t, n, cmd.code, cmd.message, true);
        break;
      }
      case 'CHILD_COMPLETED': {
        const { t, n } = this.waiting(cmd.tokenId, ['callActivity']);
        this.effect({ type: 'CANCEL_TIMERS', tokenId: t.id });
        if (cmd.endKind === 'ERROR') {
          this.throwError(
            t,
            n,
            cmd.errorCode ?? 'ERROR',
            `Called process ended with an error`,
            false,
          );
          break;
        }
        Object.assign(this.vars, cmd.variables ?? {});
        this.effect({ type: 'ACTIVITY', phase: 'END', tokenId: t.id, nodeId: n.id });
        t.status = 'READY';
        this.leave(t, n);
        break;
      }
      case 'RETRY': {
        const t = this.token(cmd.tokenId);
        if (t.status !== 'FAILED')
          throw new EngineError('TOKEN_NOT_WAITING', 'Token has no incident');
        t.incident = null;
        t.status = 'READY';
        this.queue.push(t);
        break;
      }
    }
    this.drain();
  }
}

/** Runs one command. Throws `EngineError` for commands that do not fit the state. */
export function step(
  model: WorkflowModel,
  state: CaseState,
  vars: Record<string, unknown>,
  command: EngineCommand,
  services: EngineServices = {},
): EngineStepResult {
  const r = new Run(model, state, vars, services);
  r.run(command);
  return { state: r.state, vars: r.vars, effects: r.effects, ended: r.ended };
}

/** Element ids where the case currently is (for highlighting the diagram). */
export const activeNodeIds = (state: CaseState) => [...new Set(state.tokens.map((t) => t.nodeId))];

/** Variables as plain JSON (FEEL values only). */
export const plainVars = (vars: Record<string, unknown>) => toFeel(vars) as Record<string, unknown>;
