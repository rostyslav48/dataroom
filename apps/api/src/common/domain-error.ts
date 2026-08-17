import { type ErrorCode } from '@dataroom/contracts';

/**
 * The only error type the application throws.
 *
 * Services never throw `HttpException` directly: the single mapping from a domain outcome to an
 * HTTP status lives in `HttpExceptionFilter`, driven by the contract's `ERROR_STATUS` map. Two
 * mappings would eventually disagree, and the one that disagreed would be the one the frontend
 * had already branched on.
 */
export class DomainError extends Error {
  readonly details: Record<string, string[]> | undefined;

  constructor(
    readonly code: ErrorCode,
    message: string,
    details?: Record<string, string[]>,
  ) {
    super(message);
    this.name = 'DomainError';
    this.details = details;
  }
}

/**
 * Named constructors, so a call site reads as the thing that went wrong rather than as a string
 * literal that has to be matched against the contract by eye.
 */
export const errors = {
  unauthenticated: (message = 'Sign in to continue.'): DomainError =>
    new DomainError('UNAUTHENTICATED', message),

  forbidden: (message = "You don't have access to this item."): DomainError =>
    new DomainError('FORBIDDEN', message),

  accessRevoked: (message = 'Your access was removed by the owner.'): DomainError =>
    new DomainError('ACCESS_REVOKED', message),

  shareExpired: (message = 'This link has expired.'): DomainError =>
    new DomainError('SHARE_EXPIRED', message),

  wrongAccount: (message = 'This was shared with a different account.'): DomainError =>
    new DomainError('WRONG_ACCOUNT', message),

  notFound: (message = 'Not found.'): DomainError => new DomainError('NOT_FOUND', message),

  itemGone: (message = 'This item was deleted by the owner.'): DomainError =>
    new DomainError('ITEM_GONE', message),

  validationFailed: (details: Record<string, string[]>, message = 'Validation failed.'): DomainError =>
    new DomainError('VALIDATION_FAILED', message, details),

  nameConflict: (message = 'An item with that name already exists here.'): DomainError =>
    new DomainError('NAME_CONFLICT', message),

  cycleNotAllowed: (message = "You can't move a folder into itself."): DomainError =>
    new DomainError('CYCLE_NOT_ALLOWED', message),

  invalidMoveTarget: (message = 'That destination is not a folder in this data room.'): DomainError =>
    new DomainError('INVALID_MOVE_TARGET', message),

  fileTooLarge: (message: string): DomainError => new DomainError('FILE_TOO_LARGE', message),

  unsupportedType: (message: string): DomainError => new DomainError('UNSUPPORTED_TYPE', message),

  uploadIncomplete: (message = 'The upload did not finish. Try again.'): DomainError =>
    new DomainError('UPLOAD_INCOMPLETE', message),

  rateLimited: (message = 'Too many requests. Slow down and try again.'): DomainError =>
    new DomainError('RATE_LIMITED', message),

  internal: (message = 'Something went wrong on our side.'): DomainError =>
    new DomainError('INTERNAL', message),
};
