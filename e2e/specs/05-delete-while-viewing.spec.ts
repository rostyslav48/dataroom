import {
  expect,
  openAnonymous,
  openAs,
  routes,
  test,
  tokenFromShareUrl,
} from '../support/fixtures';
import { simulateRefocus } from '../support/focus';

/**
 * FLOW 5 — delete a folder in context A while context B is viewing it → B refocuses → the gone
 * state renders.
 *
 * The second flow the requirements name outright, and the one with the most ways to fail quietly.
 * What must *not* happen is more specific than "an error appears":
 *
 *   - Not a blank screen. Not a spinner that never resolves. Not a crashed error boundary.
 *   - Not a **stale list** either. A viewer still browsing a folder that no longer exists, from
 *     cache, is the worst outcome available: it looks like everything is fine.
 *   - `410 ITEM_GONE`, not `404 NOT_FOUND`. The two are separated on purpose — the item existed a
 *     moment ago, and telling the user it was deleted is a different sentence from telling them it
 *     never existed.
 *   - Below the share root, a route back to the root. At the root, a terminal page, because there
 *     is nowhere left to go.
 *
 * Two contexts, one database, no coordination between them — which is exactly the situation the
 * requirement describes.
 */

test.describe('flow 5 — deleted while viewing', () => {
  test('a viewer browsing a folder gets the gone state when the owner deletes it', async ({
    browser,
    ownerApi,
    anonymousApi,
    scratch,
  }) => {
    const shareRoot = await ownerApi.createFolder(scratch.folder.id, 'Live Room');
    const doomed = await ownerApi.createFolder(shareRoot.id, 'Doomed');
    await ownerApi.createFolder(doomed.id, 'Child Of Doomed');

    const share = await ownerApi.createPublicLink(shareRoot.id);
    const token = tokenFromShareUrl(share.url);

    const viewer = await openAnonymous(browser);
    try {
      // ── B is looking at it ─────────────────────────────────────────────
      await viewer.page.goto(routes.sharedFolder(token, doomed.id));
      await expect(viewer.ui.rowByName('Child Of Doomed')).toBeVisible();

      // ── A deletes it ───────────────────────────────────────────────────
      await ownerApi.remove(doomed.id);

      // ── B comes back to the tab ────────────────────────────────────────
      await simulateRefocus(viewer.page);

      await expect(viewer.ui.state.itemGone).toBeVisible({ timeout: 15_000 });
      // Not a stale list behind the message, and not a crash instead of one.
      await expect(viewer.ui.rowByName('Child Of Doomed')).toHaveCount(0);

      // There is somewhere to go: the share root is still alive.
      const backToRoot = viewer.page.getByRole('link', { name: /live room|back|share/i }).first();
      await expect(backToRoot).toBeVisible();
      await backToRoot.click();
      await expect(viewer.ui.rowByName('Doomed')).toHaveCount(0);

      // ── the wire agrees, and says gone rather than missing ─────────────
      const anon = await anonymousApi(token);
      await anon.expectDenied('get', `/nodes/${doomed.id}`, 'ITEM_GONE');
      await anon.expectDenied('get', `/nodes/${doomed.id}/children`, 'ITEM_GONE');
      // The cascade reached the grandchild too, in the same transaction.
      const remaining = await anon.children(shareRoot.id);
      expect(remaining.items.map((item) => item.name)).not.toContain('Doomed');
    } finally {
      await viewer.context.close();
    }
  });

  test('deleting the share root itself is terminal, and auto-revokes the share', async ({
    browser,
    ownerApi,
    anonymousApi,
    scratch,
  }) => {
    const shareRoot = await ownerApi.createFolder(scratch.folder.id, 'Doomed Root');
    await ownerApi.createFolder(shareRoot.id, 'Contents');
    const share = await ownerApi.createPublicLink(shareRoot.id);
    const token = tokenFromShareUrl(share.url);

    const viewer = await openAnonymous(browser);
    try {
      await viewer.page.goto(routes.sharedEntry(token));
      await expect(viewer.ui.rowByName('Contents')).toBeVisible();

      // The delete preview warns that a live share is about to be destroyed — the count is part of
      // the blast radius, and a confirmation that omits it understates what is being lost.
      const preview = await ownerApi.deletePreview(shareRoot.id);
      expect(preview.affectedShareCount).toBeGreaterThanOrEqual(1);

      await ownerApi.remove(shareRoot.id);
      await simulateRefocus(viewer.page);

      await expect(viewer.ui.state.itemGone.or(viewer.ui.state.notFound)).toBeVisible({
        timeout: 15_000,
      });

      // Deleting a subtree auto-revokes every share rooted inside it, so the link is dead rather
      // than merely pointing at a dead node.
      const revoked = (await ownerApi.sharesOf(shareRoot.id)).shares.find((s) => s.id === share.id);
      expect(revoked?.revokedAt ?? null, 'the share should have been auto-revoked').not.toBeNull();

      const anon = await anonymousApi(token);
      await anon.expectDenied('get', `/shared/${token}`, 'NOT_FOUND');
    } finally {
      await viewer.context.close();
    }
  });

  /**
   * The same race one level up: a share whose root is deleted must be dead even where the requested
   * node itself is still standing.
   *
   * This is the cell of the permission matrix most likely to be got wrong by an implementation that
   * checks "is the node I asked for alive?" and stops there. If the join on the share root ever
   * loses its `deleted_at IS NULL`, a deleted folder keeps serving its contents to whoever holds
   * the link, and nothing on either screen would look wrong.
   */
  test('a share whose root was deleted grants nothing, even for a descendant that survives', async ({
    ownerApi,
    anonymousApi,
    scratch,
  }) => {
    const shareRoot = await ownerApi.createFolder(scratch.folder.id, 'Root To Delete');
    const descendant = await ownerApi.createFolder(shareRoot.id, 'Survivor');
    const share = await ownerApi.createPublicLink(shareRoot.id);
    const token = tokenFromShareUrl(share.url);

    const before = await anonymousApi(token);
    expect((await before.node(descendant.id)).access).toBe('viewer');

    await ownerApi.remove(shareRoot.id);

    const after = await anonymousApi(token);
    await after.expectDenied('get', `/nodes/${descendant.id}`, 'ITEM_GONE');
  });

  test('an owner deleting in one tab sees the gone state in the other', async ({
    browser,
    ownerApi,
    room,
    scratch,
  }) => {
    const doomed = await ownerApi.createFolder(scratch.folder.id, 'Owner Doomed');
    await ownerApi.createFolder(doomed.id, 'Inside');

    const owner = await openAs(browser, 'owner');
    try {
      const first = owner.page;
      const second = await owner.context.newPage();

      await first.goto(routes.folder(room.room.id, doomed.id));
      await expect(owner.ui.rowByName('Inside')).toBeVisible();

      // A second tab, same session, deletes it out from under the first.
      await second.goto(routes.folder(room.room.id, scratch.folder.id));
      await second.close();
      await ownerApi.remove(doomed.id);

      await simulateRefocus(first);
      await expect(owner.ui.state.itemGone).toBeVisible({ timeout: 15_000 });
      await expect(owner.ui.rowByName('Inside')).toHaveCount(0);
    } finally {
      await owner.context.close();
    }
  });
});
