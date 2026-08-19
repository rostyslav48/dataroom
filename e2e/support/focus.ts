import type { Page } from '@playwright/test';
import { waitForProtectedShareResolves } from './shared-route';

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
 * No wait before the refocus, and that is now the point.
 *
 * This helper used to sit out a 10.5-second `staleTime` window first, because
 * `refetchOnWindowFocus` skips a query TanStack Query still considers fresh — so a refocus straight
 * after the deletion did nothing, and flow 5 was asserting on the far side of a gap the register
 * says must not exist. QA pinned the gap; the node queries now carry `staleTime: 0`
 * (`useNodeQueries.ts`), so the refetch happens on the first refocus and the wait would only hide
 * a regression.
 */
export async function simulateRefocus(page: Page): Promise<void> {
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
  await waitForProtectedShareResolves(page.context());
}
