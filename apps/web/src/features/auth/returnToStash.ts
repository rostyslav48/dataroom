import { isSafeReturnTo } from '@dataroom/contracts';

/**
 * Keeps the post-login destination out of the OAuth `state` parameter.
 *
 * `returnTo` is base64-encoded into `state` and handed to Google as a query parameter, where it
 * lands in Google's request logs, in browser history, and in any intermediary that logs full URLs.
 * That is harmless for `/rooms/<uuid>` and not harmless for `/s/<token>/…`: the share token is a
 * 32-byte bearer capability granting read access to a shared subtree, and putting it in `state`
 * widens the set of parties holding it from "whoever the owner sent the link to" to "whoever the
 * owner sent the link to, plus Google".
 *
 * So the path is stashed in `sessionStorage` under a random key and only the *key* travels through
 * OAuth. `/resume/:key` reads it back after the redirect.
 *
 * **Why `sessionStorage` is the right place here, given the rule that says never use it.** That
 * rule is about the *access token*, which must cost one session if an XSS lands rather than a
 * persistent credential. This holds a URL that is already in the address bar and the history of
 * the very same tab, is scoped to that one tab, is removed the moment it is read, and is reachable
 * only by script that could read `window.location` anyway. It stores strictly less than the tab
 * already discloses.
 */
const KEY_PREFIX = 'dataroom.returnTo.';

/** The route that reads a stash back. Exported so the route table and the tests agree on it. */
export const RESUME_PATH = '/resume';

const randomKey = (): string => {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
};

/**
 * Stashes `path` and returns the `returnTo` to send through OAuth in its place.
 *
 * Falls back to the rooms list when `sessionStorage` is unavailable. Losing the destination is
 * preferable to handing a share-token bearer capability to Google through OAuth `state`.
 */
export function stashReturnTo(path: string): string {
  if (!isSafeReturnTo(path)) return '/rooms';
  try {
    const key = randomKey();
    window.sessionStorage.setItem(`${KEY_PREFIX}${key}`, path);
    return `${RESUME_PATH}/${key}`;
  } catch {
    return '/rooms';
  }
}

/** Reads a stash and removes it: a key is good for exactly one redirect. */
export function takeStashedReturnTo(key: string | undefined): string | null {
  if (key === undefined || key === '') return null;
  try {
    const storageKey = `${KEY_PREFIX}${key}`;
    const path = window.sessionStorage.getItem(storageKey);
    window.sessionStorage.removeItem(storageKey);
    // Re-validated on the way out. The value was written by this app, but it round-tripped through
    // an OAuth redirect and `sessionStorage` is writable by anything running on this origin.
    return isSafeReturnTo(path) ? path : null;
  } catch {
    return null;
  }
}
