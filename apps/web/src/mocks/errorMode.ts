import { ERROR_STATUS, type ErrorCode } from '@dataroom/contracts';

/**
 * Forced-error mode.
 *
 * The error states are a first-class deliverable, and they cannot be developed against a mock
 * that only ever succeeds. Any handler can be made to answer with any code in the contract,
 * either for one request or until cleared, scoped to one endpoint key or to all of them.
 *
 * A `?__forceError=CODE` query parameter does the same thing from the browser, so a dev can point
 * the running app at a failure without editing code.
 */

export interface ForcedErrorOptions {
  /** Endpoint key such as `nodes.get`. Omitted means every endpoint. */
  endpointKey?: string;
  /** Number of requests to fail before the rule expires. Omitted means "until cleared". */
  times?: number;
}

interface ForcedErrorRule {
  code: ErrorCode;
  endpointKey: string | undefined;
  remaining: number | undefined;
}

let rules: ForcedErrorRule[] = [];

export function forceError(code: ErrorCode, options: ForcedErrorOptions = {}): void {
  rules.push({ code, endpointKey: options.endpointKey, remaining: options.times });
}

export function clearForcedErrors(): void {
  rules = [];
}

export const FORCE_ERROR_PARAM = '__forceError';

function fromQuery(url: string): ErrorCode | null {
  const value = new URL(url, 'http://mock.local').searchParams.get(FORCE_ERROR_PARAM);
  if (value === null) return null;
  return value in ERROR_STATUS ? (value as ErrorCode) : null;
}

/** Returns the code this request should fail with, consuming a `times`-limited rule if it matches. */
export function takeForcedError(endpointKey: string, url: string): ErrorCode | null {
  const queryCode = fromQuery(url);
  if (queryCode !== null) return queryCode;

  const index = rules.findIndex(
    (rule) => rule.endpointKey === undefined || rule.endpointKey === endpointKey,
  );
  const rule = rules[index];
  if (rule === undefined) return null;

  if (rule.remaining !== undefined) {
    rule.remaining -= 1;
    if (rule.remaining <= 0) rules.splice(index, 1);
  }
  return rule.code;
}
