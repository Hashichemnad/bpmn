import { test } from 'node:test';
import assert from 'node:assert/strict';
import { launchWithSandbox, parseSandboxMode, sandboxAttempts } from './sandbox.js';

test('parses the mode; empty means auto, anything else is refused', () => {
  assert.equal(parseSandboxMode(undefined), 'auto');
  assert.equal(parseSandboxMode(''), 'auto');
  assert.equal(parseSandboxMode(' ON '), 'on');
  assert.equal(parseSandboxMode('off'), 'off');
  assert.throws(() => parseSandboxMode('yes'), /RENDERER_SANDBOX/);
});

test('attempts: on = sandbox only, off = no sandbox only, auto = sandbox first', () => {
  assert.deepEqual(sandboxAttempts('on'), [true]);
  assert.deepEqual(sandboxAttempts('off'), [false]);
  assert.deepEqual(sandboxAttempts('auto'), [true, false]);
});

test('auto uses the sandbox when it works and never tries --no-sandbox', async () => {
  const calls: boolean[] = [];
  const r = await launchWithSandbox('auto', async (s) => {
    calls.push(s);
    return 'browser';
  });
  assert.deepEqual(r, { value: 'browser', sandbox: true });
  assert.deepEqual(calls, [true]);
});

test('auto falls back to --no-sandbox with a warning when the sandbox cannot start', async () => {
  const warnings: string[] = [];
  const r = await launchWithSandbox(
    'auto',
    async (s) => {
      if (s) throw new Error('No usable sandbox!\nmore');
      return 'browser';
    },
    (m) => warnings.push(m),
  );
  assert.deepEqual(r, { value: 'browser', sandbox: false });
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /No usable sandbox!.*--no-sandbox/);
});

test('on never falls back: the launch error is raised', async () => {
  const calls: boolean[] = [];
  await assert.rejects(
    launchWithSandbox('on', async (s) => {
      calls.push(s);
      throw new Error('No usable sandbox!');
    }),
    /No usable sandbox/,
  );
  assert.deepEqual(calls, [true]);
});

test('off launches without the sandbox only', async () => {
  const calls: boolean[] = [];
  const r = await launchWithSandbox('off', async (s) => {
    calls.push(s);
    return 1;
  });
  assert.deepEqual(r, { value: 1, sandbox: false });
  assert.deepEqual(calls, [false]);
});
