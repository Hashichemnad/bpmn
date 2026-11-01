import { startPeriodic } from './periodic';

describe('startPeriodic', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('never runs the task twice at the same time and keeps running after errors', async () => {
    const logger = { error: jest.fn(), warn: jest.fn() };
    let calls = 0;
    let release!: () => void;
    const task = jest.fn(() => {
      calls++;
      if (calls === 2) return Promise.reject(new Error('boom'));
      return new Promise<void>((r) => (release = r));
    });
    const p = startPeriodic('test', task, 10, 100, logger);
    await jest.advanceTimersByTimeAsync(10); // first run starts and stays busy
    expect(task).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(250); // two ticks while busy: skipped
    expect(task).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledTimes(2);
    release();
    await jest.advanceTimersByTimeAsync(100); // next tick runs (and fails)
    expect(task).toHaveBeenCalledTimes(2);
    expect(logger.error).toHaveBeenCalledWith('test: boom');
    await jest.advanceTimersByTimeAsync(100); // and the one after runs again
    expect(task).toHaveBeenCalledTimes(3);
    p.stop();
    release();
    await jest.advanceTimersByTimeAsync(1000);
    expect(task).toHaveBeenCalledTimes(3);
  });
});
