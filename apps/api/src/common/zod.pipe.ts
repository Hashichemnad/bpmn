import { HttpStatus, type PipeTransform } from '@nestjs/common';
import type { ZodTypeAny, z } from 'zod';
import { AppException } from './app-exception';

/** Validates and transforms request input using a shared zod schema. */
export class ZodPipe<S extends ZodTypeAny> implements PipeTransform<unknown, z.infer<S>> {
  constructor(private readonly schema: S) {}

  transform(value: unknown): z.infer<S> {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        'VALIDATION_ERROR',
        'Validation failed',
        result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      );
    }
    return result.data;
  }
}

export const UuidPipe = (): PipeTransform<unknown, string> => ({
  transform(value: unknown) {
    if (
      typeof value !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
    ) {
      throw new AppException(HttpStatus.BAD_REQUEST, 'INVALID_ID', 'Invalid id');
    }
    return value;
  },
});
