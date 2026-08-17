import { GoogleAuthQuery } from '@dataroom/contracts';

/**
 * `returnTo` leaves our control entirely — it is packed into Google's `state` parameter and comes
 * back through a redirect — so it is validated on the way out *and* on the way back in. This is the
 * canonical location of an open-redirect bug, and validating only once is how it survives review.
 *
 * The rule is the contract's: a same-origin path, starting with a single `/`.
 */
export const DEFAULT_RETURN_TO = '/rooms';

export function encodeState(returnTo: string | undefined): string {
  return Buffer.from(JSON.stringify({ returnTo: returnTo ?? null }), 'utf8').toString('base64url');
}

export function decodeState(state: unknown): string {
  if (typeof state !== 'string' || state.length === 0) return DEFAULT_RETURN_TO;

  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(state, 'base64url').toString('utf8'));
  } catch {
    return DEFAULT_RETURN_TO;
  }

  const returnTo = (parsed as { returnTo?: unknown } | null)?.returnTo;
  if (typeof returnTo !== 'string') return DEFAULT_RETURN_TO;

  // Re-validated with the same schema the query parameter was validated with — `//evil.com` and
  // `https://evil.com` are both rejected here, not merely on the way out.
  const result = GoogleAuthQuery.safeParse({ returnTo });
  return result.success ? (result.data.returnTo ?? DEFAULT_RETURN_TO) : DEFAULT_RETURN_TO;
}
