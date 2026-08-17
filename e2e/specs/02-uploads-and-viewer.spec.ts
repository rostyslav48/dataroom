import { expect, openAs, routes, test } from '../support/fixtures';
import { pdfFile, textFile } from '../support/pdf';

/**
 * FLOW 2 — upload 3 PDFs at once → watch progress → open one in the viewer → download another.
 *
 * The only flow whose bytes leave the API's process. `init` reserves a node and hands back a signed
 * URL, the browser PUTs straight to storage, `complete` verifies the object's real size against the
 * declared one. Three services have to agree, and no unit test can make them.
 *
 * Progress is asserted as *reaching* completion rather than as a particular intermediate number:
 * the design's promise is that every bar reflects a real `xhr.upload.onprogress` event, and pinning
 * a percentage would test the network's mood instead.
 */

test.describe('flow 2 — uploads and viewer', () => {
  test('uploads three PDFs at once, opens one, downloads another', async ({ browser, room, scratch }) => {
    const { context, page, ui } = await openAs(browser, 'owner');
    const files = [
      pdfFile('alpha.pdf', 'Alpha'),
      pdfFile('beta.pdf', 'Beta'),
      pdfFile('gamma.pdf', 'Gamma'),
    ];

    try {
      await page.goto(routes.folder(room.room.id, scratch.folder.id));
      await expect(ui.nodeTable).toBeVisible();

      // Every dropped file gets a row immediately — before any of them has a signed URL. A queue
      // that appears only once the server answers reads as a dropped drag.
      await ui.fileInput.setInputFiles(files);
      await expect(ui.uploadItems).toHaveCount(3);

      for (const file of files) {
        await expect(ui.uploadItemByName(file.name)).toContainText(/done|complete|uploaded/i, {
          timeout: 60_000,
        });
        await expect(ui.rowByName(file.name)).toBeVisible();
      }

      // ── open one in the viewer ─────────────────────────────────────────
      await ui.rowByName('beta.pdf').click();
      await expect(page).toHaveURL(/\/file\/[0-9a-f-]{36}/);
      await expect(ui.pdfViewer).toBeVisible();
      // Page 1 actually rendered. `/nodes/:id/content` 302s to a 60-second signed URL, so this
      // asserts the redirect, the signature and the pinned local pdf.js worker all at once.
      await expect(ui.pdfPage.first()).toBeVisible({ timeout: 30_000 });

      // ── download another ───────────────────────────────────────────────
      await page.goto(routes.folder(room.room.id, scratch.folder.id));
      const row = ui.rowByName('gamma.pdf');
      await ui.rowActions(row).click();
      const [download] = await Promise.all([
        page.waitForEvent('download'),
        ui.menuItem(/download/i).click(),
      ]);
      expect(download.suggestedFilename()).toBe('gamma.pdf');
    } finally {
      await context.close();
    }
  });

  test('a non-previewable type degrades to UnsupportedPreview rather than a broken embed', async ({
    browser,
    room,
    scratch,
  }) => {
    const { context, page, ui } = await openAs(browser, 'owner');
    try {
      await page.goto(routes.folder(room.room.id, scratch.folder.id));
      await ui.fileInput.setInputFiles([textFile('notes.txt')]);
      await expect(ui.rowByName('notes.txt')).toBeVisible({ timeout: 60_000 });

      await ui.rowByName('notes.txt').click();
      await expect(ui.unsupportedPreview).toBeVisible();
      await expect(ui.downloadButton).toBeVisible();
      await expect(ui.pdfViewer).toHaveCount(0);
    } finally {
      await context.close();
    }
  });

  /**
   * The auto-suffix, asserted where it is decided.
   *
   * A colliding upload is renamed rather than refused — the alternative is a modal per file, which
   * is hostile across a twenty-file drop. But the rename must be *visible*, so the wire-level
   * `finalName` and the queue row have to say the same thing.
   */
  test('a colliding upload is suffixed, not refused, and the new name comes back from init', async ({
    ownerApi,
    scratch,
  }) => {
    const first = pdfFile('report.pdf', 'first');
    const initial = await ownerApi.initUpload({
      parentId: scratch.folder.id,
      name: first.name,
      sizeBytes: first.buffer.byteLength,
      mimeType: 'application/pdf',
    });
    expect(initial.finalName).toBe('report.pdf');

    const second = await ownerApi.initUpload({
      parentId: scratch.folder.id,
      name: 'report.pdf',
      sizeBytes: first.buffer.byteLength,
      mimeType: 'application/pdf',
    });
    expect(second.finalName).toBe('report (2).pdf');
    // A second reservation is a second node — never a silent overwrite of the first.
    expect(second.nodeId).not.toBe(initial.nodeId);

    // Neither is listed yet: a node with no current version must not appear, or a closed tab would
    // leave a permanent phantom row.
    const children = await ownerApi.children(scratch.folder.id);
    expect(children.items.map((item) => item.name)).not.toContain('report.pdf');
  });

  test('rejects an over-cap file at init, before a single byte moves', async ({ ownerApi, scratch }) => {
    await ownerApi.expectDenied('post', '/uploads/init', 'FILE_TOO_LARGE', {
      data: {
        parentId: scratch.folder.id,
        name: 'huge.pdf',
        sizeBytes: 200 * 1024 * 1024,
        mimeType: 'application/pdf',
      },
    });

    await ownerApi.expectDenied('post', '/uploads/init', 'VALIDATION_FAILED', {
      data: {
        parentId: scratch.folder.id,
        name: 'script.exe',
        sizeBytes: 10,
        mimeType: 'application/x-msdownload',
      },
    });
  });

  test('a zero-byte declared size is refused; the cap check needs a positive number', async ({
    ownerApi,
    scratch,
  }) => {
    // The register allows zero-byte *files*; the contract's `sizeBytes` is a positive int because
    // it is a hint for the cap check, and the real size is read back from storage at `complete`.
    await ownerApi.expectDenied('post', '/uploads/init', 'VALIDATION_FAILED', {
      data: {
        parentId: scratch.folder.id,
        name: 'empty.pdf',
        sizeBytes: 0,
        mimeType: 'application/pdf',
      },
    });
  });
});
