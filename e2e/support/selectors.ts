import type { Locator, Page } from '@playwright/test';

/**
 * Every UI locator in the suite, in one file.
 *
 * ## What changed in Wave 8
 *
 * These specs were written while `apps/web` was still a routed shell, from the component names in
 * SPEC-06 through SPEC-09, so the locators below started life as a *prediction* of the DOM. That
 * prediction was never checked against a running app: nothing was deployed, and the suite's twenty
 * browser-driven tests had never been executed at all.
 *
 * They have now been run against a live local stack — real Postgres, real API, real Vite build —
 * and this file is the reconciliation. Almost none of the predicted `data-testid`s exist: the app
 * that was built is addressed through roles and accessible names instead, which is the better of
 * the two anyway because it fails when a screen stops being usable rather than when a helper
 * attribute is renamed.
 *
 * Three test ids *do* exist and are used here: `node-row-<id>` (per row), `shared-banner`, and
 * `toast-region`. Rows also carry `data-node-row="<id>"`, which is what `rowById` addresses — two
 * folders may legitimately share a name across a move, and matching on text alone makes a rename
 * test assert against the wrong row.
 *
 * ## What changed after the first storage-enabled run
 *
 * Two locators here were still predictions, and both failed the first time a real bucket let them
 * run — *after* the behaviour they were checking had already appeared on screen:
 *
 *   - `uploadItems` fell back to filtering list items by `%|uploading|done`, and the completed
 *     row's label is **Uploaded**. Fast uploads therefore vanished from the locator the moment they
 *     finished, and a three-file count assertion failed against three visible rows.
 *   - `downloadButton` matched by accessible name, and two buttons legitimately say "Download":
 *     the viewer toolbar's and the unsupported-preview CTA. Playwright strict mode failed on the
 *     ambiguity rather than on anything the product did wrong.
 *
 * Both are now addressed by test ids that the app carries (`upload-item`, `upload-queue`,
 * `toolbar-download`, `unsupported-download`) rather than by text that is a label today and
 * something else after the next copy edit. `uploadItemsByStatus` reads `data-upload-status`, so a
 * test can wait for a terminal state instead of racing the label.
 */

export const routes = {
  rooms: () => '/rooms',
  folder: (roomId: string, nodeId: string) => `/rooms/${roomId}/f/${nodeId}`,
  file: (roomId: string, nodeId: string) => `/rooms/${roomId}/file/${nodeId}`,
  sharedEntry: (token: string) => `/s/${token}`,
  sharedFolder: (token: string, nodeId: string) => `/s/${token}/f/${nodeId}`,
  sharedFile: (token: string, nodeId: string) => `/s/${token}/file/${nodeId}`,
};

