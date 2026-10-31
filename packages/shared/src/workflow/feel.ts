/**
 * S-FEEL: the simple subset of FEEL (DMN standard) used by workflow conditions, "set data" assignments,
 * assignment rules and DMN decision tables on the server (D-145). A small hand-written parser and
 * interpreter: no `eval`, no `Function`, no JavaScript from users. Values are numbers, strings, booleans,
 * null, lists, contexts (plain objects) and dates (ISO `YYYY-MM-DD` strings compare correctly as text).
 *
 * Errors are thrown as `FeelError` with a code; callers turn them into incidents or validation messages.
 */

export class FeelError extends Error {
  constructor(
    public readonly code: 'FEEL_SYNTAX' | 'FEEL_EVAL',
    message: string,
  ) {
    super(message);
    this.name = 'FeelError';
  }
}

export type FeelValue =
  | number
  | string
  | boolean
  | null
  | FeelValue[]
  | { [k: string]: FeelValue }
  | { range: true; lo: FeelValue; hi: FeelValue; loIn: boolean; hiIn: boolean };
export type FeelContext = Record<string, unknown>;

// ---------- Lexer ----------

type Tok =
  | { t: 'num'; v: number }
  | { t: 'str'; v: string }
  | { t: 'name'; v: string }
  | { t: 'op'; v: string }
  | { t: 'eof' };

const KEYWORDS = new Set([
  'and',
  'or',
  'not',
  'true',
  'false',
  'null',
  'if',
  'then',
  'else',
  'in',
  'between',
]);
/** Built-in functions whose names contain spaces (FEEL style). */
const MULTI_WORD = [
  'string length',
  'starts with',
  'ends with',
  'upper case',
  'lower case',
  'date and time',
  'is defined',
];

function lex(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  if (src.length > 4000) throw new FeelError('FEEL_SYNTAX', 'Expression too long');
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] ?? '') && src[i - 1] !== '.')) {
      const m = /^\d*\.?\d+(?:[eE][+-]?\d+)?/.exec(src.slice(i));
      // "1..5": the first dot belongs to the range operator.
      const plain = /^\d+(?=\.\.)/.exec(src.slice(i));
      const text = plain ? plain[0] : m![0];
      out.push({ t: 'num', v: Number(text) });
      i += text.length;
      continue;
    }
    if (c === '"') {
      let j = i + 1;
      let v = '';
      while (j < src.length && src[j] !== '"') {
        if (src[j] === '\\' && j + 1 < src.length) {
          const n = src[j + 1];
          v += n === 'n' ? '\n' : n === 't' ? '\t' : n;
          j += 2;
        } else v += src[j++];
      }
      if (j >= src.length) throw new FeelError('FEEL_SYNTAX', 'Unterminated string');
      out.push({ t: 'str', v });
      i = j + 1;
      continue;
    }
    const two = src.slice(i, i + 2);
    if (['<=', '>=', '!=', '..', '**'].includes(two)) {
      out.push({ t: 'op', v: two });
      i += 2;
      continue;
    }
    if ('+-*/<>=()[],.:{}'.includes(c)) {
      out.push({ t: 'op', v: c });
      i++;
      continue;
    }
    if (/[\p{L}_?]/u.test(c)) {
      let j = i;
      while (j < src.length && /[\p{L}\p{N}_?]/u.test(src[j])) j++;
      let word = src.slice(i, j);
      // Multi-word function names ("string length(…)").
      for (const mw of MULTI_WORD) {
        const rest = src.slice(i, i + mw.length);
        if (rest.toLowerCase() === mw && /^\s*\(/.test(src.slice(i + mw.length))) {
          word = mw;
          j = i + mw.length;
          break;
        }
      }
      out.push({ t: 'name', v: word });
      i = j;
      continue;
    }
    throw new FeelError('FEEL_SYNTAX', `Unexpected character "${c}"`);
  }
  out.push({ t: 'eof' });
  return out;
}

// ---------- AST ----------

