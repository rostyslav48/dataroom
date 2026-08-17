import { fixtures } from '../support/contracts';
import { expect, openAs, routes, test } from '../support/fixtures';

/**
 * FLOW 4 — permissioned share to a second account → that account signs in and reads → the owner
 * revokes → access denied.
 *
 * The two identities are two browser contexts, each with its own minted session. That is the whole
 * reason SPEC-10 settles E2E auth the way it does: driving Google twice, for two accounts, from CI,
 * is not something that can be made reliable.
 *
 * The structural claim this flow makes, and the reason it is separate from flow 3: a permissioned
 * recipient is an **authenticated user browsing the ordinary room routes**. There is no `/shared`
 * route tree for them. So the read-only chrome cannot be selected by URL — it has to come from
 * `NodeDetailResponse.access`, and if it ever keys off the path instead, a recipient lands on
 * `/rooms/...` and gets an owner's toolbar full of buttons that 403 on click.
 */

test.describe('flow 4 — permissioned share to a second account', () => {
  test('recipient reads on the ordinary room route, then loses access on revoke', async ({
    browser,
    ownerApi,
    viewerApi,
    room,
    scratch,
  }) => {
    const shareRoot = await ownerApi.createFolder(scratch.folder.id, 'Board Pack');
    const nested = await ownerApi.createFolder(shareRoot.id, 'Minutes');

    const owner = await openAs(browser, 'owner');
    const recipient = await openAs(browser, 'viewer');

    try {
      // ── the owner invites, by email, from the People tab ───────────────
      await owner.page.goto(routes.folder(room.room.id, shareRoot.id));
      await owner.ui.shareButton.click();
      await owner.ui.sharePeopleTab.click();
      await owner.ui.recipientEmailInput.fill(fixtures.users.viewer.email);
      await owner.ui.recipientEmailInput.press('Enter');
      await expect(owner.ui.recipientRow(fixtures.users.viewer.email)).toBeVisible();

      const share = (await ownerApi.sharesOf(shareRoot.id)).shares.find(
        (candidate) => candidate.type === 'permissioned',
      );
      expect(share, 'the People tab should have created a permissioned share').toBeDefined();
      expect(share!.url, 'a permissioned share is not a link and has no url').toBeNull();
      expect(share!.recipients.map((r) => r.email)).toContain(fixtures.users.viewer.email);

      // ── the recipient reads, on the owner-shaped URL ───────────────────
      await recipient.page.goto(routes.folder(room.room.id, shareRoot.id));
      await expect(recipient.ui.rowByName('Minutes')).toBeVisible();

      // Layout from `access`, not from the route. This is the load-bearing assertion of the flow.
      await expect(recipient.ui.sharedLayout).toBeVisible();
      await expect(recipient.ui.shareButton).toHaveCount(0);
      await expect(recipient.ui.uploadButton).toHaveCount(0);
      await expect(recipient.ui.newFolderButton).toHaveCount(0);

      const detail = await viewerApi.node(nested.id);
      expect(detail.access).toBe('viewer');
      expect(detail.shareRootId).toBe(shareRoot.id);
      // Breadcrumbs are truncated at the share root even though the caller is a signed-in user with
      // a full-looking URL — the truncation is a property of the grant, not of the route tree.
      expect(detail.breadcrumbs[0]!.id).toBe(shareRoot.id);
      expect(detail.breadcrumbs.map((crumb) => crumb.id)).not.toContain(room.rootNodeId);

      // ── and reads nothing else ─────────────────────────────────────────
      await viewerApi.expectDenied('get', `/nodes/${scratch.folder.id}`, 'FORBIDDEN');
      await viewerApi.expectDenied('get', `/nodes/${room.rootNodeId}`, 'FORBIDDEN');
      await viewerApi.expectDenied('get', `/nodes/${fixtures.IDS.fileOrphan}`, 'FORBIDDEN');
      await viewerApi.expectDenied('patch', `/nodes/${nested.id}`, 'FORBIDDEN', {
        data: { name: 'Renamed' },
      });

      // The room appears under "Shared with me", never under "Owned".
      const rooms = await viewerApi.listRooms();
      expect(rooms.owned.map((r) => r.id)).not.toContain(room.room.id);

      // ── the owner revokes ──────────────────────────────────────────────
      await owner.ui.shareRevoke.click();
      await owner.ui.shareRevokeConfirm.click();
      await expect(owner.ui.shareDialog).toContainText(/revoked/i);

      // Nothing is cached anywhere, so this takes effect on the very next request — and it says
      // *revoked*, not a bare forbidden, because the recipient needs to know what changed.
      await viewerApi.expectDenied('get', `/nodes/${shareRoot.id}`, 'ACCESS_REVOKED');
      await viewerApi.expectDenied('get', `/nodes/${nested.id}`, 'ACCESS_REVOKED');

      await recipient.page.reload();
      await expect(recipient.ui.state.accessRevoked).toBeVisible();
    } finally {
      await owner.context.close();
      await recipient.context.close();
    }
  });

  test('a recipient revoked individually loses access while the share stays live', async ({
    ownerApi,
    viewerApi,
    strangerApi,
    scratch,
  }) => {
    const node = await ownerApi.createFolder(scratch.folder.id, 'Two Recipients');
    const share = await ownerApi.createPermissionedShare(node.id, [
      fixtures.users.viewer.email,
      fixtures.users.stranger.email,
    ]);

    expect((await viewerApi.node(node.id)).access).toBe('viewer');
    expect((await strangerApi.node(node.id)).access).toBe('viewer');

    const viewerRecipient = share.recipients.find((r) => r.email === fixtures.users.viewer.email)!;
    await ownerApi.revokeRecipient(share.id, viewerRecipient.id);

    await viewerApi.expectDenied('get', `/nodes/${node.id}`, 'ACCESS_REVOKED');
    // Revocation is per recipient. The other invitee is untouched.
    expect((await strangerApi.node(node.id)).access).toBe('viewer');
  });

  /**
   * Signed in with the wrong Google account.
   *
   * A bare 403 here is the single most confusing failure in every sharing product: the user *does*
   * have access, just not in the browser profile they are looking at. The distinct reason code is
   * what lets the frontend say so and offer to switch accounts.
   *
   * **The invited address itself is deliberately withheld**, and this test pins that. Reaching this
   * branch takes only a node id and *any* session, so returning the address — even masked — would
   * make a forwarded link an address-harvesting oracle, and the domain half ("somebody at
   * acquirer-corp.com is in this deal room") is the sensitive half.
   *
   * Note for whoever builds `WrongAccountState`: SPEC-09 and `06-edge-cases.md` both describe a
   * screen naming *both* addresses ("Shared with a@x.com; you're signed in as b@y.com"), which this
   * response cannot populate. QA has raised the conflict; the screen can name the signed-in account
   * (the client knows it) but not the invited one.
   */
  test('a non-recipient sees WRONG_ACCOUNT, and is told nothing about who was invited', async ({
    ownerApi,
    strangerApi,
    scratch,
  }) => {
    const node = await ownerApi.createFolder(scratch.folder.id, 'For Viewer Only');
    await ownerApi.createPermissionedShare(node.id, [fixtures.users.viewer.email]);

    const error = await strangerApi.expectDenied('get', `/nodes/${node.id}`, 'WRONG_ACCOUNT');

    const serialized = JSON.stringify(error);
    expect(serialized).not.toContain(fixtures.users.viewer.email);
    expect(serialized).not.toContain('example.com');
    expect(error.message).toMatch(/different account/i);
  });

  test('an invitation to an address with no account waits as Invited, and works on first sign-in', async ({
    ownerApi,
    scratch,
  }) => {
    const node = await ownerApi.createFolder(scratch.folder.id, 'Pending Invite');
    const unknown = `nobody-${Date.now()}@example.com`;
    const share = await ownerApi.createPermissionedShare(node.id, [unknown]);

    const recipient = share.recipients.find((r) => r.email === unknown)!;
    // Null `userId` is what the UI renders as "Invited". It is backfilled on their first Google
    // login — without which permissioned sharing silently fails for everyone not already
    // registered, silently because the owner's console looks perfectly correct.
    expect(recipient.userId).toBeNull();
    expect(recipient.acceptedAt).toBeNull();
    expect(recipient.revokedAt).toBeNull();
  });

  test('the owner keeps full access to a folder they shared with someone else', async ({
    ownerApi,
    scratch,
  }) => {
    const node = await ownerApi.createFolder(scratch.folder.id, 'Still Mine');
    await ownerApi.createPermissionedShare(node.id, [fixtures.users.viewer.email]);

    const detail = await ownerApi.node(node.id);
    expect(detail.access).toBe('owner');
    // Ownership wins over any grant, so the owner's breadcrumbs still reach the room root.
    expect(detail.breadcrumbs[0]!.id).not.toBe(node.id);

    const renamed = await ownerApi.rename(node.id, 'Still Mine, Renamed');
    expect(renamed.name).toBe('Still Mine, Renamed');
  });
});
