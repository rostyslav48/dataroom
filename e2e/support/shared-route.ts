import { expect, test, type Page } from '@playwright/test';

/**
 * Opening a public link in a browser, against a real rate limiter.
 *
 * `GET /shared/:token` is throttled to **10 requests a minute per IP** — deliberately, because it
 * is the one unauthenticated data endpoint and an unthrottled one is a token-guessing oracle. The
 * whole suite runs from a single IP, every shared-route page load resolves the token, and
 * `refetchOnWindowFocus` resolves it again on every refocus. Across three specs that share the
 * quota, a later test reaches the screen that says "Too many requests" and fails while asserting
 * something entirely unrelated — which is how this was first seen: flow 5 passed alone and failed
 * in a full run.
 *
 * Waiting the window out is the only honest fix available to the suite. Lifting the limit for
 * tests would delete the coverage of the limiter; asserting "gone *or* rate-limited" would make
 * the assertion unfalsifiable. So: navigate, and if the limiter answered, sit out the window and
 * use the page's own retry.
 */
const RATE_LIMIT_WINDOW_MS = 60_000;

export async function gotoShared(page: Page, url: string): Promise<void> {
  await page.goto(url);

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const limited = page.getByText(/too many requests/i);
    // The screen renders as soon as the resolve answers; a short settle is enough to tell the two
    // outcomes apart without adding a second of latency to the common case.
    await page.waitForTimeout(300);
    if ((await limited.count()) === 0) return;

    // Sitting out a minute overruns the 60-second default timeout, and a test that dies mid-wait
    // reports a timeout rather than the limiter — so the budget is extended by exactly what the
    // wait costs, and only for the test that actually had to wait.
    test.info().setTimeout(test.info().timeout + RATE_LIMIT_WINDOW_MS + 5_000);

    await page.waitForTimeout(RATE_LIMIT_WINDOW_MS + 1_000);
    await page.getByRole('button', { name: /try again/i }).click();
  }

  await expect(
    page.getByText(/too many requests/i),
    'the public-link rate limit did not clear after waiting a full window',
  ).toHaveCount(0);
}
