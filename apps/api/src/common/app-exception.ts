import { HttpException, HttpStatus } from '@nestjs/common';

/** HTTP exception carrying a machine-readable code that the web client translates. */
export class AppException extends HttpException {
  constructor(
    status: HttpStatus,
    public readonly code: string,
    message?: string,
    public readonly details?: unknown,
  ) {
    super({ statusCode: status, code, message: message ?? code, details }, status);
  }
}

export const notFound = (entity = 'Resource') =>
  new AppException(HttpStatus.NOT_FOUND, 'NOT_FOUND', `${entity} not found`);
export const forbidden = (message = 'Forbidden') =>
  new AppException(HttpStatus.FORBIDDEN, 'FORBIDDEN', message);
export const conflict = (code: string, message?: string) =>
  new AppException(HttpStatus.CONFLICT, code, message);
export const badRequest = (code: string, message?: string, details?: unknown) =>
  new AppException(HttpStatus.BAD_REQUEST, code, message, details);
