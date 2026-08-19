import {
  test,
  type APIRequestContext,
  type APIResponse,
  type BrowserContext,
  type Page,
} from '@playwright/test';

/**
 * Coordination for the real public-link rate limiter.
 *
 * `GET /shared/:token` is throttled to **10 requests a minute per IP** — deliberately, because it
 * is the one unauthenticated data endpoint and an unthrottled one is a token-guessing oracle. The
 * whole suite runs from a single IP, and the quota is shared by browser pages and direct API
 * contexts. Guarding only `page.goto()` is insufficient: a stale-query refetch, reload, second page
 * or an API assertion can be the request that receives 429.
 *
 * Every resolve still reaches the production endpoint and its production limiter. The coordinator
 * serializes callers, learns the remaining quota from the real response headers, waits before a
 * request when the previous response exhausted the window, and retries behind the harness if a
 * prior Playwright run already consumed the quota. `RATE_LIMITED` therefore never becomes an
 * alternate acceptable product result.
 */
const SHARE_RESOLVE_ROUTE = '**/api/v1/shared/**';
const FALLBACK_RETRY_MS = 61_000;
const WINDOW_BOUNDARY_BUFFER_MS = 1_000;
const MAX_RATE_LIMIT_RECOVERIES = 3;

interface RateLimitedResponse {
  status(): number;
  headers(): Record<string, string>;
}

function header(response: RateLimitedResponse, name: string): string | undefined {
  const wanted = name.toLowerCase();
  const entry = Object.entries(response.headers()).find(([key]) => key.toLowerCase() === wanted);
  return entry?.[1];
}

function secondsHeader(response: RateLimitedResponse, name: string): number | undefined {
  const parsed = Number(header(response, name));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function isShareResolveUrl(url: string): boolean {
  try {
    return /^\/api\/v1\/shared\/[^/]+\/?$/.test(new URL(url).pathname);
  } catch {
    return false;
  }
}

function extendTimeoutFor(waitMs: number): void {
  if (waitMs <= 0) return;
  const info = test.info();
  info.setTimeout(info.timeout + waitMs + 5_000);
}

async function wait(waitMs: number): Promise<void> {
  if (waitMs <= 0) return;
  extendTimeoutFor(waitMs);
  await new Promise((resolve) => setTimeout(resolve, waitMs));
}

class ShareResolveCoordinator {
  private next = Promise.resolve();
  private blockedUntil = 0;

  run<Response extends RateLimitedResponse>(send: () => Promise<Response>): Promise<Response> {
    const result = this.next.then(() => this.sendWhenAllowed(send));
    this.next = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private async sendWhenAllowed<Response extends RateLimitedResponse>(
    send: () => Promise<Response>,
  ): Promise<Response> {
    for (let recovery = 0; recovery <= MAX_RATE_LIMIT_RECOVERIES; recovery += 1) {
      await wait(Math.max(0, this.blockedUntil - Date.now()));

      const response = await send();
      if (response.status() !== 429) {
        this.rememberExhaustedWindow(response);
        return response;
      }

      if (recovery === MAX_RATE_LIMIT_RECOVERIES) {
        throw new Error(
          `GET /shared/:token remained rate-limited after ${MAX_RATE_LIMIT_RECOVERIES} recoveries`,
        );
      }

      const retrySeconds = secondsHeader(response, 'retry-after-share');
      const retryMs =
        retrySeconds === undefined
          ? FALLBACK_RETRY_MS
          : retrySeconds * 1_000 + (retrySeconds > 0 ? WINDOW_BOUNDARY_BUFFER_MS : 0);
      this.blockedUntil = Math.max(this.blockedUntil, Date.now() + retryMs);
    }

    throw new Error('unreachable share-resolve recovery state');
  }

  private rememberExhaustedWindow(response: RateLimitedResponse): void {
    if (secondsHeader(response, 'x-ratelimit-remaining-share') !== 0) return;

    const resetSeconds = secondsHeader(response, 'x-ratelimit-reset-share');
    const resetMs =
      resetSeconds === undefined
        ? FALLBACK_RETRY_MS
        : resetSeconds * 1_000 + (resetSeconds > 0 ? WINDOW_BOUNDARY_BUFFER_MS : 0);
    this.blockedUntil = Math.max(this.blockedUntil, Date.now() + resetMs);
  }
}

const coordinator = new ShareResolveCoordinator();
const protectedBrowserContexts = new WeakSet<BrowserContext>();
const pendingBrowserResolves = new WeakMap<BrowserContext, Set<Promise<void>>>();

/** Install once on a context, before any page can issue a share resolve. */
export async function protectShareResolveBrowserContext(context: BrowserContext): Promise<void> {
  if (protectedBrowserContexts.has(context)) return;
  protectedBrowserContexts.add(context);
  const pending = new Set<Promise<void>>();
  pendingBrowserResolves.set(context, pending);

  await context.route(SHARE_RESOLVE_ROUTE, (route) => {
    const handled = (async (): Promise<void> => {
      const request = route.request();
      if (request.method() !== 'GET' || !isShareResolveUrl(request.url())) {
        await route.fallback();
        return;
      }

      const response = await coordinator.run(() => route.fetch());
      await route.fulfill({ response });
    })();
    pending.add(handled);
    void handled.then(
      () => pending.delete(handled),
      () => pending.delete(handled),
    );
    return handled;
  });
}

/** Wait for refetches already triggered by a harness action, including a limiter cooldown. */
export async function waitForProtectedShareResolves(context: BrowserContext): Promise<void> {
  const pending = pendingBrowserResolves.get(context);
  if (pending === undefined) return;

  // React Query starts a focus refetch in a microtask after the event handler returns.
  await new Promise((resolve) => setTimeout(resolve, 0));
  while (pending.size > 0) {
    await Promise.all([...pending]);
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

/**
 * Wrap an API request context so `Api`, `expectDenied`, and even `.raw.get()` share the same guard.
 */
export function protectShareResolveApiContext(context: APIRequestContext): APIRequestContext {
  const guardedGet: APIRequestContext['get'] = async (url, options) => {
    const send = (): Promise<APIResponse> => context.get(url, options);
    return isShareResolveUrl(url) ? coordinator.run(send) : send();
  };

  return new Proxy(context, {
    get(target, property) {
      if (property === 'get') return guardedGet;
      const value = Reflect.get(target, property, target) as unknown;
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

export async function gotoShared(page: Page, url: string): Promise<void> {
  // All suite-created contexts are protected at construction. Keep this idempotent call as a
  // safety net for a future spec that passes a context it created directly.
  await protectShareResolveBrowserContext(page.context());
  const resolved = page.waitForResponse(
    (response) =>
      response.request().method() === 'GET' && isShareResolveUrl(response.request().url()),
    { timeout: 0 },
  );
  await Promise.all([resolved, page.goto(url)]);
}
