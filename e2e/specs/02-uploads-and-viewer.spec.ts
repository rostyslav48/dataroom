import { expect, openAs, routes, test } from '../support/fixtures';
import { storageReady } from '../support/env';
import { pdfFile, textFile } from '../support/pdf';

interface UploadProgressSample {
  loaded: number;
  total: number;
  lengthComputable: boolean;
}

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
  /**
   * Everything that actually moves bytes. `init` mints a signed upload URL *before* it answers, so
   * without a real bucket these fail at the first request with a 500 that says nothing about the
   * flow. Gated on `E2E_STORAGE_READY` rather than left red: see `support/env.ts`, and HUMAN-3 in
   * `../ProjectPlan/06-remaining-steps.md` for what unblocks them.
   */
  test.describe('with real object storage', () => {
    test.skip(
      !storageReady(),
      'needs a real Supabase bucket with CORS (HUMAN-3); set E2E_STORAGE_READY=true once it exists',
    );

    test('uploads three PDFs at once, opens one, downloads another', async ({
      browser,
      room,
      scratch,
    }) => {
      const { context, page, ui } = await openAs(browser, 'owner');
      const files = [
        // Large enough that the browser's upload machinery has a representative payload rather
        // than a sub-kilobyte request it can complete before emitting useful telemetry.
        pdfFile('alpha.pdf', 'Alpha', 4 * 1024 * 1024),
        pdfFile('beta.pdf', 'Beta'),
        pdfFile('gamma.pdf', 'Gamma'),
      ];
      const progressSamples: UploadProgressSample[] = [];

      try {
        // Observe the browser's native upload target without replacing XHR or changing production
        // code. A final queue state alone is insufficient evidence: `putWithProgress` also writes
        // 100 after `load`, so the UI could say Done even if `xhr.upload.onprogress` never fired.
        await page.exposeFunction('__e2eRecordUploadProgress', (sample: UploadProgressSample) => {
          progressSamples.push(sample);
        });
        await page.addInitScript(() => {
          const originalSend = XMLHttpRequest.prototype.send;
          XMLHttpRequest.prototype.send = function (
            body?: Document | XMLHttpRequestBodyInit | null,
          ): void {
            this.upload.addEventListener('progress', (event) => {
              const sink = globalThis as typeof globalThis & {
                __e2eRecordUploadProgress: (sample: {
                  loaded: number;
                  total: number;
                  lengthComputable: boolean;
                }) => Promise<void>;
              };
              void sink.__e2eRecordUploadProgress({
                loaded: event.loaded,
                total: event.total,
                lengthComputable: event.lengthComputable,
              });
            });
            originalSend.call(this, body);
          };
        });

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

        const representativeBytes = files[0]!.buffer.byteLength;
        await expect
          .poll(
            () =>
              progressSamples.some(
                (sample) =>
                  sample.lengthComputable &&
                  sample.loaded > 0 &&
                  sample.total === representativeBytes,
              ),
            {
              message:
                'the raw browser PUT must emit xhr.upload.onprogress for the representative PDF',
            },
          )
          .toBe(true);

        // ── open one in the viewer ─────────────────────────────────────────
        await ui.openRow('beta.pdf').click();
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

        await ui.openRow('notes.txt').click();
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
  });

  test('rejects an over-cap file at init, before a single byte moves', async ({
    ownerApi,
    scratch,
  }) => {
    await ownerApi.expectDenied('post', '/uploads/init', 'FILE_TOO_LARGE', {
      data: {
        parentId: scratch.folder.id,
        name: 'huge.pdf',
        sizeBytes: 200 * 1024 * 1024,
        mimeType: 'application/pdf',
      },
    });
  });

  /**
   * An unsupported type is `415 UNSUPPORTED_TYPE`, not `400 VALIDATION_FAILED`.
   *
   * The two say different things to a user — "we do not accept .exe" against "your request was
   * malformed" — and the upload queue renders a different row for each. CCP-8 settled where the
   * rule lives: the frozen request schema takes any non-empty string, and `UploadsService` decides
   * membership of the allowlist, which is the only arrangement in which the error code the
   * contract defines for this case can actually be produced.
   */
  test('rejects a disallowed type as unsupported, not as malformed', async ({
    ownerApi,
    scratch,
  }) => {
    await ownerApi.expectDenied('post', '/uploads/init', 'UNSUPPORTED_TYPE', {
      data: {
        parentId: scratch.folder.id,
        name: 'script.exe',
        sizeBytes: 10,
        mimeType: 'application/x-msdownload',
      },
    });

    // The shape rule still applies underneath it: an empty mime type is malformed, and answers 400.
    await ownerApi.expectDenied('post', '/uploads/init', 'VALIDATION_FAILED', {
      data: {
        parentId: scratch.folder.id,
        name: 'script.exe',
        sizeBytes: 10,
        mimeType: '',
      },
    });
  });

  /**
   * A zero-byte file is a legitimate upload, per CCP-5 and `06-edge-cases.md`.
   *
   * `sizeBytes` is a hint for the cap check, not a claim that bytes exist; the real size is read
   * back from storage at `complete`. An empty file is ordinary — a placeholder, a truncated export
   * — and refusing it with a validation error the user cannot act on is the surprise the edge-case
   * register decided against.
   */
  test('a zero-byte declared size is accepted and reserves a node', async ({
    ownerApi,
    scratch,
  }) => {
    test.skip(
      !storageReady(),
      'init mints a signed URL before answering; needs a real bucket (HUMAN-3)',
    );

    const reserved = await ownerApi.initUpload({
      parentId: scratch.folder.id,
      name: 'empty.pdf',
      sizeBytes: 0,
      mimeType: 'application/pdf',
    });

    expect(reserved.finalName).toBe('empty.pdf');

    // Reserved, not visible: the node has no current version until `complete`, so it must not
    // appear in the folder — a closed tab would otherwise leave a permanent phantom row.
    const children = await ownerApi.children(scratch.folder.id);
    expect(children.items.map((item) => item.name)).not.toContain('empty.pdf');
  });
});