export type FeelNode =
  | { k: 'lit'; v: FeelValue }
  | { k: 'name'; path: string[] }
  | { k: 'un'; op: '-' | 'not'; a: FeelNode }
  | { k: 'bin'; op: string; a: FeelNode; b: FeelNode }
  | { k: 'if'; c: FeelNode; t: FeelNode; e: FeelNode }
  | { k: 'call'; fn: string; args: FeelNode[] }
  | { k: 'list'; items: FeelNode[] }
  | { k: 'ctx'; entries: [string, FeelNode][] }
  | { k: 'range'; lo: FeelNode; hi: FeelNode; loIn: boolean; hiIn: boolean }
  | { k: 'in'; a: FeelNode; tests: UnaryTest[] }
  | { k: 'between'; a: FeelNode; lo: FeelNode; hi: FeelNode };

export type UnaryTest =
  | { k: 'any' }
  | { k: 'cmp'; op: '<' | '<=' | '>' | '>=' | '=' | '!='; v: FeelNode }
  | { k: 'range'; lo: FeelNode; hi: FeelNode; loIn: boolean; hiIn: boolean }
  | { k: 'not'; tests: UnaryTest[] }
  | { k: 'expr'; v: FeelNode };

class Parser {
  private p = 0;
  constructor(private readonly toks: Tok[]) {}
  peek(o = 0): Tok {
    return this.toks[Math.min(this.p + o, this.toks.length - 1)];
  }
  next(): Tok {
    return this.toks[this.p++];
  }
  isOp(v: string, o = 0) {
    const t = this.peek(o);
    return t.t === 'op' && t.v === v;
  }
  isName(v: string, o = 0) {
    const t = this.peek(o);
    return t.t === 'name' && t.v === v;
  }
  expectOp(v: string) {
    if (!this.isOp(v)) throw new FeelError('FEEL_SYNTAX', `Expected "${v}"`);
    this.p++;
  }
  expectName(v: string) {
    if (!this.isName(v)) throw new FeelError('FEEL_SYNTAX', `Expected "${v}"`);
    this.p++;
  }
  atEnd() {
    return this.peek().t === 'eof';
  }

