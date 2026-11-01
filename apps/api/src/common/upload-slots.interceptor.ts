import {
  HttpStatus,
  Injectable,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import { finalize, type Observable } from 'rxjs';
import type { AuthUser } from './auth-user';
import { AppException } from './app-exception';

/**
 * Limits how many large multipart uploads are buffered in memory at the same time (final session part B,
 * SEC-14): Multer keeps each file in RAM until the request is handled, so parallel 200 MB event-log
 * uploads could exhaust the API's memory. Listed BEFORE the FileInterceptor, so a refused request is
 * answered before its body is read.
 */
export function UploadSlots(name: string, perUser: number, total: number) {
  const running = new Map<string, number>();
  let all = 0;

  @Injectable()
  class UploadSlotsInterceptor implements NestInterceptor {
    intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
      const req = context.switchToHttp().getRequest<{ user?: AuthUser }>();
      const userId = req.user?.id ?? 'anonymous';
      const mine = running.get(userId) ?? 0;
      if (mine >= perUser || all >= total)
        throw new AppException(
          HttpStatus.TOO_MANY_REQUESTS,
          'TOO_MANY_REQUESTS',
          `Another ${name} upload is running`,
        );
      running.set(userId, mine + 1);
      all += 1;
      const release = () => {
        all -= 1;
        const left = (running.get(userId) ?? 1) - 1;
        if (left > 0) running.set(userId, left);
        else running.delete(userId);
      };
      try {
        return next.handle().pipe(finalize(release));
      } catch (e) {
        release();
        throw e;
      }
    }
  }
  return UploadSlotsInterceptor;
}
