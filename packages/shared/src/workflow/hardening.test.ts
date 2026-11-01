import { describe, expect, it } from 'vitest';
import { evaluateFeel, FeelError } from './feel';
import { assignVariables, MAX_VARIABLES_BYTES } from './engine';
import { timerError } from './model';
import { RESERVED_VARIABLES } from './forms';

/** Final session part B: sandbox and resource limits of the expression language and engine. */
describe('S-FEEL sandbox (SEC-28, SEC-33)', () => {
  it('never reaches Object.prototype through functions or __get', () => {
    expect(() => evaluateFeel('constructor("a")')).toThrow(FeelError);
    expect(() => evaluateFeel('__proto__(1)')).toThrow(FeelError);
    expect(evaluateFeel('__get({a: 1}, "constructor")')).toBeNull();
    expect(evaluateFeel('__get({a: 1}, "__proto__")')).toBeNull();
    expect(evaluateFeel('__get({a: 1}, "a")')).toBe(1);
    expect(evaluateFeel('x.constructor', { x: { a: 1 } })).toBeNull();
  });

  it('refuses deeply nested expressions instead of overflowing the stack', () => {
    expect(() => evaluateFeel('('.repeat(2000) + '1' + ')'.repeat(2000))).toThrow(FeelError);
    expect(evaluateFeel('((((1))))')).toBe(1);
  });

  it('stops exponential growth of values with a work budget', () => {
    let vars: Record<string, unknown> = { x: [1] };
    let error: unknown = null;
    try {
      for (let i = 0; i < 30; i++) vars = { x: evaluateFeel('[x, x]', vars) };
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(FeelError);
    expect(() => evaluateFeel('s + s', { s: 'a'.repeat(150_000) })).toThrow(/too long/);
  });

  it('keeps case variables within the size limit and ignores object internals', () => {
    const vars: Record<string, unknown> = { a: 1 };
    assignVariables(vars, { b: 2, ['__proto__']: { polluted: true } } as Record<string, unknown>);
    expect(vars).toEqual({ a: 1, b: 2 });
    expect(Object.getPrototypeOf(vars)).toBe(Object.prototype);
    expect(() => assignVariables(vars, { big: 'x'.repeat(MAX_VARIABLES_BYTES) })).toThrow(
      /size limit/,
    );
    expect(vars).toEqual({ a: 1, b: 2 });
    expect(RESERVED_VARIABLES).toEqual(expect.arrayContaining(['__proto__', 'constructor']));
  });
});

describe('timer limits (SEC-29)', () => {
  it('refuses timers that would fire too often', () => {
    expect(timerError({ kind: 'cycle', value: 'R/PT1S' })).toBe('TOO_SHORT');
    expect(timerError({ kind: 'cycle', value: 'R/PT4M' })).toBe('TOO_SHORT');
    expect(timerError({ kind: 'cycle', value: 'R5000/PT1H' })).toBe('TOO_MANY');
    expect(timerError({ kind: 'cycle', value: 'R3/PT1H' })).toBeNull();
    expect(timerError({ kind: 'duration', value: 'PT10S' })).toBe('TOO_SHORT');
    expect(timerError({ kind: 'duration', value: 'PT2H' })).toBeNull();
  });
});
