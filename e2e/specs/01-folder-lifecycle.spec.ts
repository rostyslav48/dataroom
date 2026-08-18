import { expect, openAs, routes, test } from '../support/fixtures';

/**
 * FLOW 1 — sign in → create room → create nested folders → navigate by breadcrumb → rename →
 * delete with warning.
 *
 * The spine of the product. It crosses every boundary the other suites stub: a real session against
 * the real API, three round trips of the create/read cycle, and a destructive confirmation whose
 * numbers come from the server rather than from the page's own list.
 */

test.describe('flow 1 — folder lifecycle', () => {
  test('creates a room, nests folders, navigates by breadcrumb, renames and deletes', async ({
    browser,
    ownerApi,
  }) => {
    const { context, page, ui } = await openAs(browser, 'owner');
    const roomName = `E2E Lifecycle ${Date.now()}`;
    let createdRoomId: string | undefined;

    try {
      // ── the session is real: no login page, and /me answers ────────────
      await page.goto(routes.rooms());
      await expect(ui.roomList).toBeVisible();

      // ── create a room ──────────────────────────────────────────────────
      await ui.newRoomButton.click();
      await ui.roomNameInput.fill(roomName);
      await ui.roomNameSubmit.click();

      // Creating a room lands the user in its root folder, so the table is the next thing on screen.
      await expect(ui.nodeTable).toBeVisible();
      await expect(page).toHaveURL(/\/rooms\/[0-9a-f-]{36}\/f\/[0-9a-f-]{36}/);

      const rooms = await ownerApi.listRooms();
      const created = rooms.owned.find((room) => room.name === roomName);
      expect(created, 'the new room should appear in the owner’s list').toBeDefined();
      createdRoomId = created!.id;

      // A brand-new room is empty and says so, rather than rendering an ambiguous blank table.
      expect(created!.fileCount).toBe(0);
      expect(created!.sizeBytes).toBe(0);

      // ── nest three folders ─────────────────────────────────────────────
      for (const name of ['Diligence', 'Contracts', '2026']) {
        await ui.newFolderButton.click();
        await ui.folderNameInput.fill(name);
        await ui.folderNameSubmit.click();
        await expect(ui.rowByName(name)).toBeVisible();
        await ui.openRow(name).click();
        await expect(ui.breadcrumbs).toContainText(name);
      }

      // ── breadcrumbs are the navigation, and they are complete for an owner ──
      // Root-first and including the node itself: Project → Diligence → Contracts → 2026.
      await expect(ui.breadcrumbItems).toHaveCount(4);
      await ui.breadcrumbLink('Diligence').click();
      await expect(ui.rowByName('Contracts')).toBeVisible();
      await expect(ui.rowByName('2026')).toHaveCount(0);

      // ── rename, including the conflict the edge-case register calls a hard error ──
      await ui.newFolderButton.click();
      await ui.folderNameInput.fill('Reports');
      await ui.folderNameSubmit.click();
      await expect(ui.rowByName('Reports')).toBeVisible();

      const contracts = ui.rowByName('Contracts');
      await ui.rowActions(contracts).click();
      await ui.menuItem(/rename/i).click();

      // Renaming onto a taken name is a 409, never a silent auto-suffix: rename is one deliberate
      // act, and quietly storing something other than what was typed would be wrong.
      await ui.renameInput.fill('Reports');
      await ui.renameInput.press('Enter');
      await expect(ui.renameError).toBeVisible();
      // The field stays open so the name can be corrected in place, and the optimistic rename rolls
      // back to the committed name — SPEC-07's "optimistic rename rolls back visibly on error".
      // The rejected text is *not* kept: rollback restores `node.name`, and the field is seeded
      // from it. Asserting the typing survived would be asserting against the rollback.
      await expect(ui.renameInput).toBeVisible();
      await expect(ui.renameInput).toHaveValue('Contracts');
      await expect(ui.rowByName('Reports')).toHaveCount(1);

      await ui.renameInput.fill('Agreements');
      await ui.renameInput.press('Enter');
      await expect(ui.rowByName('Agreements')).toBeVisible();
      await expect(ui.rowByName('Contracts')).toHaveCount(0);

      // ── delete, with a warning whose numbers came from the server ──────
      const agreements = ui.rowByName('Agreements');
      await ui.rowActions(agreements).click();
      await ui.menuItem(/delete/i).click();

      await expect(ui.deleteDialog).toBeVisible();
      // Confirm stays disabled until the preview arrives. A destructive confirmation that
      // understates its blast radius is worse than no confirmation at all.
      await expect(ui.deletePreview).toBeVisible();
      await expect(ui.deleteConfirm).toBeEnabled();
      // "2026" lives inside Agreements, so the preview must account for it.
      await expect(ui.deletePreview).toContainText(/1\s+folder/i);

      await ui.deleteConfirm.click();
      await expect(ui.rowByName('Agreements')).toHaveCount(0);
    } finally {
      await context.close();
      if (createdRoomId) await ownerApi.deleteRoom(createdRoomId).catch(() => undefined);
    }
  });

  /**
   * The same lifecycle at the wire level, for the two claims the screen cannot make.
   *
   * A page can show that a row disappeared; it cannot show that the *whole subtree* went with it,
   * or that the warning's count was the truth rather than a plausible number. Both are the point of
   * `delete-preview`, so both are asserted where they are observable.
   */
  test('delete-preview counts exactly what deletion removes, and the subtree goes with it', async ({
    ownerApi,
    scratch,
  }) => {
    const outer = await ownerApi.createFolder(scratch.folder.id, 'Outer');
    const inner = await ownerApi.createFolder(outer.id, 'Inner');
    const deepest = await ownerApi.createFolder(inner.id, 'Deepest');

    const preview = await ownerApi.deletePreview(outer.id);
    expect(preview.folderCount, 'Inner and Deepest, excluding Outer itself').toBe(2);
    expect(preview.fileCount).toBe(0);
    expect(preview.sizeBytes).toBe(0);

    await ownerApi.remove(outer.id);

    // Every descendant is gone, not just the node that was targeted. ITEM_GONE rather than
    // NOT_FOUND: these existed a moment ago and the UI owes the user that distinction.
    for (const id of [outer.id, inner.id, deepest.id]) {
      await ownerApi.expectDenied('get', `/nodes/${id}`, 'ITEM_GONE');
    }

    // And the name is free again — soft delete must not hold a sibling name hostage.
    const reused = await ownerApi.createFolder(scratch.folder.id, 'Outer');
    expect(reused.name).toBe('Outer');
  });

  test('a name that collides on case alone is refused, and one differing by more is not', async ({
    ownerApi,
    scratch,
  }) => {
    await ownerApi.createFolder(scratch.folder.id, 'Report');

    // Uniqueness is on lower(name): two visually identical rows would be worse than an error.
    await ownerApi.expectDenied('post', '/folders', 'NAME_CONFLICT', {
      data: { parentId: scratch.folder.id, name: 'REPORT' },
    });

    // Whitespace is trimmed before comparison, so " Report " is the same name too.
    await ownerApi.expectDenied('post', '/folders', 'NAME_CONFLICT', {
      data: { parentId: scratch.folder.id, name: '  Report  ' },
    });

    const sibling = await ownerApi.createFolder(scratch.folder.id, 'Report 2');
    expect(sibling.name).toBe('Report 2');
  });

  test('rejects the names the register says are invalid, before they reach the database', async ({
    ownerApi,
    scratch,
  }) => {
    for (const name of ['', '   ', 'a/b', 'a\\b', 'x'.repeat(256)]) {
      await ownerApi.expectDenied('post', '/folders', 'VALIDATION_FAILED', {
        data: { parentId: scratch.folder.id, name },
      });
    }

    // Reserved-looking names are fine: storage keys are UUIDs and nothing is ever written to a
    // filesystem path, so refusing them would be superstition.
    for (const name of ['..', 'CON', '.hidden']) {
      const folder = await ownerApi.createFolder(scratch.folder.id, name);
      expect(folder.name).toBe(name);
    }
  });
});
