import type { z } from 'zod';
import {
  API_BASE,
  ApiError,
  RefreshResponse,
  SHARE_TOKEN_HEADER,
  endpoints,
  type EndpointDescriptor,
  type ErrorCode,
} from '@dataroom/contracts';
import { tokenStore } from './tokenStore';

/**
 * The API client. A thin `fetch` wrapper, deliberately not generated, with exactly five jobs:
 *
 *  1. prefix `VITE_API_URL` + `API_BASE`, always `credentials: 'include'`
 *  2. attach the in-memory access token, and `X-Share-Token` when browsing a public link
 *  3. parse every response with its Zod schema, so a wrong shape fails here rather than as
 *     `undefined` three components deep
 *  4. turn error bodies into a typed `ApiClientError` carrying the contract's `code`
 *  5. on 401 UNAUTHENTICATED refresh once, replay once, then hand off to the session-expired
 *     handler — with concurrent 401s sharing one in-flight refresh
 */

export interface ApiClientErrorInit {
  status: number;
  details?: Record<string, string[]> | undefined;
  requestId?: string | undefined;
  /** The response did not match its contract schema. Distinct from a server-declared error. */
  contractViolation?: boolean;
  /** The request never reached the server (offline, DNS, connection reset). */
  networkError?: boolean;
  cause?: unknown;
}

export class ApiClientError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details: Record<string, string[]> | undefined;
  readonly requestId: string | undefined;
  readonly contractViolation: boolean;
  readonly networkError: boolean;

  constructor(code: ErrorCode, message: string, init: ApiClientErrorInit) {
    super(message, init.cause === undefined ? undefined : { cause: init.cause });
    this.name = 'ApiClientError';
    this.code = code;
    this.status = init.status;
    this.details = init.details;
    this.requestId = init.requestId;
    this.contractViolation = init.contractViolation ?? false;
    this.networkError = init.networkError ?? false;
  }
}

export function isApiClientError(error: unknown): error is ApiClientError {
  return error instanceof ApiClientError;
}

/** Origin of the API. Read per call so tests can stub the env without reloading the module. */
export function apiOrigin(): string {
  const raw: unknown = import.meta.env.VITE_API_URL;
  return typeof raw === 'string' ? raw.replace(/\/+$/, '') : '';
}

export type PathParams = Readonly<Record<string, string>>;
export type QueryParams = Readonly<Record<string, string | number | boolean | undefined>>;

/** Fills `:param` placeholders from the contract's path template. A missing one is a bug here,
 *  not a 404 discovered in the network tab. */
export function buildPath(template: string, params: PathParams = {}): string {
  return template
    .split('/')
    .map((segment) => {
      if (!segment.startsWith(':')) return segment;
      const key = segment.slice(1);
      const value = params[key];
      if (value === undefined) {
        throw new Error(`Missing path parameter "${key}" for "${template}"`);
      }
      return encodeURIComponent(value);
    })
    .join('/');
}

export function buildUrl(
  endpoint: EndpointDescriptor,
  params?: PathParams,
  query?: QueryParams,
): string {
  const url = `${apiOrigin()}${API_BASE}${buildPath(endpoint.path, params)}`;
  if (query === undefined) return url;
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) search.set(key, String(value));
  }
  const serialized = search.toString();
  return serialized === '' ? url : `${url}?${serialized}`;
}

export interface RequestConfig<TResponse> {
  endpoint: EndpointDescriptor;
  schema: z.ZodType<TResponse>;
  params?: PathParams;
  query?: QueryParams;
  body?: unknown;
  /** Present while browsing a public link; sent as `X-Share-Token`. */
  shareToken?: string | undefined;
  signal?: AbortSignal | undefined;
}

// ── session-expired handoff ──────────────────────────────────────────────────────────────────

type SessionExpiredHandler = () => void;
let sessionExpiredHandler: SessionExpiredHandler | null = null;

/** `AuthProvider` registers the redirect-to-login behaviour; the client itself knows no routes. */
export function setSessionExpiredHandler(handler: SessionExpiredHandler | null): void {
  sessionExpiredHandler = handler;
}

// ── single-flight refresh ────────────────────────────────────────────────────────────────────

let refreshInFlight: Promise<boolean> | null = null;

