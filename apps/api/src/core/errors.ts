import { InvalidTransitionError } from '@flowgate/workflow';
import {
  Catch,
  HttpException,
  HttpStatus,
  Logger,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import type { Response } from 'express';

/** An expected failure with a stable `code` the frontend can rely on. */
export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export const notFound = (what: string) => new AppError(404, 'NOT_FOUND', `${what} not found`);
export const forbidden = (message = 'You are not allowed to do this') =>
  new AppError(403, 'FORBIDDEN', message);
export const conflict = (code: string, message: string, details?: unknown) =>
  new AppError(409, code, message, details);

export interface ErrorBody {
  error: { code: string; message: string; details?: unknown };
}

const HTTP_CODES: Record<number, string> = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHENTICATED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  413: 'PAYLOAD_TOO_LARGE',
  422: 'UNPROCESSABLE',
  429: 'RATE_LIMITED',
};

/** node-postgres errors may arrive wrapped by Drizzle; the SQLSTATE code is on the cause. */
function postgresCode(error: unknown): string | undefined {
  for (let current = error, depth = 0; current && depth < 3; depth++) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code)) return code;
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}

export function toErrorResponse(exception: unknown): { status: number; body: ErrorBody } {
  if (exception instanceof AppError) {
    const { code, message, details } = exception;
    return {
      status: exception.status,
      body: { error: details === undefined ? { code, message } : { code, message, details } },
    };
  }
  if (exception instanceof InvalidTransitionError) {
    return {
      status: 409,
      body: { error: { code: 'INVALID_TRANSITION', message: exception.message } },
    };
  }
  if (exception instanceof HttpException) {
    const status = exception.getStatus();
    const response = exception.getResponse();
    const raw =
      typeof response === 'object' && response && 'message' in response
        ? (response as { message: unknown }).message
        : exception.message;
    const message = Array.isArray(raw) ? raw.join(', ') : String(raw);
    return { status, body: { error: { code: HTTP_CODES[status] ?? 'ERROR', message } } };
  }
  if (postgresCode(exception) === '23505') {
    return { status: 409, body: { error: { code: 'CONFLICT', message: 'This already exists' } } };
  }
  return {
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    body: { error: { code: 'INTERNAL', message: 'Something went wrong' } },
  };
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Errors');

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const { status, body } = toErrorResponse(exception);
    if (status >= 500) {
      this.logger.error(
        exception instanceof Error ? (exception.stack ?? exception.message) : exception,
      );
    }
    response.status(status).json(body);
  }
}
