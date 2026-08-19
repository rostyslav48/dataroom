import { expect, openAnonymous, routes, test, tokenFromShareUrl } from '../support/fixtures';
import { gotoShared } from '../support/shared-route';

/**
 * A QA finding, fixed — and this spec inverted to keep it fixed.
 *
 * ## What was found
 *
 * `ProjectDesc/06-edge-cases.md` decides the "delete a folder someone is currently viewing" case
 * outright: *"viewer's next request (or focus-refetch) gets `410 ITEM_GONE` → `ShareGoneState` …
 * **Never a blank screen or a stale cache.**"* `queryClient.ts` set `staleTime: 10_000` with
 * `refetchOnWindowFocus: true`, and TanStack Query skips a focus refetch entirely while the data is
 * still fresh — so for the first ten seconds after the deletion a refocus did nothing at all and the
 * viewer kept reading a listing of a folder that no longer existed.
 *
 * Flow 5 did not catch it: `simulateRefocus` sat out the whole window before dispatching, so every
 * assertion there was made on the far side of the gap. QA wrote this spec asserting the behaviour
 * that shipped, deliberately, so that a fix would arrive as a failing test somebody had to update
 * rather than as a silent divergence — and left the instruction: *if this test fails, the defect was
 * fixed: invert it.*
 *
 * ## What changed
 *
 * `useNodeDetail` and `useChildren` now carry `staleTime: 0`, so a refocus refetches immediately.
 * The window is gone, and this spec asserts its absence: the same refocus that used to be a no-op
 * inside ten seconds must now produce the gone state. `simulateRefocus` no longer waits, either, so
 * flow 5 exercises the same path rather than stepping around it.
 *
 * The narrow scope matters and is asserted below: the fix is on the node reads only. `/shared/:token`
 * is rate-limited to 10 requests a minute per IP, and refetching *that* on every focus would spend
 * the budget on a value that does not change.
 *
 * Track: qa
 */

/** The refocus `support/focus.ts` performs — inlined so this spec keeps testing it directly. */
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

test.describe('the staleTime window that swallowed the focus refetch is closed', () => {
  test('a viewer who tabs back immediately gets the gone state, with no window to wait out', async ({
    browser,
    ownerApi,
    scratch,
  }) => {
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

      // No wait of any kind between the deletion and the refocus. This is the assertion the
      // register's "never a stale cache" actually amounts to, and the one that used to fail.
      await refocusNow(viewer.page);

      await expect(
        viewer.ui.state.itemGone,
        'a refocus straight after the deletion must refetch — see the note at the top',
      ).toBeVisible({ timeout: 10_000 });
      await expect(viewer.ui.rowByName('Child Of Doomed')).toHaveCount(0);
    } finally {
      await viewer.context.close();
    }
  });

  test('the share resolve is still cached, so refocusing does not spend the rate limit', async ({
    browser,
    ownerApi,
    scratch,
  }) => {
    const shareRoot = await ownerApi.createFolder(scratch.folder.id, 'Quota Root');
    await ownerApi.createFolder(shareRoot.id, 'Contents');
    const share = await ownerApi.createPublicLink(shareRoot.id);
    const token = tokenFromShareUrl(share.url);

    const viewer = await openAnonymous(browser);
    const resolves: string[] = [];
    viewer.page.on('request', (request) => {
      if (request.url().includes('/shared/')) resolves.push(request.url());
    });

    try {
      await gotoShared(viewer.page, routes.sharedEntry(token));
      await expect(viewer.ui.rowByName('Contents')).toBeVisible();
      const afterLoad = resolves.length;

      // Four refocuses in quick succession. The node queries refetch every time — that is the fix
      // above — while the token resolve stays inside its own freshness window. If this ever starts
      // failing, the whole suite is about to become flaky against the 10/min/IP limiter, and the
      // shared routes will start rate-limiting real users who alt-tab.
      for (let i = 0; i < 4; i += 1) await refocusNow(viewer.page);
      await viewer.page.waitForTimeout(500);

      expect(
        resolves.length - afterLoad,
        'refocusing must not re-resolve the share token',
      ).toBe(0);
      await expect(viewer.ui.rowByName('Contents')).toBeVisible();
    } finally {
      await viewer.context.close();
    }
  });
});