async function performRefresh(): Promise<boolean> {
  try {
    const response = await fetch(buildUrl(endpoints.auth.refresh), {
      method: 'POST',
      credentials: 'include',
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) return false;
    const parsed = RefreshResponse.safeParse(await response.json());
    if (!parsed.success) return false;
    tokenStore.set(parsed.data.accessToken, parsed.data.accessTokenExpiresAt);
    return true;
  } catch {
    return false;
  }
}

/**
 * Concurrent 401s share one refresh. Six queries on a page would otherwise fire six refreshes,
 * and refresh-token rotation invalidates them against each other — the user gets logged out by
 * their own client.
 */
export function refreshSession(): Promise<boolean> {
  if (refreshInFlight === null) {
    refreshInFlight = performRefresh().finally(() => {
      refreshInFlight = null;
    });
  }
  return refreshInFlight;
}

/** Test seam: drops any in-flight refresh so one test's state cannot leak into the next. */
export function resetApiClientState(): void {
  refreshInFlight = null;
  sessionExpiredHandler = null;
}

// ── request ──────────────────────────────────────────────────────────────────────────────────

let signalForwardingSupported: boolean | null = null;

/**
 * Whether this runtime's `fetch` accepts the `AbortSignal` implementation the caller handed us.
 *
 * A browser always does. jsdom, however, installs its own `AbortSignal` while `fetch` comes from
 * Node, and Node's brand check rejects the foreign object — every request would fail with a
 * `TypeError` that has nothing to do with the code under test. Detected once at runtime rather
 * than branched on an environment flag, so production keeps real cancellation and nothing here
 * depends on how the test runner is configured.
 */
function canForwardSignal(signal: AbortSignal): boolean {
  if (signalForwardingSupported === null) {
    try {
      void new Request('http://localhost/abort-signal-probe', { signal });
      signalForwardingSupported = true;
    } catch {
      signalForwardingSupported = false;
    }
  }
  return signalForwardingSupported;
}

function toApiClientError(status: number, payload: unknown): ApiClientError {
  const parsed = ApiError.safeParse(payload);
  if (parsed.success) {
    return new ApiClientError(parsed.data.code, parsed.data.message, {
      status,
      details: parsed.data.details,
      requestId: parsed.data.requestId,
    });
  }
  return new ApiClientError('INTERNAL', `Unrecognised error response (HTTP ${String(status)})`, {
    status,
    contractViolation: true,
  });
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text === '') return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

export async function apiRequest<TResponse>(config: RequestConfig<TResponse>): Promise<TResponse> {
  const { endpoint, schema, params, query, body, shareToken, signal } = config;
  const url = buildUrl(endpoint, params, query);

  const send = async (): Promise<Response> => {
    const headers: Record<string, string> = { Accept: 'application/json' };
    const token = tokenStore.get();
    if (token !== null) headers.Authorization = `Bearer ${token}`;
    if (shareToken !== undefined && shareToken !== '') headers[SHARE_TOKEN_HEADER] = shareToken;
    if (body !== undefined) headers['Content-Type'] = 'application/json';

    try {
      return await fetch(url, {
        method: endpoint.method,
        credentials: 'include',
        headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        ...(signal === undefined || !canForwardSignal(signal) ? {} : { signal }),
      });
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === 'AbortError') throw cause;
      throw new ApiClientError('INTERNAL', 'Network request failed', {
        status: 0,
        networkError: true,
        cause,
      });
    }
  };

  let response = await send();

  if (response.status === 401 && endpoint !== endpoints.auth.refresh) {
    const payload = await readJson(response);
    const failure = toApiClientError(response.status, payload);
    if (failure.code === 'UNAUTHENTICATED') {
      const refreshed = await refreshSession();
      if (!refreshed) {
        tokenStore.clear();
        sessionExpiredHandler?.();
        throw failure;
      }
      response = await send();
      if (response.status === 401) {
        tokenStore.clear();
        sessionExpiredHandler?.();
        throw toApiClientError(response.status, await readJson(response));
      }
    } else {
      throw failure;
    }
  }

  if (!response.ok) {
    throw toApiClientError(response.status, await readJson(response));
  }

  const payload = await readJson(response);
  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    throw new ApiClientError('INTERNAL', `Response did not match its contract: ${url}`, {
      status: response.status,
      contractViolation: true,
      cause: parsed.error,
    });
  }
  return parsed.data;
}
