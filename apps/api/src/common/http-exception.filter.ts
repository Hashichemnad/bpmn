import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import { Prisma } from '@prisma/client';
import type { Response } from 'express';
import type { ApiErrorBody } from '@processhub/shared';

const STATUS_CODES: Record<number, string> = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHENTICATED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  413: 'PAYLOAD_TOO_LARGE',
  429: 'TOO_MANY_REQUESTS',
};

/** Normalises every error into ApiErrorBody and never leaks internals. */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exceptions');

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    let body: ApiErrorBody;

    if (exception instanceof ThrottlerException) {
      body = { statusCode: 429, code: 'TOO_MANY_REQUESTS', message: 'Too many requests' };
    } else if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const response = exception.getResponse();
      if (typeof response === 'object' && response && 'code' in response) {
        body = response as ApiErrorBody;
      } else {
        const message =
          typeof response === 'string'
            ? response
            : ((response as { message?: string }).message ?? exception.message);
        body = {
          statusCode: status,
          code: STATUS_CODES[status] ?? 'ERROR',
          message: Array.isArray(message) ? message.join('; ') : String(message),
        };
      }
    } else if (
      exception instanceof Prisma.PrismaClientKnownRequestError &&
      exception.code === 'P2002'
    ) {
      body = { statusCode: 409, code: 'DUPLICATE', message: 'Duplicate value' };
    } else if (
      exception instanceof Prisma.PrismaClientKnownRequestError &&
      exception.code === 'P2025'
    ) {
      body = { statusCode: 404, code: 'NOT_FOUND', message: 'Not found' };
    } else {
      this.logger.error(describeForLog(exception));
      body = {
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        code: 'INTERNAL_ERROR',
        message: 'Internal server error',
      };
    }
    res.status(body.statusCode).json(body);
  }
}

/**
 * What an unexpected error writes to the log (final session part B, SEC-45). Prisma errors carry the
 * query arguments in their message — password hashes, sealed secrets, form data — so only their class,
 * code, model and the first stack frames of our own code are logged.
 */
export function describeForLog(exception: unknown): string {
  if (
    exception instanceof Prisma.PrismaClientKnownRequestError ||
    exception instanceof Prisma.PrismaClientValidationError ||
    exception instanceof Prisma.PrismaClientUnknownRequestError ||
    exception instanceof Prisma.PrismaClientRustPanicError ||
    exception instanceof Prisma.PrismaClientInitializationError
  ) {
    const code = 'code' in exception ? String((exception as { code?: unknown }).code ?? '') : '';
    const model =
      'meta' in exception
        ? String((exception as { meta?: { modelName?: unknown } }).meta?.modelName ?? '')
        : '';
    const frames = (exception.stack ?? '')
      .split('\n')
      .filter((l) => l.trim().startsWith('at ') && !l.includes('node_modules'))
      .slice(0, 5)
      .join('\n');
    return `${exception.name}${code ? ` ${code}` : ''}${model ? ` (${model})` : ''} — details withheld\n${frames}`;
  }
  return exception instanceof Error ? (exception.stack ?? exception.message) : String(exception);
}
