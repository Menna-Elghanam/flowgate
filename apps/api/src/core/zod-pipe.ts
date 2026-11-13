import { type PipeTransform } from '@nestjs/common';
import { z, type ZodType, type ZodTypeDef } from 'zod';
import { AppError } from './errors';

export function validationError(error: z.ZodError, message = 'Some fields are invalid'): AppError {
  return new AppError(
    400,
    'VALIDATION_ERROR',
    message,
    error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
  );
}

/** Validates a body, query or param against a Zod schema and returns the parsed value. */
export class ZodPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodType<T, ZodTypeDef, unknown>) {}

  transform(value: unknown): T {
    const result = this.schema.safeParse(value);
    if (!result.success) throw validationError(result.error);
    return result.data;
  }
}

export const uuidParam = new ZodPipe(z.string().uuid());
