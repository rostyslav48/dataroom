import { fixtures } from '../support/contracts';
import {
  expect,
  openAnonymous,
  openAs,
  routes,
  test,
  tokenFromShareUrl,
} from '../support/fixtures';
import { gotoShared } from '../support/shared-route';

/**
 * FLOW 3 — share a nested folder by public link → open it in a clean browser context → the subtree
 * is readable, the parent is not, breadcrumbs start at the share root → revoke → the next
 * navigation is denied.
 *
 * One of the two flows the requirements name outright, and the one this product exists to get
 * right. Four separate promises are load-bearing here, and each fails silently rather than loudly:
 *
 *   1. The subtree is readable **with no session at all** — a recipient is not a user.
 *   2. The share root's *parent* is not reachable, and its ancestors' **names** never appear. In a
 *      due-diligence room the folder structure above the share is itself confidential.
 *   3. Revocation takes effect on the **very next request**. Nothing is cached, so there is no
 *      window in which a revoked link still works.
 *   4. `ACCESS_REVOKED` is distinct from `FORBIDDEN`. The user needs to know whether to ask for the
 *      link again or give up, and the frontend renders a different screen for each.
 *
 * The clean context is not decoration. `browser.newContext()` shares nothing with the owner's —
 * cookies, storage and cache all start empty — which is the only way to tell "the recipient can
 * read it" apart from "the recipient's browser remembered it".
 */