  expression(): FeelNode {
    if (this.isName('if')) {
      this.p++;
      const c = this.expression();
      this.expectName('then');
      const t = this.expression();
      this.expectName('else');
      const e = this.expression();
      return { k: 'if', c, t, e };
    }
    return this.or();
  }
  or(): FeelNode {
    let a = this.and();
    while (this.isName('or')) {
      this.p++;
      a = { k: 'bin', op: 'or', a, b: this.and() };
    }
    return a;
  }
  and(): FeelNode {
    let a = this.comparison();
    while (this.isName('and')) {
      this.p++;
      a = { k: 'bin', op: 'and', a, b: this.comparison() };
    }
    return a;
  }
  comparison(): FeelNode {
    const a = this.additive();
    const t = this.peek();
    if (t.t === 'op' && ['=', '!=', '<', '<=', '>', '>='].includes(t.v)) {
      this.p++;
      return { k: 'bin', op: t.v, a, b: this.additive() };
    }
    if (this.isName('between')) {
      this.p++;
      const lo = this.additive();
      this.expectName('and');
      return { k: 'between', a, lo, hi: this.additive() };
    }
    if (this.isName('in')) {
      this.p++;
      if (this.isOp('(')) {
        this.p++;
        const tests = this.unaryTestList();
        this.expectOp(')');
        return { k: 'in', a, tests };
      }
      return { k: 'in', a, tests: [this.unaryTest()] };
    }
    return a;
  }
  additive(): FeelNode {
    let a = this.multiplicative();
    for (;;) {
      if (this.isOp('+') || this.isOp('-')) {
        const op = (this.next() as { v: string }).v;
        a = { k: 'bin', op, a, b: this.multiplicative() };
      } else return a;
    }
  }
  multiplicative(): FeelNode {
    let a = this.power();
    for (;;) {
      if (this.isOp('*') || this.isOp('/')) {
        const op = (this.next() as { v: string }).v;
        a = { k: 'bin', op, a, b: this.power() };
      } else return a;
    }
  }
  power(): FeelNode {
    const a = this.unary();
    if (this.isOp('**')) {
      this.p++;
      return { k: 'bin', op: '**', a, b: this.power() };
    }
    return a;
  }
  unary(): FeelNode {
    if (this.isOp('-')) {
      this.p++;
      return { k: 'un', op: '-', a: this.unary() };
    }
    return this.postfix();
  }
  postfix(): FeelNode {
    let n = this.primary();
    while (this.isOp('.')) {
      this.p++;
      const t = this.next();
      if (t.t !== 'name') throw new FeelError('FEEL_SYNTAX', 'Expected a name after "."');
      if (n.k === 'name') n = { k: 'name', path: [...n.path, t.v] };
      else n = { k: 'call', fn: '__get', args: [n, { k: 'lit', v: t.v }] };
    }
    return n;
  }
  primary(): FeelNode {
    const t = this.next();
    if (t.t === 'num') return { k: 'lit', v: t.v };
    if (t.t === 'str') return { k: 'lit', v: t.v };
    if (t.t === 'op') {
      if (t.v === '(') {
        const e = this.expression();
        this.expectOp(')');
        return e;
      }
      if (t.v === '[') {
        // List or range [a..b]
        if (this.isOp(']')) {
          this.p++;
          return { k: 'list', items: [] };
        }
        const first = this.expression();
        if (this.isOp('..')) {
          this.p++;
          const hi = this.expression();
          const close = this.next();
          if (close.t !== 'op' || (close.v !== ']' && close.v !== ')' && close.v !== '['))
            throw new FeelError('FEEL_SYNTAX', 'Expected "]"');
          return { k: 'range', lo: first, hi, loIn: true, hiIn: close.v === ']' };
        }
        const items = [first];
        while (this.isOp(',')) {
          this.p++;
          items.push(this.expression());
        }
        this.expectOp(']');
        return { k: 'list', items };
      }
      if (t.v === '{') {
        const entries: [string, FeelNode][] = [];
        while (!this.isOp('}')) {
          const key = this.next();
          if (key.t !== 'name' && key.t !== 'str')
            throw new FeelError('FEEL_SYNTAX', 'Expected a context key');
          this.expectOp(':');
          entries.push([String(key.v), this.expression()]);
          if (this.isOp(',')) this.p++;
          else break;
        }
        this.expectOp('}');
        return { k: 'ctx', entries };
      }
      throw new FeelError('FEEL_SYNTAX', `Unexpected "${t.v}"`);
    }
    if (t.t === 'name') {
      if (t.v === 'true') return { k: 'lit', v: true };
      if (t.v === 'false') return { k: 'lit', v: false };
      if (t.v === 'null') return { k: 'lit', v: null };
      if (t.v === 'not' && this.isOp('(')) {
        this.p++;
        const a = this.expression();
        this.expectOp(')');
        return { k: 'un', op: 'not', a };
      }
      if (KEYWORDS.has(t.v)) throw new FeelError('FEEL_SYNTAX', `Unexpected "${t.v}"`);
      if (this.isOp('(')) {
        this.p++;
        const args: FeelNode[] = [];
        while (!this.isOp(')')) {
          args.push(this.expression());
          if (this.isOp(',')) this.p++;
          else break;
        }
        this.expectOp(')');
        const fn = t.v.toLowerCase();
        if (!FUNCTIONS[fn]) throw new FeelError('FEEL_SYNTAX', `Unknown function "${t.v}"`);
        return { k: 'call', fn, args };
      }
      return { k: 'name', path: [t.v] };
    }
    throw new FeelError('FEEL_SYNTAX', 'Unexpected end of expression');
  }

  // Unary tests (decision table input entries, `x in (…)`).
  unaryTestList(): UnaryTest[] {
    const out = [this.unaryTest()];
    while (this.isOp(',')) {
      this.p++;
      out.push(this.unaryTest());
    }
    return out;
  }
  unaryTest(): UnaryTest {
    const t = this.peek();
    if (t.t === 'op' && t.v === '-' && (this.peek(1).t === 'eof' || this.isOp(',', 1)))
      return (this.p++, { k: 'any' });
    if (t.t === 'name' && t.v === 'not' && this.isOp('(', 1)) {
      this.p += 2;
      const tests = this.unaryTestList();
      this.expectOp(')');
      return { k: 'not', tests };
    }
    if (t.t === 'op' && ['<', '<=', '>', '>=', '=', '!='].includes(t.v)) {
      this.p++;
      return { k: 'cmp', op: t.v as '<', v: this.additive() };
    }
    if (t.t === 'op' && (t.v === '[' || t.v === '(' || t.v === ']')) {
      // Range with open / closed ends, or a list / parenthesised expression.
      const save = this.p;
      this.p++;
      try {
        const lo = this.additive();
        if (this.isOp('..')) {
          this.p++;
          const hi = this.additive();
          const close = this.next();
          if (close.t !== 'op' || ![']', ')', '['].includes(close.v))
            throw new FeelError('FEEL_SYNTAX', 'Expected the end of the range');
          return { k: 'range', lo, hi, loIn: t.v === '[', hiIn: close.v === ']' };
        }
      } catch (e) {
        if (!(e instanceof FeelError)) throw e;
      }
      this.p = save;
    }
    return { k: 'expr', v: this.expression() };
  }
}

