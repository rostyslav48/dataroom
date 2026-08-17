import { timingSafeEqual } from 'node:crypto';
import { GoogleAuthQuery } from '@dataroom/contracts';

/**
 * The OAuth `state` parameter carries two things: where to land after login, and a nonce that binds
 * the callback to the browser that started the flow.
 *
 * **`returnTo` leaves our control entirely** — it is handed to Google and comes back through a
 * redirect — so it is validated on the way out *and* on the way back in. This is the canonical
 * location of an open-redirect bug, and validating only once is how it survives review.
 *
 * **The nonce is what stops login CSRF.** Without it, an attacker can start the Google flow, keep
 * their own authorization `code`, and then get a victim to load the callback URL: a plain `GET`, so
 * an `<img>` or a link is enough. The victim's browser is then handed a session for the *attacker's*
 * account, and every document they upload afterwards lands in storage the attacker owns. The nonce
 * is stored in a short-lived httpOnly cookie and compared here.
 */
export const DEFAULT_RETURN_TO = '/rooms';

export interface OAuthState {
  returnTo: string | null;
  nonce: string;
}

export function encodeState(returnTo: string | undefined, nonce: string): string {
  const payload: OAuthState = { returnTo: returnTo ?? null, nonce };
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

function parseState(state: unknown): OAuthState | null {
  if (typeof state !== 'string' || state.length === 0) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(state, 'base64url').toString('utf8'));
  } catch {
    return null;
  }

  const candidate = parsed as { returnTo?: unknown; nonce?: unknown } | null;
  if (typeof candidate?.nonce !== 'string' || candidate.nonce.length === 0) return null;

  return {
    nonce: candidate.nonce,
    returnTo: typeof candidate.returnTo === 'string' ? candidate.returnTo : null,
  };
}

/** Constant-time, and length-safe: `timingSafeEqual` throws on a length mismatch. */
export function nonceMatches(expected: string | undefined, presented: string): boolean {
  if (!expected) return false;
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(presented, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function stateNonceOf(state: unknown): string | null {
  return parseState(state)?.nonce ?? null;
}

/**
 * The post-login destination, re-validated with the same schema the query parameter was validated
 * with. `//evil.com` and `https://evil.com` are rejected here, not merely on the way out.
 */
export function returnToFromState(state: unknown): string {
  const returnTo = parseState(state)?.returnTo;
  if (typeof returnTo !== 'string') return DEFAULT_RETURN_TO;

  const result = GoogleAuthQuery.safeParse({ returnTo });
  return result.success ? (result.data.returnTo ?? DEFAULT_RETURN_TO) : DEFAULT_RETURN_TO;
}
