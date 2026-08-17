import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { API_BASE, endpoints, fixtures, SHARE_TOKEN_HEADER } from '@dataroom/contracts';
import {
  ApiClientError,
  apiRequest,
  buildPath,
  buildUrl,
  isApiClientError,
  resetApiClientState,
  setSessionExpiredHandler,
} from './api';
import { tokenStore } from './tokenStore';

const ORIGIN = 'http://localhost:3000';

interface FetchCall {
  url: string;
  init: RequestInit;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function errorResponse(code: string, status: number): Response {
  return jsonResponse({ code, message: 'nope', requestId: 'req-1' }, status);
}

function session(): unknown {
  return {
    user: fixtures.users.owner,
    accessToken: 'fresh-token',
    accessTokenExpiresAt: '2026-01-15T10:15:00.000Z',
  };
}

let calls: FetchCall[] = [];

function mockFetch(handler: (url: string, init: RequestInit) => Response | Promise<Response>): void {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = String(input);
      calls.push({ url, init });
      return Promise.resolve(handler(url, init));
    }),
  );
}

beforeEach(() => {
  calls = [];
  vi.stubEnv('VITE_API_URL', ORIGIN);
  tokenStore.clear();
  resetApiClientState();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  tokenStore.clear();
  resetApiClientState();
});

describe('buildPath', () => {
  it('substitutes and encodes path parameters', () => {
    expect(buildPath('/nodes/:id/children', { id: 'a b' })).toBe('/nodes/a%20b/children');
  });

  it('throws when a parameter is missing rather than requesting a literal ":id"', () => {
    expect(() => buildPath('/nodes/:id')).toThrow(/Missing path parameter "id"/);
  });
});

describe('buildUrl', () => {
  it('prefixes the API origin and base path', () => {
    expect(buildUrl(endpoints.auth.me)).toBe(`${ORIGIN}${API_BASE}/me`);
  });

  it('appends defined query parameters and drops undefined ones', () => {
    const url = buildUrl(endpoints.nodes.children, { id: 'n1' }, { sort: 'name', cursor: undefined });
    expect(url).toBe(`${ORIGIN}${API_BASE}/nodes/n1/children?sort=name`);
  });
});

describe('apiRequest — success path', () => {
  it('parses the response with its schema and returns typed data', async () => {
    mockFetch(() => jsonResponse(fixtures.users.owner));
    const me = await apiRequest({ endpoint: endpoints.auth.me, schema: z.object({ id: z.string() }).passthrough() });
    expect(me.id).toBe(fixtures.users.owner.id);
    expect(calls[0]?.init.credentials).toBe('include');
  });

  it('attaches the in-memory access token as a bearer header', async () => {
    tokenStore.set('token-abc', '2026-01-15T10:15:00.000Z');
    mockFetch(() => jsonResponse(fixtures.users.owner));
    await apiRequest({ endpoint: endpoints.auth.me, schema: z.unknown() });
    const headers = calls[0]?.init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer token-abc');
  });

  it('attaches X-Share-Token when browsing a public link', async () => {
    mockFetch(() => jsonResponse(fixtures.nodes.financials));
    await apiRequest({
      endpoint: endpoints.nodes.get,
      params: { id: fixtures.IDS.folderFin },
      schema: z.unknown(),
      shareToken: fixtures.PUBLIC_LINK_TOKEN,
    });
    const headers = calls[0]?.init.headers as Record<string, string>;
    expect(headers[SHARE_TOKEN_HEADER]).toBe(fixtures.PUBLIC_LINK_TOKEN);
  });

  it('accepts an empty 204 body for endpoints that return no content', async () => {
    mockFetch(() => new Response(null, { status: 204 }));
    await expect(
      apiRequest({ endpoint: endpoints.nodes.remove, params: { id: 'n1' }, schema: z.void() }),
    ).resolves.toBeUndefined();
  });

  it('never writes the token to localStorage or sessionStorage', async () => {
    const localSpy = vi.spyOn(Storage.prototype, 'setItem');
    tokenStore.set('secret-token', '2026-01-15T10:15:00.000Z');
    mockFetch(() => jsonResponse(fixtures.users.owner));
    await apiRequest({ endpoint: endpoints.auth.me, schema: z.unknown() });
    expect(localSpy).not.toHaveBeenCalled();
    expect(window.localStorage.getItem('accessToken')).toBeNull();
    expect(window.sessionStorage.getItem('accessToken')).toBeNull();
    expect(JSON.stringify(window.localStorage)).not.toContain('secret-token');
    expect(JSON.stringify(window.sessionStorage)).not.toContain('secret-token');
    localSpy.mockRestore();
  });
});