/** Parses an expression; throws `FeelError` (code FEEL_SYNTAX) when invalid. */
export function parseFeel(src: string): FeelNode {
  const p = new Parser(lex(src));
  const n = p.expression();
  if (!p.atEnd()) throw new FeelError('FEEL_SYNTAX', 'Unexpected text after the expression');
  return n;
}

/** Parses unary tests (`< 10`, `"a","b"`, `[1..5]`, `not("x")`, `-`). Empty text = any. */
export function parseUnaryTests(src: string): UnaryTest[] {
  if (!src.trim()) return [{ k: 'any' }];
  const p = new Parser(lex(src));
  const tests = p.unaryTestList();
  if (!p.atEnd()) throw new FeelError('FEEL_SYNTAX', 'Unexpected text after the test');
  return tests;
}

// ---------- Interpreter ----------

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isRange = (
  v: unknown,
): v is { range: true; lo: FeelValue; hi: FeelValue; loIn: boolean; hiIn: boolean } =>
  !!v && typeof v === 'object' && (v as { range?: unknown }).range === true;

/** Converts JS values from forms / JSON into FEEL values (dates stay ISO strings). */
export function toFeel(v: unknown): FeelValue {
  if (v === undefined || v === null) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' || typeof v === 'boolean') return v;
  if (v instanceof Date) return v.toISOString();
  if (Array.isArray(v)) return v.map(toFeel);
  if (typeof v === 'object')
    return Object.fromEntries(Object.entries(v as object).map(([k, x]) => [k, toFeel(x)]));
  return null;
}

function equal(a: FeelValue, b: FeelValue): boolean {
  if (a === null || b === null) return a === b;
  if (Array.isArray(a) && Array.isArray(b))
    return a.length === b.length && a.every((x, i) => equal(x, b[i]));
  if (typeof a === 'object' || typeof b === 'object')
    return JSON.stringify(a) === JSON.stringify(b);
  return a === b;
}

function compare(a: FeelValue, b: FeelValue): number | null {
  if (isNum(a) && isNum(b)) return a - b;
  if (typeof a === 'string' && typeof b === 'string') return a < b ? -1 : a > b ? 1 : 0;
  return null;
}

function inRange(v: FeelValue, lo: FeelValue, hi: FeelValue, loIn: boolean, hiIn: boolean) {
  const c1 = compare(v, lo);
  const c2 = compare(v, hi);
  if (c1 === null || c2 === null) return false;
  return (loIn ? c1 >= 0 : c1 > 0) && (hiIn ? c2 <= 0 : c2 < 0);
}

type Fn = (args: FeelValue[]) => FeelValue;
const str = (v: FeelValue) => (typeof v === 'string' ? v : null);
const nums = (v: FeelValue[]): number[] =>
  (v.length === 1 && Array.isArray(v[0]) ? v[0] : v).filter(isNum);
const todayIso = () => new Date().toISOString().slice(0, 10);

