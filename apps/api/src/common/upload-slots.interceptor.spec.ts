import { Subject, lastValueFrom, of } from 'rxjs';
import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { UploadSlots } from './upload-slots.interceptor';

const ctx = (userId: string) =>
  ({
    switchToHttp: () => ({ getRequest: () => ({ user: { id: userId } }) }),
  }) as unknown as ExecutionContext;

describe('UploadSlots (SEC-14)', () => {
  it('limits parallel uploads per user and in total, and frees the slot afterwards', async () => {
    const Interceptor = UploadSlots('test', 1, 2);
    const slots = new Interceptor();
    const a = new Subject<unknown>();
    const b = new Subject<unknown>();
    const runA = slots.intercept(ctx('u1'), { handle: () => a } as CallHandler).subscribe();
    expect(() => slots.intercept(ctx('u1'), { handle: () => of(1) })).toThrow(/upload is running/);
    const runB = slots
      .intercept(ctx('u2'), { handle: () => b } as CallHandler)
      .subscribe({ error: () => undefined });
    expect(() => slots.intercept(ctx('u3'), { handle: () => of(1) })).toThrow(/upload is running/);
    a.complete();
    runA.unsubscribe();
    expect(await lastValueFrom(slots.intercept(ctx('u1'), { handle: () => of(7) }))).toBe(7);
    b.error(new Error('multer failed'));
    runB.unsubscribe();
    expect(await lastValueFrom(slots.intercept(ctx('u3'), { handle: () => of(8) }))).toBe(8);
  });
});