describe('apiRequest — failures', () => {
  it('throws ApiClientError carrying the contract code, details and requestId', async () => {
    mockFetch(() =>
      jsonResponse(
        { code: 'NAME_CONFLICT', message: 'taken', details: { name: ['taken'] }, requestId: 'req-9' },
        409,
      ),
    );
    const error = await apiRequest({
      endpoint: endpoints.nodes.rename,
      params: { id: 'n1' },
      schema: z.unknown(),
      body: { name: 'Legal' },
    }).catch((e: unknown) => e);

    expect(isApiClientError(error)).toBe(true);
    const apiError = error as ApiClientError;
    expect(apiError.code).toBe('NAME_CONFLICT');
    expect(apiError.status).toBe(409);
    expect(apiError.details).toEqual({ name: ['taken'] });
    expect(apiError.requestId).toBe('req-9');
  });

  it('throws ApiClientError — not a render crash — when the body fails its schema', async () => {
    mockFetch(() => jsonResponse({ id: 42 }));
    const error = await apiRequest({
      endpoint: endpoints.auth.me,
      schema: z.object({ id: z.string() }),
    }).catch((e: unknown) => e);

    expect(isApiClientError(error)).toBe(true);
    expect((error as ApiClientError).contractViolation).toBe(true);
    expect((error as ApiClientError).code).toBe('INTERNAL');
  });

  it('flags a transport failure as a network error rather than a server error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))),
    );
    const error = await apiRequest({ endpoint: endpoints.auth.me, schema: z.unknown() }).catch(
      (e: unknown) => e,
    );
    expect((error as ApiClientError).networkError).toBe(true);
  });

  it('treats an unparseable error body as a contract violation, not a crash', async () => {
    mockFetch(() => new Response('<html>502</html>', { status: 502 }));
    const error = await apiRequest({ endpoint: endpoints.auth.me, schema: z.unknown() }).catch(
      (e: unknown) => e,
    );
    expect((error as ApiClientError).code).toBe('INTERNAL');
    expect((error as ApiClientError).contractViolation).toBe(true);
  });
});

describe('apiRequest — 401 handling', () => {
  it('refreshes once and replays the request', async () => {
    let meCalls = 0;
    mockFetch((url) => {
      if (url.endsWith('/auth/refresh')) return jsonResponse(session());
      meCalls += 1;
      return meCalls === 1 ? errorResponse('UNAUTHENTICATED', 401) : jsonResponse(fixtures.users.owner);
    });

    const me = await apiRequest({
      endpoint: endpoints.auth.me,
      schema: z.object({ id: z.string() }).passthrough(),
    });

    expect(me.id).toBe(fixtures.users.owner.id);
    expect(calls.filter((c) => c.url.endsWith('/auth/refresh'))).toHaveLength(1);
    expect(tokenStore.get()).toBe('fresh-token');
  });

  it('six concurrent 401s trigger exactly one refresh', async () => {
    const seen = new Map<string, number>();
    mockFetch((url) => {
      if (url.endsWith('/auth/refresh')) {
        return jsonResponse(session());
      }
      const count = (seen.get(url) ?? 0) + 1;
      seen.set(url, count);
      return count === 1 ? errorResponse('UNAUTHENTICATED', 401) : jsonResponse(fixtures.nodes.root);
    });

    const ids = ['n1', 'n2', 'n3', 'n4', 'n5', 'n6'];
    await Promise.all(
      ids.map((id) =>
        apiRequest({ endpoint: endpoints.nodes.get, params: { id }, schema: z.unknown() }),
      ),
    );

    expect(calls.filter((c) => c.url.endsWith('/auth/refresh'))).toHaveLength(1);
  });

  it('clears the token and notifies the session-expired handler when refresh fails', async () => {
    tokenStore.set('stale', '2026-01-15T10:15:00.000Z');
    const onExpired = vi.fn();
    setSessionExpiredHandler(onExpired);
    mockFetch((url) =>
      url.endsWith('/auth/refresh')
        ? errorResponse('UNAUTHENTICATED', 401)
        : errorResponse('UNAUTHENTICATED', 401),
    );

    await expect(apiRequest({ endpoint: endpoints.auth.me, schema: z.unknown() })).rejects.toThrow();
    expect(tokenStore.get()).toBeNull();
    expect(onExpired).toHaveBeenCalledTimes(1);
  });

  it('does not attempt a refresh for a 401 on the refresh endpoint itself', async () => {
    mockFetch(() => errorResponse('UNAUTHENTICATED', 401));
    await expect(
      apiRequest({ endpoint: endpoints.auth.refresh, schema: z.unknown() }),
    ).rejects.toThrow();
    expect(calls).toHaveLength(1);
  });

  it('does not refresh on a 403 that merely looks like an auth failure', async () => {
    mockFetch(() => errorResponse('FORBIDDEN', 403));
    const error = await apiRequest({ endpoint: endpoints.auth.me, schema: z.unknown() }).catch(
      (e: unknown) => e,
    );
    expect((error as ApiClientError).code).toBe('FORBIDDEN');
    expect(calls.filter((c) => c.url.endsWith('/auth/refresh'))).toHaveLength(0);
  });

  it('gives up after one replay when the replayed request is still 401', async () => {
    const onExpired = vi.fn();
    setSessionExpiredHandler(onExpired);
    mockFetch((url) =>
      url.endsWith('/auth/refresh') ? jsonResponse(session()) : errorResponse('UNAUTHENTICATED', 401),
    );

    await expect(apiRequest({ endpoint: endpoints.auth.me, schema: z.unknown() })).rejects.toThrow();
    expect(calls.filter((c) => c.url.endsWith('/me'))).toHaveLength(2);
    expect(onExpired).toHaveBeenCalledTimes(1);
  });
});