const FUNCTIONS: Record<string, Fn> = {
  'string length': ([s]) => (str(s) !== null ? [...(s as string)].length : null),
  contains: ([s, x]) =>
    str(s) !== null && str(x) !== null ? (s as string).includes(x as string) : null,
  'starts with': ([s, x]) =>
    str(s) !== null && str(x) !== null ? (s as string).startsWith(x as string) : null,
  'ends with': ([s, x]) =>
    str(s) !== null && str(x) !== null ? (s as string).endsWith(x as string) : null,
  'upper case': ([s]) => (str(s) !== null ? (s as string).toUpperCase() : null),
  'lower case': ([s]) => (str(s) !== null ? (s as string).toLowerCase() : null),
  string: ([v]) => (v === null ? null : typeof v === 'object' ? JSON.stringify(v) : String(v)),
  number: ([v]) => {
    if (isNum(v)) return v;
    const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
    return Number.isFinite(n) ? n : null;
  },
  count: ([l]) => (Array.isArray(l) ? l.length : null),
  sum: (a) => nums(a).reduce((s, x) => s + x, 0),
  min: (a) => (nums(a).length ? Math.min(...nums(a)) : null),
  max: (a) => (nums(a).length ? Math.max(...nums(a)) : null),
  abs: ([v]) => (isNum(v) ? Math.abs(v) : null),
  floor: ([v]) => (isNum(v) ? Math.floor(v) : null),
  ceiling: ([v]) => (isNum(v) ? Math.ceil(v) : null),
  'is defined': ([v]) => v !== null,
  date: ([v]) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null),
  'date and time': ([v]) => (typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? v : null),
  today: () => todayIso(),
  now: () => new Date().toISOString(),
  __get: ([o, k]) =>
    o && typeof o === 'object' && !Array.isArray(o) && typeof k === 'string'
      ? ((o as Record<string, FeelValue>)[k] ?? null)
      : null,
};

function lookup(ctx: FeelContext, path: string[]): FeelValue {
  let cur: unknown = ctx;
  for (const seg of path) {
    if (!cur || typeof cur !== 'object' || Array.isArray(cur)) return null;
    if (!Object.prototype.hasOwnProperty.call(cur, seg)) return null;
    cur = (cur as Record<string, unknown>)[seg];
  }
  return toFeel(cur);
}

function evalNode(n: FeelNode, ctx: FeelContext, depth = 0): FeelValue {
  if (depth > 200) throw new FeelError('FEEL_EVAL', 'Expression too deep');
  const ev = (x: FeelNode) => evalNode(x, ctx, depth + 1);
  switch (n.k) {
    case 'lit':
      return n.v;
    case 'name':
      return lookup(ctx, n.path);
    case 'un': {
      const a = ev(n.a);
      if (n.op === '-') return isNum(a) ? -a : null;
      return typeof a === 'boolean' ? !a : null;
    }
    case 'if': {
      const c = ev(n.c);
      return c === true ? ev(n.t) : ev(n.e);
    }
    case 'list':
      return n.items.map(ev);
    case 'ctx':
      return Object.fromEntries(n.entries.map(([k, v]) => [k, ev(v)]));
    case 'range':
      return { range: true, lo: ev(n.lo), hi: ev(n.hi), loIn: n.loIn, hiIn: n.hiIn };
    case 'call':
      return FUNCTIONS[n.fn](n.args.map(ev));
    case 'between': {
      const v = ev(n.a);
      return inRange(v, ev(n.lo), ev(n.hi), true, true);
    }
    case 'in':
      return testAll(n.tests, ev(n.a), ctx);
    case 'bin': {
      if (n.op === 'and') {
        const a = ev(n.a);
        if (a === false) return false;
        const b = ev(n.b);
        if (b === false) return false;
        return a === true && b === true ? true : null;
      }
      if (n.op === 'or') {
        const a = ev(n.a);
        if (a === true) return true;
        const b = ev(n.b);
        if (b === true) return true;
        return a === false && b === false ? false : null;
      }
      const a = ev(n.a);
      const b = ev(n.b);
      switch (n.op) {
        case '=':
          return equal(a, b);
        case '!=':
          return !equal(a, b);
        case '<':
        case '<=':
        case '>':
        case '>=': {
          const c = compare(a, b);
          if (c === null) return null;
          return n.op === '<' ? c < 0 : n.op === '<=' ? c <= 0 : n.op === '>' ? c > 0 : c >= 0;
        }
        case '+':
          if (isNum(a) && isNum(b)) return a + b;
          if (typeof a === 'string' && typeof b === 'string') return a + b;
          return null;
        case '-':
          return isNum(a) && isNum(b) ? a - b : null;
        case '*':
          return isNum(a) && isNum(b) ? a * b : null;
        case '/':
          return isNum(a) && isNum(b) && b !== 0 ? a / b : null;
        case '**':
          return isNum(a) && isNum(b) ? a ** b : null;
      }
      throw new FeelError('FEEL_EVAL', `Unknown operator ${n.op}`);
    }
  }
}

