import { fixtures } from '../support/contracts';
import { expect, openAs, routes, test } from '../support/fixtures';
import { simulateRefocus } from '../support/focus';

test.describe('fresh Wave 8 adversarial checks', () => {
  test('a valid folder name can be committed by blur after Enter was rejected', async ({
    browser,
    ownerApi,
    room,
    scratch,
  }) => {
    await ownerApi.createFolder(scratch.folder.id, 'Blur Taken');
    await ownerApi.createFolder(scratch.folder.id, 'Blur Target');

    const owner = await openAs(browser, 'owner');
    try {
      await owner.page.goto(routes.folder(room.room.id, scratch.folder.id));
      await owner.ui.rowActions(owner.ui.rowByName('Blur Target')).click();
      await owner.ui.menuItem(/rename/i).click();

      await owner.ui.renameInput.fill('Blur Taken');
      await owner.ui.renameInput.press('Enter');
      await expect(owner.ui.renameError).toBeVisible();
      await expect(owner.ui.renameInput).toHaveValue('Blur Taken');

      await owner.ui.renameInput.fill('Blur Accepted');
      await owner.page.getByRole('main').click({ position: { x: 5, y: 5 } });

      await expect(owner.ui.rowByName('Blur Accepted')).toBeVisible();
      await expect(owner.ui.rowByName('Blur Target')).toHaveCount(0);
      expect((await ownerApi.children(scratch.folder.id)).items.map((item) => item.name)).toContain(
        'Blur Accepted',
      );
    } finally {
      await owner.context.close();
    }
  });

  test('a real second browser context can rename mid-edit, then the last editor wins', async ({
    browser,
    ownerApi,
    room,
    scratch,
  }) => {
    const node = await ownerApi.createFolder(scratch.folder.id, 'Two Contexts');
    const first = await openAs(browser, 'owner');
    const second = await openAs(browser, 'owner');

    try {
      const url = routes.folder(room.room.id, scratch.folder.id);
      await Promise.all([first.page.goto(url), second.page.goto(url)]);
      await expect(first.ui.rowByName('Two Contexts')).toBeVisible();
      await expect(second.ui.rowByName('Two Contexts')).toBeVisible();

      await first.ui.rowActions(first.ui.rowByName('Two Contexts')).click();
      await first.ui.menuItem(/rename/i).click();
      await first.ui.renameInput.fill('First Context Wins Last');

      await second.ui.rowActions(second.ui.rowByName('Two Contexts')).click();
      await second.ui.menuItem(/rename/i).click();
      await second.ui.renameInput.fill('Second Context Was First');
      await second.ui.renameInput.press('Enter');
      await expect(second.ui.rowByName('Second Context Was First')).toBeVisible();

      await simulateRefocus(first.page);
      await expect(first.ui.renameInput).toHaveValue('First Context Wins Last');
      await first.ui.renameInput.press('Enter');
      await expect(first.ui.rowByName('First Context Wins Last')).toBeVisible();

      expect((await ownerApi.node(node.id)).node.name).toBe('First Context Wins Last');
    } finally {
      await first.context.close();
      await second.context.close();
    }
  });

  test('a file survives two rejected names and then accepts a valid one', async ({
    browser,
    ownerApi,
    room,
  }) => {
    const nonce = Date.now().toString(36);
    const firstTaken = `File Taken A ${nonce}`;
    const secondTaken = `File Taken B ${nonce}`;
    const accepted = `NDA Renamed ${nonce}.pdf`;
    const first = await ownerApi.createFolder(fixtures.IDS.folderLegal, firstTaken);
    const second = await ownerApi.createFolder(fixtures.IDS.folderLegal, secondTaken);
    const owner = await openAs(browser, 'owner');

    try {
      await owner.page.goto(routes.folder(room.room.id, fixtures.IDS.folderLegal));
      await owner.ui.rowActions(owner.ui.rowByName('NDA.pdf')).click();
      await owner.ui.menuItem(/rename/i).click();

      await owner.ui.renameInput.fill(firstTaken);
      await owner.ui.renameInput.press('Enter');
      await expect(owner.ui.renameError).toBeVisible();
      await expect(owner.ui.renameInput).toHaveValue(firstTaken);

      await owner.ui.renameInput.fill(secondTaken);
      await owner.ui.renameInput.press('Enter');
      await expect(owner.ui.renameError).toBeVisible();
      await expect(owner.ui.renameInput).toHaveValue(secondTaken);

      await owner.ui.renameInput.fill(accepted);
      await owner.ui.renameInput.press('Enter');
      await expect(owner.ui.rowByName(accepted)).toBeVisible();
      expect((await ownerApi.node(fixtures.IDS.fileNda)).node.name).toBe(accepted);
    } finally {
      await owner.context.close();
      await ownerApi.rename(fixtures.IDS.fileNda, 'NDA.pdf').catch(() => undefined);
      await ownerApi.remove(first.id).catch(() => undefined);
      await ownerApi.remove(second.id).catch(() => undefined);
    }
  });

  test('one refocus of a two-page folder refetches each loaded page once and then settles', async ({
    browser,
    ownerApi,
    room,
    scratch,
  }) => {
    for (let i = 0; i < 51; i += 1) {
      await ownerApi.createFolder(scratch.folder.id, `Paged ${String(i).padStart(2, '0')}`);
    }

    const owner = await openAs(browser, 'owner');
    const childrenRequests: string[] = [];
    owner.page.on('request', (request) => {
      if (request.url().includes(`/nodes/${scratch.folder.id}/children`)) {
        childrenRequests.push(request.url());
      }
    });

    try {
      await owner.page.goto(routes.folder(room.room.id, scratch.folder.id));
      await expect(owner.ui.rows).toHaveCount(50);
      await owner.page.getByRole('button', { name: 'Load more' }).click();
      await expect(owner.ui.rows).toHaveCount(51);

      const beforeRefocus = childrenRequests.length;
      await owner.page.waitForTimeout(500);
      expect(childrenRequests.length).toBe(beforeRefocus);

      await simulateRefocus(owner.page);
      await expect.poll(() => childrenRequests.length - beforeRefocus).toBe(2);
      await owner.page.waitForTimeout(500);
      expect(childrenRequests.length - beforeRefocus).toBe(2);
    } finally {
      await owner.context.close();
    }
  });
});