test.describe('flow 3 — public link, then revoke', () => {
  test('subtree readable, parent hidden, breadcrumbs truncated, revoke denies immediately', async ({
    browser,
    ownerApi,
    anonymousApi,
    room,
    scratch,
  }) => {
    // A share root one level down, with a child of its own, so "the parent" and "a descendant" are
    // both real nodes rather than hypotheticals.
    const shareRoot = await ownerApi.createFolder(scratch.folder.id, 'Reports');
    const nested = await ownerApi.createFolder(shareRoot.id, 'Q1');
    await ownerApi.createFolder(nested.id, 'January');

    const owner = await openAs(browser, 'owner');
    const recipient = await openAnonymous(browser);

    try {
      await owner.page.goto(routes.folder(room.room.id, shareRoot.id));
      await expect(owner.ui.nodeTable).toBeVisible();

      // ── opening the dialog must not mint a link ────────────────────────
      // Merely inspecting who can see a folder cannot be what creates a public URL to an
      // acquisition data room. The link is minted when the Link tab is opened, not before.
      await owner.ui.shareButton.click();
      await expect(owner.ui.shareDialog).toBeVisible();
      expect((await ownerApi.sharesOf(shareRoot.id)).shares).toHaveLength(0);

      await owner.ui.shareLinkTab.click();
      await expect(owner.ui.shareLinkUrl).toBeVisible();

      const shares = (await ownerApi.sharesOf(shareRoot.id)).shares;
      expect(shares).toHaveLength(1);
      expect(shares[0]!.type).toBe('public_link');
      expect(shares[0]!.revokedAt).toBeNull();

      const token = tokenFromShareUrl(shares[0]!.url);
      // 256 bits of base64url. Never sequential, never derived from an id.
      expect(token.length).toBeGreaterThanOrEqual(40);
      // A readonly input carries the URL as its *value*; `toContainText` inspects text content and
      // would pass against an empty field.
      await expect(owner.ui.shareLinkUrl).toHaveValue(/\/s\//);

      // ── the clean context can read the subtree ─────────────────────────
      await gotoShared(recipient.page, routes.sharedEntry(token));
      await expect(recipient.page.getByRole('heading', { name: 'Reports' })).toBeVisible();
      await expect(recipient.ui.rowByName('Q1')).toBeVisible();

      // Layout comes from the response's `access`, not from the URL, so a viewer is never offered a
      // control that would be refused on click.
      await expect(recipient.ui.sharedLayout).toBeVisible();
      await expect(recipient.ui.shareButton).toHaveCount(0);
      await expect(recipient.ui.uploadButton).toHaveCount(0);
      await expect(recipient.ui.newFolderButton).toHaveCount(0);

      await recipient.ui.openRow('Q1').click();
      await expect(recipient.ui.rowByName('January')).toBeVisible();

      // ── breadcrumbs start at the share root, and stop there ────────────
      await expect(recipient.ui.breadcrumbItems.first()).toHaveText('Reports');
      await expect(recipient.ui.breadcrumbItems).toHaveCount(2); // Reports → Q1
      // The ancestor's *name* is as confidential as its contents.
      await expect(recipient.page.locator('body')).not.toContainText(scratch.prefix);
      await expect(recipient.page.locator('body')).not.toContainText(room.room.name);

      // ── the parent is not reachable, by any route ──────────────────────
      const anon = await anonymousApi(token);
      await anon.expectDenied('get', `/nodes/${scratch.folder.id}`, 'FORBIDDEN');
      await anon.expectDenied('get', `/nodes/${room.rootNodeId}`, 'FORBIDDEN');
      await anon.expectDenied('get', `/nodes/${fixtures.IDS.fileOrphan}`, 'FORBIDDEN');
      await anon.expectDenied('get', `/nodes/${scratch.folder.id}/children`, 'FORBIDDEN');
      // Read-only means read-only: the token grants no mutation anywhere in the subtree — and the
      // refusal is UNAUTHENTICATED rather than FORBIDDEN, because a share token is not a session.
      // Only the read routes opt into accepting one (`@AllowsShareToken`); every mutation is behind
      // the ordinary session guard, so an anonymous holder never reaches the permission layer at
      // all. A signed-in non-recipient attempting the same call gets FORBIDDEN — flow 4 pins that.
      await anon.expectDenied('patch', `/nodes/${nested.id}`, 'UNAUTHENTICATED', {
        data: { name: 'Q2' },
      });
      await anon.expectDenied('delete', `/nodes/${nested.id}`, 'UNAUTHENTICATED');
      await anon.expectDenied('post', '/folders', 'UNAUTHENTICATED', {
        data: { parentId: nested.id, name: 'Injected' },
      });

      // ── revoke, from the owner's dialog ────────────────────────────────
      // Not optimistic: the row says "Revoked" only after the server has agreed. Showing success
      // for a security action that might have failed is the wrong way round.
      await owner.ui.shareRevoke.click();
      await owner.ui.shareRevokeConfirm.click();
      // The URL is withdrawn from the panel, which falls back to offering a fresh one. The dialog
      // does not use the word "revoked" — the shipped copy is "There is no active link for this
      // item" — so the assertion is that the live link is gone, not that a particular word appears.
      await expect(owner.ui.shareLinkUrl).toHaveCount(0);
      await expect(owner.ui.shareDialog).toContainText(/no active link for this item/i);

      const afterRevoke = (await ownerApi.sharesOf(shareRoot.id)).shares[0]!;
      expect(afterRevoke.revokedAt).not.toBeNull();
      // The URL is withdrawn from the contract the moment it stops working.
      expect(afterRevoke.url).toBeNull();

      // ── the very next request from the recipient is denied ─────────────
      const anonAfter = await anonymousApi(token);
      await anonAfter.expectDenied('get', `/nodes/${nested.id}`, 'ACCESS_REVOKED');
      await anonAfter.expectDenied('get', `/nodes/${shareRoot.id}`, 'ACCESS_REVOKED');
      // ACCESS_REVOKED, not NOT_FOUND. The token still resolves to a share row — it is the share
      // that was turned off — and telling a holder "this link was revoked" is a different sentence
      // from "no such link", which is what the frontend renders two different screens for.
      await anonAfter.expectDenied('get', `/shared/${token}`, 'ACCESS_REVOKED');

      await recipient.page.reload();
      await expect(recipient.ui.state.accessRevoked).toBeVisible();
    } finally {
      await owner.context.close();
      await recipient.context.close();
    }
  });

  test('an expired link says expired, which is not the same as revoked', async ({
    ownerApi,
    anonymousApi,
    scratch,
  }) => {
    const node = await ownerApi.createFolder(scratch.folder.id, 'Expiring');
    const share = await ownerApi.createPublicLink(node.id, new Date(Date.now() + 2_000).toISOString());
    const token = tokenFromShareUrl(share.url);

    const anon = await anonymousApi(token);
    const before = await anon.node(node.id);
    expect(before.access).toBe('viewer');
    expect(before.shareRootId).toBe(node.id);

    await new Promise((resolve) => setTimeout(resolve, 3_000));

    // A different screen from ACCESS_REVOKED on purpose: "it lapsed" and "the owner cut you off"
    // call for different next steps from the person reading it.
    const anonAfter = await anonymousApi(token);
    await anonAfter.expectDenied('get', `/nodes/${node.id}`, 'SHARE_EXPIRED');
  });

  test('a guessed or malformed token reveals nothing at all', async ({ anonymousApi, scratch, ownerApi }) => {
    const node = await ownerApi.createFolder(scratch.folder.id, 'Private');

    const guessed = await anonymousApi('x'.repeat(43));
    await guessed.expectDenied('get', `/shared/${'x'.repeat(43)}`, 'NOT_FOUND');
    // Not FORBIDDEN-with-a-hint and not 500: an unknown token must not distinguish "no such share"
    // from "a share you may not have", or it becomes an oracle.
    await guessed.expectDenied('get', `/nodes/${node.id}`, 'FORBIDDEN');

    const empty = await anonymousApi();
    await empty.expectDenied('get', `/nodes/${node.id}`, 'UNAUTHENTICATED');
  });

  test('resolving a link reveals the shared node and nothing above it', async ({
    ownerApi,
    anonymousApi,
    scratch,
  }) => {
    const shareRoot = await ownerApi.createFolder(scratch.folder.id, 'Data Pack');
    const share = await ownerApi.createPublicLink(shareRoot.id);
    const token = tokenFromShareUrl(share.url);

    const anon = await anonymousApi(token);
    // `.strict()` is doing real work here: an extra field would be a leak *and* a contract break,
    // and this parse fails on both.
    const resolved = await anon.resolveShare(token);

    expect(resolved.nodeId).toBe(shareRoot.id);
    expect(resolved.nodeName).toBe('Data Pack');
    expect(resolved.nodeType).toBe('folder');
    expect(resolved.role).toBe('viewer');
    expect(resolved.ownerName).toBe(fixtures.users.owner.name);

    // No ancestors, no siblings, no owner email, no data room name.
    const serialized = JSON.stringify(resolved);
    expect(serialized).not.toContain(scratch.prefix);
    expect(serialized).not.toContain(fixtures.users.owner.email);
  });

  /**
   * The same link, opened by somebody who happens to be signed in — the normal case, not an exotic
   * one, since most people are signed into something.
   *
   * This is where a session and a share token compete for the same request. If `Identity` could
   * only be *either* a user *or* an anonymous token holder, the guard would pick the session, drop
   * the header, and refuse a link that works perfectly in a private window — a failure nobody would
   * reproduce, because whoever tests it is signed in as the owner and sees it work.
   */
  test('a signed-in third party can follow a public link', async ({
    ownerApi,
    strangerApi,
    scratch,
  }) => {
    const shareRoot = await ownerApi.createFolder(scratch.folder.id, 'Forwarded');
    const nested = await ownerApi.createFolder(shareRoot.id, 'Inside');
    const share = await ownerApi.createPublicLink(shareRoot.id);
    const token = tokenFromShareUrl(share.url);

    // Without the token this same identity is refused, which is what makes the next assertion mean
    // something: the grant comes from the link, not from being logged in.
    await strangerApi.expectDenied('get', `/nodes/${shareRoot.id}`, 'FORBIDDEN');

    for (const id of [shareRoot.id, nested.id]) {
      const response = await strangerApi.raw.get(strangerApi.absolute(`/nodes/${id}`), {
        headers: { 'x-share-token': token },
      });
      expect(response.status(), 'a session must not cancel out a valid public link').toBe(200);
      const detail = (await response.json()) as { access: string; shareRootId: string };
      expect(detail.access).toBe('viewer');
      expect(detail.shareRootId).toBe(shareRoot.id);
    }

    // And the link does not widen: the token covers its own subtree and nothing else, session or no
    // session.
    const outside = await strangerApi.raw.get(strangerApi.absolute(`/nodes/${scratch.folder.id}`), {
      headers: { 'x-share-token': token },
    });
    expect(outside.status()).toBe(403);
  });

  /**
   * What a link recipient learns about the room they were let into.
   *
   * `GET /data-rooms/:id` answers with a `DataRoomDto` whose `name`, `rootNodeId` and rollups are
   * projected onto the **share root** rather than the real room — so a link to `Financials` never
   * discloses that the room is called "Project Atlas", nor how much else is in it. That projection
   * is not written down in `data-rooms.contract.ts`, which is exactly why it is pinned here: it is
   * a confidentiality property that would be easy to "simplify" away while making every existing
   * test still pass.
   */
  test('a link recipient never learns the room name or the room-wide totals', async ({
    ownerApi,
    anonymousApi,
    room,
    scratch,
  }) => {
    const shareRoot = await ownerApi.createFolder(scratch.folder.id, 'Just This Bit');
    const share = await ownerApi.createPublicLink(shareRoot.id);
    const token = tokenFromShareUrl(share.url);

    const anon = await anonymousApi(token);
    const projected = await anon.raw.get(anon.absolute(`/data-rooms/${room.room.id}`));
    expect(projected.status()).toBe(200);

    const dto = (await projected.json()) as { name: string; rootNodeId: string; access: string };
    expect(dto.access).toBe('viewer');
    expect(dto.name, 'the room name is as confidential as its contents').toBe('Just This Bit');
    expect(dto.name).not.toBe(room.room.name);
    expect(dto.rootNodeId, 'browsing starts at the share root').toBe(shareRoot.id);
  });
});