export function ui(page: Page) {
  const main = page.getByRole('main');
  const dialog = page.getByRole('dialog');
  const breadcrumbNav = page.getByRole('navigation', { name: /breadcrumb/i });
  /** Body rows only. The header is also a `row`, and it contains the word "Name". */
  const bodyRows = page.locator('[data-node-row]');

  return {
    // ── shell & rooms ───────────────────────────────────────────────────
    // The room list is rendered twice — once in the sidebar nav, once in the page body — so every
    // room locator is scoped to `main`, or Playwright's strict mode fails on the duplicate.
    roomList: main.getByRole('list').first(),
    roomListItem: (name: string) => main.getByRole('link', { name }),
    newRoomButton: main.getByRole('button', { name: /new (data )?room/i }).first(),
    roomNameInput: dialog.getByRole('textbox', { name: /name/i }),
    roomNameSubmit: dialog.getByRole('button', { name: /^create$/i }),

    // ── browser ─────────────────────────────────────────────────────────
    breadcrumbs: breadcrumbNav,
    breadcrumbItems: breadcrumbNav.getByRole('listitem'),
    breadcrumbLink: (name: string) => breadcrumbNav.getByRole('link', { name }),

    // `role="grid"`, not `table`: the folder listing is a keyboard-navigable grid.
    nodeTable: page.getByRole('grid', { name: /folder contents/i }),
    rows: bodyRows,
    rowById: (nodeId: string) => page.locator(`[data-node-row="${nodeId}"]`),
    /**
     * Matched on the **name cell**, not on the row's text. Every row also renders its modified date
     * — "18 Aug 2026" — so a row named `2026` matched every sibling in the folder, and an assertion
     * that a row had gone found somebody else's date and passed for the wrong reason.
     */
    rowByName: (name: string) =>
      bodyRows.filter({ has: page.getByRole('button', { name, exact: true }) }),
    /**
     * Opening a node. The row is a grid row, not a link — the name cell holds the button that
     * navigates, and clicking the row's own box may land on a size or date cell instead.
     */
    openRow: (name: string) =>
      // `exact`: the row's other button is "Actions for <name>", which a substring match also hits.
      bodyRows
        .filter({ has: page.getByRole('button', { name, exact: true }) })
        .getByRole('button', { name, exact: true }),
    /** The action menu trigger inside a row — Rename · Move · Share · Delete. */
    rowActions: (row: Locator) => row.getByRole('button', { name: /^actions for /i }),
    menuItem: (name: RegExp) => page.getByRole('menuitem', { name }),

    // `.first()`: the toolbar carries one and the empty-state block offers a second.
    newFolderButton: main.getByRole('button', { name: /new folder/i }).first(),
    folderNameInput: dialog.getByRole('textbox'),
    folderNameSubmit: dialog.getByRole('button', { name: /^create$/i }),
    /** Renaming happens in place, in the row's name cell, not in a dialog. */
    renameInput: page.getByRole('textbox', { name: /^rename /i }),
    renameError: page.getByRole('alert'),

    // ── delete ──────────────────────────────────────────────────────────
    deleteDialog: page.getByRole('dialog', { name: /^delete /i }),
    /** The server-counted blast radius, which is the first paragraph of the dialog body. */
    deletePreview: page.getByRole('dialog', { name: /^delete /i }).getByRole('paragraph').first(),
    deleteConfirm: page
      .getByRole('dialog', { name: /^delete /i })
      .getByRole('button', { name: /^delete$/i }),

    // ── uploads ─────────────────────────────────────────────────────────
    // `Upload` must be exact: the dropzone renders a second button, "Choose files to upload".
    uploadButton: main.getByRole('button', { name: 'Upload', exact: true }),
    fileInput: page.locator('input[type="file"]'),
    uploadQueue: page.getByTestId('upload-queue'),
    // Scoped to the queue, so a list item anywhere else on the page can never be counted as one.
    uploadItems: page.getByTestId('upload-queue').getByTestId('upload-item'),
    uploadItemByName: (name: string) =>
      page.getByTestId('upload-queue').getByTestId('upload-item').filter({ hasText: name }),
    /**
     * Rows in a given lifecycle state, read off `data-upload-status` rather than off the visible
     * label. `done` is rendered as "Uploaded"; matching the word is how the old locator lost every
     * row that finished quickly.
     */
    uploadItemsByStatus: (status: 'queued' | 'uploading' | 'done' | 'error') =>
      page.getByTestId('upload-queue').locator(`[data-upload-status="${status}"]`),

    // ── viewer ──────────────────────────────────────────────────────────
    // UNVERIFIED for the same reason: react-pdf's own class names, since the app adds no test id.
    pdfViewer: page.locator('.react-pdf__Document'),
    pdfPage: page.locator('.react-pdf__Page'),
    unsupportedPreview: page.getByTestId('unsupported-preview'),
    // Two buttons in this app say "Download" and both are legitimate. Address them separately
    // rather than letting a strict-mode violation stand in for a product failure.
    downloadButton: page.getByTestId('toolbar-download'),
    unsupportedDownloadButton: page.getByTestId('unsupported-download'),

    // ── sharing ─────────────────────────────────────────────────────────
    shareButton: main.getByRole('button', { name: 'Share', exact: true }),
    shareDialog: page.getByRole('dialog', { name: /^share$/i }),
    shareLinkTab: page.getByRole('tab', { name: /public link/i }),
    sharePeopleTab: page.getByRole('tab', { name: /invite people/i }),
    shareLinkUrl: page.getByRole('textbox', { name: /public link url/i }),
    shareCopy: page.getByRole('button', { name: /^copy$/i }),
    /**
     * Revoking a link is two clicks: the trigger swaps itself for a danger-styled confirmation, so
     * both steps carry the same accessible name and only one of them is on screen at a time.
     */
    shareRevoke: page.getByRole('button', { name: /revoke link/i }),
    /** Ends the whole permissioned share — everyone at once, not one recipient at a time. */
    shareStopSharing: page.getByRole('button', { name: /^stop sharing$/i }),
    shareRevokeConfirm: page.getByRole('button', { name: /revoke link/i }),
    recipientEmailInput: page.getByRole('textbox', { name: /invite by email/i }),
    /** Typing an address only queues it; the share is created when this is pressed. */
    inviteSubmit: page.getByRole('button', { name: /^invite\b/i }),
    recipientRow: (email: string) => page.getByRole('listitem').filter({ hasText: email }),
    /** Per-recipient removal — the only revocation the People tab offers. */
    recipientRemove: (email: string) =>
      page.getByRole('button', { name: `Remove access for ${email}` }),
    recipientRemoveConfirm: page.getByRole('button', { name: /^remove$/i }),

    // ── layout, chosen from `access` and never from the route ───────────
    sharedLayout: page.getByTestId('shared-banner'),
    ownerLayout: page.getByRole('navigation', { name: /data rooms/i }),

    // ── the six designed access-failure screens ─────────────────────────
    // Matched on the copy the app actually ships; each string is a substring of one `StateBlock`
    // title in `features/shares/accessStates.tsx`.
    state: {
      forbidden: page.getByText(/don't have access to this item/i),
      accessRevoked: page.getByText(/access was removed by the owner/i),
      shareExpired: page.getByText(/link has expired/i),
      itemGone: page.getByText(/was deleted by the owner/i),
      wrongAccount: page.getByText(/signed in with a different account/i),
      notFound: page.getByText(/link isn't valid/i),
    },
  };
}

export type Ui = ReturnType<typeof ui>;
