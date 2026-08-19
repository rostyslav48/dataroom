import { expect, openAs, routes, test } from '../support/fixtures';

/**
 * A second-pass QA finding, pinned as a test.
 *
 * Wave 8 fixed the field that `NAME_CONFLICT` used to clear (`4ed0d20`): `NodeNameCell` now seeds
 * its draft when the field **opens** and never again, so the optimistic rollback stops eating the
 * user's typing. Seeding once also removed the only thing that cleared `committedRef` — the
 * double-commit guard that stops blur from re-sending what Enter already sent — so the same commit
 * added an effect that releases the guard *when a rename error arrives*:
 *
 *     useEffect(() => {
 *       if (renameError !== null && renameError !== undefined) committedRef.current = false;
 *     }, [renameError]);
 *
 * The dependency is the error **value**, and `FolderPage.commitRename` sets that value to a
 * constant — `errorMap('NAME_CONFLICT').body`, "Another item in this folder already uses that name.
 * Pick a different one." It never clears the error before re-running the mutation either. So a
 * *second* rejection with the same message is not a state change: React bails out, the effect does
 * not re-run, `committedRef` stays `true`, and every further Enter (and the blur commit with it) is
 * swallowed by the guard. The row can no longer be renamed at all without pressing Escape and
 * losing the typing — which is the outcome SPEC-07's "keeps the input open with the text preserved"
 * exists to prevent.
 *
 * Two conflicts in a row is not an exotic path: a folder with `Alpha` and `Beta` in it, and a user
 * who guesses twice, reaches it. The same shape holds for two client-side validation failures with
 * one message ("a/b" then "c/d"), which never even reach the server.
 *
 * SPEC-07 §Behaviour and §Acceptance criteria: "Inline rename commits on Enter", and
 * "`NAME_CONFLICT` keeps the input open with the typed text and an inline error". The first attempt
 * satisfies both. The third attempt commits nothing.
 *
 * Track: qa
 */

