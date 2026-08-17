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
export async function simulateRefocus(page: Page): Promise<void> {
  const other = await page.context().newPage();
  try {
    await other.goto('about:blank');
    await other.bringToFront();
    await page.bringToFront();
  } finally {
    await other.close();
  }

  await page.evaluate(() => {
    window.dispatchEvent(new Event('blur'));
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('focus'));
  });
}
