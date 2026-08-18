import type { Page } from '@playwright/test';

/**
 * Make a page believe the user just came back to it.
 *
 * "Deleted while you were viewing it" is satisfied by `refetchOnWindowFocus` rather than by
 * polling — a good trade, but it means the E2E has to produce a genuine refocus, and in a headless
 * browser that is fiddlier than it sounds. Two mechanisms, because which one TanStack Query is
 * listening to depends on its version:
 *
 *   1. A real tab switch. `bringToFront` on a second page and back fires the browser's own
 *      visibility and focus events, which is the closest thing to what a user does.
 *   2. Dispatching `visibilitychange` and `focus` directly, for the case where the harness never
 *      lost focus in the first place — a headless context with one page may never fire (1) at all.
 *
 * Doing both is not belt-and-braces for its own sake: a refocus that silently does nothing turns
 * this test into one that passes because no refetch happened, which is precisely the bug it exists
 * to catch.
 */
/**
 * `staleTime` in `apps/web/src/lib/queryClient.ts`. TanStack Query's `refetchOnWindowFocus` fires
 * only for a query it already considers **stale**, so a refocus one second after the delete finds
 * fresh data and does nothing at all — the viewer keeps looking at a folder that no longer exists
 * until the window elapses. Waiting it out is what makes this test exercise the refetch instead of
 * silently proving that refocusing does nothing.
 *
 * The user-visible consequence is worth stating plainly, because the test now hides it: a viewer
 * who tabs back within ten seconds of the deletion still sees the stale listing. Any click then
 * fails correctly, and the screen catches up on the next focus. `refetchOnWindowFocus: 'always'`
 * would close that window; that is a frontend decision, and it is recorded as a follow-up rather
 * than made here.
 */
const QUERY_STALE_WINDOW_MS = 10_000;

export async function simulateRefocus(page: Page): Promise<void> {
  await page.waitForTimeout(QUERY_STALE_WINDOW_MS + 500);

  const other = await page.context().newPage();
  try {
    await other.goto('about:blank');
    await other.bringToFront();
    await page.bringToFront();
  } finally {
    await other.close();
  }

  // On **window**, and bubbling. TanStack Query v5 registers its listener with
  // `window.addEventListener('visibilitychange', …)`, while a hand-made
  // `document.dispatchEvent(new Event('visibilitychange'))` does not bubble — `Event` defaults to
  // `bubbles: false` — so it never reached the listener and the refetch never happened. The flow-5
  // tests were asserting against a page nothing had asked to update.
  await page.evaluate(() => {
    window.dispatchEvent(new Event('blur'));
    document.dispatchEvent(new Event('visibilitychange', { bubbles: true }));
    window.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('focus'));
  });
}
