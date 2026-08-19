import { expect, openAnonymous, routes, test, tokenFromShareUrl } from '../support/fixtures';
import { gotoShared } from '../support/shared-route';

/**
 * A QA finding, pinned as a test.
 *
 * `ProjectDesc/06-edge-cases.md` decides the "delete a folder someone is currently viewing" case
 * outright: *"viewer's next request (or focus-refetch) gets `410 ITEM_GONE` → `ShareGoneState` …
 * **Never a blank screen or a stale cache.**"* `queryClient.ts` sets `staleTime: 10_000` with
 * `refetchOnWindowFocus: true`, and TanStack Query skips a focus refetch entirely while the data
 * is still fresh — so for the first ten seconds after the deletion a refocus does nothing at all
 * and the viewer keeps reading a listing of a folder that no longer exists.
 *
 * Flow 5 does not catch this: `simulateRefocus` sits out the whole window before dispatching, so
 * every assertion there is made on the far side of it. That is the honest way to test the refetch
 * itself, but it leaves the window untested and invisible.
 *
 * This spec asserts the behaviour that ships **today**, deliberately, rather than the behaviour the
 * register promises — the same choice `00-harness.spec.ts` makes for the CCP-6 refresh grace
 * window. Pinning it means a fix (`refetchOnWindowFocus: 'always'`, or a shorter `staleTime` for
 * node queries) arrives as a failing test somebody must consciously update, instead of as a silent
 * difference between the register and the system. **If this test fails, the defect was fixed:
 * invert it.**
 *
 * Track: qa
 */

/** `staleTime` in `apps/web/src/lib/queryClient.ts`. */
const QUERY_STALE_WINDOW_MS = 10_000;

/** The refocus `support/focus.ts` performs, without its `staleTime` wait. */
async function refocusNow(page: import('@playwright/test').Page): Promise<void> {
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
    document.dispatchEvent(new Event('visibilitychange', { bubbles: true }));
    window.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('focus'));
  });
}

test.describe('QA finding — the staleTime window swallows the focus refetch', () => {
  test('a viewer who tabs back inside staleTime still sees the deleted folder', async ({
    browser,
    ownerApi,
    scratch,
  }) => {
    // The wait below outlasts the default 60s budget once the shared-route limiter is involved.
    test.setTimeout(120_000);

    const shareRoot = await ownerApi.createFolder(scratch.folder.id, 'Stale Window Root');
    const doomed = await ownerApi.createFolder(shareRoot.id, 'Doomed In Window');
    await ownerApi.createFolder(doomed.id, 'Child Of Doomed');

    const share = await ownerApi.createPublicLink(shareRoot.id);
    const token = tokenFromShareUrl(share.url);

    const viewer = await openAnonymous(browser);
    try {
      await gotoShared(viewer.page, routes.sharedFolder(token, doomed.id));
      await expect(viewer.ui.rowByName('Child Of Doomed')).toBeVisible();

      await ownerApi.remove(doomed.id);

      // ── inside the window: the refocus is a no-op ──────────────────────
      await refocusNow(viewer.page);

      // The listing is served from a cache TanStack Query still considers fresh. This is the
      // outcome the register rules out; it is asserted here so the gap is visible rather than
      // waited out.
      await expect(
        viewer.ui.rowByName('Child Of Doomed'),
        'inside staleTime the deleted folder is still on screen — see the note at the top',
      ).toBeVisible({ timeout: 3_000 });
      await expect(viewer.ui.state.itemGone).toHaveCount(0);

      // ── outside the window: the same refocus works ─────────────────────
      // Proves the difference is the freshness window and nothing else about the harness: the
      // events dispatched are identical, only the elapsed time changed.
      await viewer.page.waitForTimeout(QUERY_STALE_WINDOW_MS + 500);
      await refocusNow(viewer.page);

      await expect(viewer.ui.state.itemGone).toBeVisible({ timeout: 15_000 });
      await expect(viewer.ui.rowByName('Child Of Doomed')).toHaveCount(0);
    } finally {
      await viewer.context.close();
    }
  });
});