test.describe('QA finding — a second rejected rename wedges the field shut', () => {
  test('after two conflicts in a row, a free name can no longer be committed', async ({
    browser,
    ownerApi,
    room,
    scratch,
  }) => {
    await ownerApi.createFolder(scratch.folder.id, 'Alpha');
    await ownerApi.createFolder(scratch.folder.id, 'Beta');
    await ownerApi.createFolder(scratch.folder.id, 'Target');

    const { context, page, ui } = await openAs(browser, 'owner');
    try {
      await page.goto(routes.folder(room.room.id, scratch.folder.id));
      await expect(ui.rowByName('Target')).toBeVisible();

      await ui.rowActions(ui.rowByName('Target')).click();
      await ui.menuItem(/rename/i).click();

      // ── first rejection: the Wave 8 fix, working ───────────────────────
      await ui.renameInput.fill('Alpha');
      await ui.renameInput.press('Enter');
      await expect(ui.renameError).toBeVisible();
      await expect(ui.renameInput).toHaveValue('Alpha');

      // ── second rejection: same message, so the guard is never released ──
      await ui.renameInput.fill('Beta');
      await ui.renameInput.press('Enter');
      await expect(ui.renameError).toBeVisible();
      await expect(ui.renameInput).toHaveValue('Beta');

      // ── third attempt: a name nothing else uses, so this must commit ───
      await ui.renameInput.fill('Gamma');
      await ui.renameInput.press('Enter');

      await expect(
        ui.rowByName('Gamma'),
        'a rename the server would accept is swallowed by the double-commit guard — see the note at the top',
      ).toBeVisible();
      await expect(ui.rowByName('Target')).toHaveCount(0);

      // And the wire agrees: nothing here is a rendering artefact.
      const children = await ownerApi.children(scratch.folder.id);
      expect(children.items.map((item) => item.name)).toContain('Gamma');
    } finally {
      await context.close();
    }
  });

  /**
   * The same wedge through the client-side validator, which never reaches the API at all:
   * `ResourceName.safeParse` fails twice with one message and the guard is stuck on the second.
   */
  test('two client-rejected names in a row wedge it too, without a single request', async ({
    browser,
    ownerApi,
    room,
    scratch,
  }) => {
    await ownerApi.createFolder(scratch.folder.id, 'Slashes');

    const { context, page, ui } = await openAs(browser, 'owner');
    try {
      await page.goto(routes.folder(room.room.id, scratch.folder.id));
      await ui.rowActions(ui.rowByName('Slashes')).click();
      await ui.menuItem(/rename/i).click();

      await ui.renameInput.fill('a/b');
      await ui.renameInput.press('Enter');
      await expect(ui.renameError).toBeVisible();

      await ui.renameInput.fill('c/d');
      await ui.renameInput.press('Enter');
      await expect(ui.renameError).toBeVisible();

      await ui.renameInput.fill('Valid Name');
      await ui.renameInput.press('Enter');

      await expect(
        ui.rowByName('Valid Name'),
        'the third, valid name is never committed — the guard was left set by the second failure',
      ).toBeVisible();
    } finally {
      await context.close();
    }
  });

  /**
   * Escape after a rejection is the only exit the wedged field leaves, so it had better restore the
   * committed name. It does — this one passes, and is here because a fix for the two above must not
   * break it.
   */
  test('Escape after a rejection closes the field and restores the committed name', async ({
    browser,
    ownerApi,
    room,
    scratch,
  }) => {
    await ownerApi.createFolder(scratch.folder.id, 'Taken');
    await ownerApi.createFolder(scratch.folder.id, 'Original');

    const { context, page, ui } = await openAs(browser, 'owner');
    try {
      await page.goto(routes.folder(room.room.id, scratch.folder.id));
      await ui.rowActions(ui.rowByName('Original')).click();
      await ui.menuItem(/rename/i).click();

      await ui.renameInput.fill('Taken');
      await ui.renameInput.press('Enter');
      await expect(ui.renameError).toBeVisible();

      await ui.renameInput.press('Escape');
      await expect(ui.renameInput).toHaveCount(0);
      await expect(ui.rowByName('Original')).toBeVisible();
      await expect(ui.rowByName('Taken')).toHaveCount(1);

      // Reopening seeds from the row again, so the abandoned draft does not come back.
      await ui.rowActions(ui.rowByName('Original')).click();
      await ui.menuItem(/rename/i).click();
      await expect(ui.renameInput).toHaveValue('Original');
    } finally {
      await context.close();
    }
  });

  /**
   * Seeding once, on open, is what keeps the typing — but it also means a *second context* renaming
   * the same node cannot disturb an edit in progress, and that the local commit still wins
   * afterwards. `06-edge-cases.md` §Concurrency: "Two tabs rename the same node — last write wins".
   */
  test('a second context renaming the same node does not disturb an edit in progress', async ({
    browser,
    ownerApi,
    room,
    scratch,
  }) => {
    const node = await ownerApi.createFolder(scratch.folder.id, 'Contested');

    const { context, page, ui } = await openAs(browser, 'owner');
    try {
      await page.goto(routes.folder(room.room.id, scratch.folder.id));
      await ui.rowActions(ui.rowByName('Contested')).click();
      await ui.menuItem(/rename/i).click();
      await ui.renameInput.fill('Mine');

      // The other tab wins the race on the server while this field is open.
      await ownerApi.rename(node.id, 'Theirs');
      await page.waitForTimeout(500);
      await expect(ui.renameInput, 'the open field must keep what was typed').toHaveValue('Mine');

      await ui.renameInput.press('Enter');
      await expect(ui.rowByName('Mine')).toBeVisible();

      const children = await ownerApi.children(scratch.folder.id);
      expect(children.items.map((item) => item.name)).toContain('Mine');
    } finally {
      await context.close();
    }
  });

  /**
   * Blur commits — SPEC-07 §Behaviour, "Enter commits, Escape cancels, blur commits" — and it must
   * commit exactly once. Renaming two rows in sequence is the ordinary case the guard exists for.
   */
  test('blur commits a rename, and a second row renames straight after', async ({
    browser,
    ownerApi,
    room,
    scratch,
  }) => {
    await ownerApi.createFolder(scratch.folder.id, 'First');
    await ownerApi.createFolder(scratch.folder.id, 'Second');

    const { context, page, ui } = await openAs(browser, 'owner');
    try {
      await page.goto(routes.folder(room.room.id, scratch.folder.id));

      await ui.rowActions(ui.rowByName('First')).click();
      await ui.menuItem(/rename/i).click();
      await ui.renameInput.fill('First Renamed');
      await page.getByRole('main').click({ position: { x: 5, y: 5 } });
      await expect(ui.rowByName('First Renamed')).toBeVisible();

      await ui.rowActions(ui.rowByName('Second')).click();
      await ui.menuItem(/rename/i).click();
      await expect(ui.renameInput).toHaveValue('Second');
      await ui.renameInput.fill('Second Renamed');
      await ui.renameInput.press('Enter');
      await expect(ui.rowByName('Second Renamed')).toBeVisible();

      const children = await ownerApi.children(scratch.folder.id);
      const names = children.items.map((item) => item.name);
      expect(names).toContain('First Renamed');
      expect(names).toContain('Second Renamed');
      // One commit per rename: a duplicate would have been suffixed or rejected, not silent.
      expect(names.filter((name) => name.startsWith('First')).length).toBe(1);
    } finally {
      await context.close();
    }
  });

  /**
   * F2 is an acceptance criterion of its own ("Keyboard: arrows, Enter, F2, Delete, Escape all work
   * without a mouse"), and it reaches the same field by a different route.
   */
  test('F2 opens the rename field and Enter commits it', async ({
    browser,
    ownerApi,
    room,
    scratch,
  }) => {
    await ownerApi.createFolder(scratch.folder.id, 'Keyboard');

    const { context, page, ui } = await openAs(browser, 'owner');
    try {
      await page.goto(routes.folder(room.room.id, scratch.folder.id));
      await expect(ui.rowByName('Keyboard')).toBeVisible();

      await page.locator('[data-node-row]').first().focus();
      await page.keyboard.press('ArrowDown');
      await page.keyboard.press('F2');

      await expect(ui.renameInput).toBeVisible();
      await ui.renameInput.fill('Keyboard Renamed');
      await ui.renameInput.press('Enter');
      await expect(ui.rowByName('Keyboard Renamed')).toBeVisible();
    } finally {
      await context.close();
    }
  });
});