function test(t: UnaryTest, v: FeelValue, ctx: FeelContext): boolean {
  switch (t.k) {
    case 'any':
      return true;
    case 'not':
      return !testAll(t.tests, v, ctx);
    case 'range':
      return inRange(v, evalNode(t.lo, ctx), evalNode(t.hi, ctx), t.loIn, t.hiIn);
    case 'cmp': {
      const x = evalNode(t.v, ctx);
      if (t.op === '=') return equal(v, x);
      if (t.op === '!=') return !equal(v, x);
      const c = compare(v, x);
      if (c === null) return false;
      return t.op === '<' ? c < 0 : t.op === '<=' ? c <= 0 : t.op === '>' ? c > 0 : c >= 0;
    }
    case 'expr': {
      // A value: equality; a list: membership; a range value: inclusion; a boolean expression
      // using "?" (the input value): its result.
      const x = evalNode(t.v, { ...ctx, '?': v });
      if (Array.isArray(x)) return x.some((i) => equal(v, i));
      if (isRange(x)) return inRange(v, x.lo, x.hi, x.loIn, x.hiIn);
      if (usesInput(t.v)) return x === true;
      return equal(v, x);
    }
  }
}

function usesInput(n: FeelNode): boolean {
  switch (n.k) {
    case 'name':
      return n.path[0] === '?';
    case 'un':
      return usesInput(n.a);
    case 'bin':
      return usesInput(n.a) || usesInput(n.b);
    case 'if':
      return usesInput(n.c) || usesInput(n.t) || usesInput(n.e);
    case 'call':
      return n.args.some(usesInput);
    case 'list':
      return n.items.some(usesInput);
    default:
      return false;
  }
}

function testAll(tests: UnaryTest[], v: FeelValue, ctx: FeelContext): boolean {
  return tests.some((t) => test(t, v, ctx));
}

/** Evaluates an expression against a context (form data / case variables). */
export function evaluateFeel(src: string | FeelNode, ctx: FeelContext = {}): FeelValue {
  const n = typeof src === 'string' ? parseFeel(src) : src;
  return evalNode(n, ctx);
}

/** Evaluates unary tests for an input value. */
export function evaluateUnaryTests(
  src: string | UnaryTest[],
  value: unknown,
  ctx: FeelContext = {},
): boolean {
  const tests = typeof src === 'string' ? parseUnaryTests(src) : src;
  return testAll(tests, toFeel(value), ctx);
}

/** Condition helper: true only when the expression evaluates to `true`. */
export function feelCondition(src: string, ctx: FeelContext): boolean {
  return evaluateFeel(src, ctx) === true;
}

/** Syntax check: null when valid, otherwise the error message. */
export function feelSyntaxError(src: string, kind: 'expression' | 'unaryTests' = 'expression') {
  try {
    if (kind === 'expression') parseFeel(src);
    else parseUnaryTests(src);
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

/** Variable names an expression reads (first path segment), e.g. for "used fields" hints. */
export function feelNames(src: string): string[] {
  const out = new Set<string>();
  const walk = (n: FeelNode) => {
    switch (n.k) {
      case 'name':
        if (n.path[0] !== '?') out.add(n.path[0]);
        break;
      case 'un':
        walk(n.a);
        break;
      case 'bin':
        walk(n.a);
        walk(n.b);
        break;
      case 'if':
        walk(n.c);
        walk(n.t);
        walk(n.e);
        break;
      case 'call':
        n.args.forEach(walk);
        break;
      case 'list':
        n.items.forEach(walk);
        break;
      case 'ctx':
        n.entries.forEach(([, v]) => walk(v));
        break;
      case 'range':
        walk(n.lo);
        walk(n.hi);
        break;
      case 'between':
        walk(n.a);
        walk(n.lo);
        walk(n.hi);
        break;
      case 'in':
        walk(n.a);
        break;
      case 'lit':
        break;
    }
  };
  try {
    walk(parseFeel(src));
  } catch {
    /* invalid: no names */
  }
  return [...out];
}
