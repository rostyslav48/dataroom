import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import { QueryFailedError } from 'typeorm';
import { describe, expect, it } from 'vitest';
import { ApiError, ERROR_STATUS } from '@dataroom/contracts';
import { DomainError, errors } from '../../src/common/domain-error';
import { HttpExceptionFilter, toDomainError } from '../../src/common/http-exception.filter';

const queryFailed = (code: string, constraint?: string): QueryFailedError => {
  const error = new QueryFailedError('INSERT ...', [], new Error('driver'));
  Object.assign(error, { driverError: { code, constraint } });
  return error;
};

describe('toDomainError', () => {
  it('passes a DomainError through untouched', () => {
    const original = errors.itemGone();
    expect(toDomainError(original)).toBe(original);
  });

  it('maps a sibling-name unique violation to NAME_CONFLICT', () => {
    // This mapping is the ONLY way name conflicts are detected: no service pre-checks with a
    // SELECT, which would be a TOCTOU race under concurrent uploads.
    expect(toDomainError(queryFailed('23505', 'ux_nodes_sibling_name')).code).toBe('NAME_CONFLICT');
  });

  it('does not turn an unrelated unique violation into a name conflict', () => {
    expect(toDomainError(queryFailed('23505', 'users_email_key')).code).toBe('INTERNAL');
  });

  it('maps a check violation to VALIDATION_FAILED', () => {
    expect(toDomainError(queryFailed('23514', 'ck_name_no_slash')).code).toBe('VALIDATION_FAILED');
  });

  it('maps throttling to RATE_LIMITED', () => {
    expect(toDomainError(new ThrottlerException()).code).toBe('RATE_LIMITED');
  });

  it.each([
    [new NotFoundException(), 'NOT_FOUND'],
    [new ForbiddenException(), 'FORBIDDEN'],
    [new BadRequestException(), 'VALIDATION_FAILED'],
  ])('maps framework exceptions by status', (exception, expected) => {
    expect(toDomainError(exception).code).toBe(expected);
  });

  it('maps anything else to INTERNAL', () => {
    expect(toDomainError(new Error('boom')).code).toBe('INTERNAL');
    expect(toDomainError('a string').code).toBe('INTERNAL');
  });
});

interface CapturedResponse {
  status: number;
  body: unknown;
}

const runFilter = (exception: unknown): CapturedResponse => {
  const captured: CapturedResponse = { status: 0, body: undefined };
  const response = {
    status(code: number) {
      captured.status = code;
      return this;
    },
    json(body: unknown) {
      captured.body = body;
    },
  };
  const host = {
    switchToHttp: () => ({
      getRequest: () => ({ id: 'req-1', method: 'GET', url: '/api/v1/nodes/x' }),
      getResponse: () => response,
    }),
  };

  new HttpExceptionFilter().catch(exception, host as never);
  return captured;
};

describe('HttpExceptionFilter', () => {
  it('renders every DomainError as a valid ApiError at its contract status', () => {
    const cases: DomainError[] = [
      errors.unauthenticated(),
      errors.forbidden(),
      errors.accessRevoked(),
      errors.shareExpired(),
      errors.wrongAccount(),
      errors.notFound(),
      errors.itemGone(),
      errors.validationFailed({ name: ['Required'] }),
      errors.nameConflict(),
      errors.cycleNotAllowed(),
      errors.invalidMoveTarget(),
      errors.fileTooLarge('too big'),
      errors.unsupportedType('nope'),
      errors.uploadIncomplete(),
      errors.rateLimited(),
      errors.internal(),
    ];

    for (const error of cases) {
      const { status, body } = runFilter(error);
      expect(status, error.code).toBe(ERROR_STATUS[error.code]);
      expect(() => ApiError.parse(body), error.code).not.toThrow();
    }
  });

  it('carries field details through for VALIDATION_FAILED', () => {
    const { body } = runFilter(errors.validationFailed({ 'recipients.0': ['Invalid email'] }));
    expect(ApiError.parse(body).details).toEqual({ 'recipients.0': ['Invalid email'] });
  });

  it('never leaks an internal message to the client', () => {
    const { body } = runFilter(new Error('connection string postgres://user:hunter2@db'));
    const parsed = ApiError.parse(body);
    expect(parsed.code).toBe('INTERNAL');
    expect(parsed.message).not.toContain('hunter2');
  });

  it('echoes the request id so a user-visible failure can be found in the log', () => {
    expect(ApiError.parse(runFilter(errors.notFound()).body).requestId).toBe('req-1');
  });
});
