import { randomUUID } from 'node:crypto';
import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import { QueryFailedError } from 'typeorm';
import { ERROR_STATUS, type ApiError } from '@dataroom/contracts';
import { DomainError, errors } from './domain-error';

/** pino-http assigns `req.id`; it is echoed to the client so a user's error can be grepped. */
interface RequestWithId {
  id?: string;
  method?: string;
  url?: string;
}

interface ResponseLike {
  status(code: number): ResponseLike;
  json(body: unknown): void;
}

/** Postgres error codes we translate rather than swallow. */
const PG_UNIQUE_VIOLATION = '23505';
const PG_CHECK_VIOLATION = '23514';

interface DriverError {
  code?: string;
  constraint?: string;
  detail?: string;
}

function driverErrorOf(exception: unknown): DriverError | null {
  if (!(exception instanceof QueryFailedError)) return null;
  const driverError: unknown = (exception as QueryFailedError & { driverError?: unknown })
    .driverError;
  if (typeof driverError !== 'object' || driverError === null) return null;
  return driverError as DriverError;
}

const STATUS_TO_CODE: Partial<Record<number, ApiError['code']>> = {
  [HttpStatus.BAD_REQUEST]: 'VALIDATION_FAILED',
  [HttpStatus.UNAUTHORIZED]: 'UNAUTHENTICATED',
  [HttpStatus.FORBIDDEN]: 'FORBIDDEN',
  [HttpStatus.NOT_FOUND]: 'NOT_FOUND',
  [HttpStatus.CONFLICT]: 'NAME_CONFLICT',
  [HttpStatus.GONE]: 'ITEM_GONE',
  [HttpStatus.PAYLOAD_TOO_LARGE]: 'FILE_TOO_LARGE',
  [HttpStatus.UNSUPPORTED_MEDIA_TYPE]: 'UNSUPPORTED_TYPE',
  [HttpStatus.TOO_MANY_REQUESTS]: 'RATE_LIMITED',
};

/**
 * Every failure in the application funnels through here, including framework-thrown ones, so the
 * client sees exactly one error shape. Exported separately from the filter because the mapping is
 * the interesting part and deserves its own unit tests.
 */
export function toDomainError(exception: unknown): DomainError {
  if (exception instanceof DomainError) return exception;

  if (exception instanceof ThrottlerException) return errors.rateLimited();

  const driverError = driverErrorOf(exception);
  if (driverError?.code === PG_UNIQUE_VIOLATION) {
    // The sibling-name index is the ONLY authority on name conflicts — no service pre-checks with
    // a SELECT, which would be a TOCTOU race under concurrent uploads (ProjectDesc/02-data-model).
    if (driverError.constraint === 'ux_nodes_sibling_name') return errors.nameConflict();
    return errors.internal('That change conflicts with existing data.');
  }
  if (driverError?.code === PG_CHECK_VIOLATION) {
    // The constraint name stays in the log line, not in the response: it names internal schema
    // objects, and the client can do nothing with it.
    return errors.validationFailed({ _root: ['That value is not allowed.'] }, 'That value is not allowed.');
  }

  if (exception instanceof HttpException) {
    const status = exception.getStatus();
    const code = STATUS_TO_CODE[status] ?? 'INTERNAL';
    return new DomainError(code, exception.message);
  }

  return errors.internal();
}

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('HttpExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<RequestWithId>();
    const response = http.getResponse<ResponseLike>();

    const domainError = toDomainError(exception);
    const status = ERROR_STATUS[domainError.code];
    const requestId = request.id ?? randomUUID();

    const context = `${request.method ?? '?'} ${request.url ?? '?'} → ${domainError.code}`;
    if (status >= 500) {
      this.logger.error(
        { requestId, err: exception },
        `${context}: ${(exception as Error)?.message ?? 'unknown error'}`,
      );
    } else {
      this.logger.warn({ requestId }, `${context}: ${domainError.message}`);
    }

    const body: ApiError = {
      code: domainError.code,
      // A 500's real message is for the log, never for the client.
      message: status >= 500 ? 'Something went wrong on our side.' : domainError.message,
      requestId,
      ...(domainError.details ? { details: domainError.details } : {}),
    };

    response.status(status).json(body);
  }
}
