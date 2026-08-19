import { describe, expect, it } from 'vitest';
import type { Profile } from 'passport-google-oauth20';
import { DomainError } from '../../src/common/domain-error';
import type { AppConfig } from '../../src/config/app.config';
import { GoogleStrategy } from '../../src/auth/google.strategy';

/**
 * `validate` is the whole of the strategy's own logic — everything else is Passport's. The
 * integration harness substitutes the code-for-profile exchange, so the shape checks in here are
 * asserted at this level or nowhere.
 */
const config = {
  google: {
    clientId: 'client-id',
    clientSecret: 'client-secret',
    callbackUrl: 'http://localhost:3000/api/v1/auth/google/callback',
  },
} as AppConfig;

const profile = (overrides: Partial<Profile> = {}): Profile =>
  ({
    id: 'google-sub-1',
    displayName: 'Ada Lovelace',
    emails: [{ value: 'Ada@Example.com', verified: 'true' }],
    photos: [{ value: 'https://lh3.googleusercontent.com/a/ada' }],
    ...overrides,
  }) as Profile;

const validate = (p: Profile): unknown => new GoogleStrategy(config).validate('at', 'rt', p);

describe('GoogleStrategy.validate', () => {
  it('accepts a verified address and normalises it to lower case', () => {
    expect(validate(profile())).toEqual({
      googleSub: 'google-sub-1',
      email: 'ada@example.com',
      name: 'Ada Lovelace',
      avatarUrl: 'https://lh3.googleusercontent.com/a/ada',
    });
  });

  it('refuses an account that shared no email at all', () => {
    const error = (() => {
      try {
        validate(profile({ emails: [] }));
      } catch (e) {
        return e;
      }
      return null;
    })();

    expect(error).toBeInstanceOf(DomainError);
    expect((error as DomainError).code).toBe('FORBIDDEN');
  });

  it.each([
    ['explicitly unverified', 'false'],
    ['a missing verified flag', undefined],
    ['a flag of an unexpected shape', 'yes'],
  ])('refuses %s — the check fails closed', (_label, verified) => {
    // This used to run only when `verified` was present, so any shape change in
    // `passport-google-oauth20`, any provider response variation, or a Workspace edge case would
    // have made every address verified. It matters because `signInWithGoogle` immediately claims
    // every unclaimed `share_recipients` row addressed to the address: an address accepted here
    // inherits whatever was already invited to it.
    const emails = [{ value: 'ada@example.com', ...(verified === undefined ? {} : { verified }) }];

    expect(() => validate(profile({ emails } as unknown as Partial<Profile>))).toThrow(DomainError);
  });

  it('accepts a boolean true as well as the string Google actually sends', () => {
    const emails = [{ value: 'ada@example.com', verified: true }];
    expect(validate(profile({ emails } as unknown as Partial<Profile>))).toMatchObject({
      email: 'ada@example.com',
    });
  });
});
