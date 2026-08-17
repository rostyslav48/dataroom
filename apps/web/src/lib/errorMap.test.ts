import { describe, expect, it } from 'vitest';
import { ErrorCode } from '@dataroom/contracts';
import { ApiClientError } from './api';
import { errorMap, presentError } from './errorMap';

describe('errorMap', () => {
  it('has a designed state for every code in the contract', () => {
    for (const code of ErrorCode.options) {
      const presentation = errorMap(code);
      expect(presentation.title.length, code).toBeGreaterThan(0);
      expect(presentation.body.length, code).toBeGreaterThan(0);
    }
  });

  it('gives the codes with a recovery path an action, and terminal ones none', () => {
    expect(errorMap('UNAUTHENTICATED').action.kind).toBe('signIn');
    expect(errorMap('WRONG_ACCOUNT').action.kind).toBe('switchAccount');
    expect(errorMap('ITEM_GONE').action.kind).toBe('goToShareRoot');
    expect(errorMap('SHARE_EXPIRED').action.kind).toBe('none');
    expect(errorMap('NAME_CONFLICT').action.kind).toBe('none');
  });

  it('distinguishes revoked from expired, because the user needs to know which happened', () => {
    expect(errorMap('ACCESS_REVOKED').title).not.toBe(errorMap('SHARE_EXPIRED').title);
  });
});

describe('presentError', () => {
  it('presents a transport failure as an offline state, not a server error', () => {
    const error = new ApiClientError('INTERNAL', 'boom', { status: 0, networkError: true });
    expect(presentError(error).title).toBe("Can't reach the server");
  });

  it('presents a schema mismatch as an unexpected-response state', () => {
    const error = new ApiClientError('INTERNAL', 'boom', { status: 200, contractViolation: true });
    expect(presentError(error).title).toBe('Unexpected response from the server');
  });

  it('maps a coded API error through errorMap', () => {
    const error = new ApiClientError('FORBIDDEN', 'no', { status: 403 });
    expect(presentError(error)).toEqual(errorMap('FORBIDDEN'));
  });

  it('falls back to the internal state for a thrown non-API value', () => {
    expect(presentError(new Error('unexpected'))).toEqual(errorMap('INTERNAL'));
    expect(presentError('a string')).toEqual(errorMap('INTERNAL'));
  });
});
