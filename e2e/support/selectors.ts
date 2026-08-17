import type { Locator, Page } from '@playwright/test';

/**
 * Every UI locator in the suite, in one file.
 *
 * ## Read this before fixing a failing selector
 *
 * These specs were written while `apps/web` was still a routed shell, from the component names and
 * copy in SPEC-06 through SPEC-09. That is deliberate — E2E is INT-5's deliverable and had to be
 * authored ahead of the UI it drives — but it means the *names* below are a prediction, and some of
 * them will be wrong. Centralising them makes reconciling the suite with the real DOM a single
 * edit here rather than a hunt through five spec files.
 *
 * Each locator is `testId.or(role)`: the test id if the frontend exposes one, otherwise the
 * accessible role and name the spec pins. That ordering is on purpose — a `data-testid` is a
 * contract the frontend can honour cheaply, while an accessible name is real user-facing copy that
 * will get reworded. The role fallback keeps the suite running until the ids land.
 *
 * ## Test ids this suite expects
 *
 * Listed here so the frontend track has one place to read them from:
 *
 *   room-list · room-list-item · new-room-button · room-name-input · room-name-submit
 *   breadcrumbs · breadcrumb-item · node-table · node-row · node-name · node-size
 *   node-actions · new-folder-button · folder-name-input · folder-name-submit
 *   rename-input · rename-error · upload-button · file-input
 *   delete-dialog · delete-preview-summary · delete-confirm · delete-name-input
 *   upload-queue · upload-item · upload-progress
 *   pdf-viewer · pdf-page · unsupported-preview · download-button
 *   share-button · share-dialog · share-link-tab · share-people-tab · share-link-url
 *   share-copy · share-revoke · share-revoke-confirm · recipient-email-input · recipient-row
 *   shared-layout · owner-layout
 *   state-forbidden · state-access-revoked · state-share-expired · state-item-gone
 *   state-wrong-account · state-not-found
 *
 * `node-row` must also carry `data-node-id` so a spec can address one row unambiguously; two
 * folders may legitimately share a name across a move, and matching on text alone makes a rename
 * test pass for the wrong row.
 */

const either = (byTestId: Locator, byRole: Locator): Locator => byTestId.or(byRole);

export const routes = {
  rooms: () => '/rooms',
  folder: (roomId: string, nodeId: string) => `/rooms/${roomId}/f/${nodeId}`,
  file: (roomId: string, nodeId: string) => `/rooms/${roomId}/file/${nodeId}`,
  sharedEntry: (token: string) => `/s/${token}`,
  sharedFolder: (token: string, nodeId: string) => `/s/${token}/f/${nodeId}`,
  sharedFile: (token: string, nodeId: string) => `/s/${token}/file/${nodeId}`,
};

export function ui(page: Page) {
  return {
    // ── shell & rooms ───────────────────────────────────────────────────
    roomList: page.getByTestId('room-list'),
    roomListItem: (name: string) =>
      either(
        page.getByTestId('room-list-item').filter({ hasText: name }),
        page.getByRole('link', { name }),
      ),
    newRoomButton: either(
      page.getByTestId('new-room-button'),
      page.getByRole('button', { name: /new (data )?room/i }),
    ),
    roomNameInput: either(page.getByTestId('room-name-input'), page.getByRole('textbox')),
    roomNameSubmit: either(
      page.getByTestId('room-name-submit'),
      page.getByRole('button', { name: /^create$/i }),
    ),

    // ── browser ─────────────────────────────────────────────────────────
    breadcrumbs: either(page.getByTestId('breadcrumbs'), page.getByRole('navigation', { name: /breadcrumb/i })),
    breadcrumbItems: page.getByTestId('breadcrumb-item'),
    breadcrumbLink: (name: string) =>
      either(
        page.getByTestId('breadcrumb-item').filter({ hasText: name }),
        page.getByRole('navigation', { name: /breadcrumb/i }).getByText(name, { exact: true }),
      ),

    nodeTable: either(page.getByTestId('node-table'), page.getByRole('table')),
    rows: page.getByTestId('node-row'),
    rowById: (nodeId: string) => page.locator(`[data-node-id="${nodeId}"]`),
    rowByName: (name: string) =>
      either(
        page.getByTestId('node-row').filter({ hasText: name }),
        page.getByRole('row').filter({ hasText: name }),
      ),
    /** The action menu trigger inside a row — Rename · Move · Share · Download · Delete. */
    rowActions: (row: Locator) =>
      either(row.getByTestId('node-actions'), row.getByRole('button', { name: /actions|more/i })),
    menuItem: (name: RegExp) => page.getByRole('menuitem', { name }),

    newFolderButton: either(
      page.getByTestId('new-folder-button'),
      page.getByRole('button', { name: /new folder/i }),
    ),
    folderNameInput: either(
      page.getByTestId('folder-name-input'),
      page.getByRole('dialog').getByRole('textbox'),
    ),
    folderNameSubmit: either(
      page.getByTestId('folder-name-submit'),
      page.getByRole('button', { name: /^create$/i }),
    ),
    renameInput: either(page.getByTestId('rename-input'), page.getByRole('textbox', { name: /name/i })),
    renameError: page.getByTestId('rename-error'),

    // ── delete ──────────────────────────────────────────────────────────
    deleteDialog: either(page.getByTestId('delete-dialog'), page.getByRole('alertdialog')),
    deletePreview: page.getByTestId('delete-preview-summary'),
    deleteNameInput: page.getByTestId('delete-name-input'),
    deleteConfirm: either(
      page.getByTestId('delete-confirm'),
      page.getByRole('button', { name: /^delete$/i }),
    ),

    // ── uploads ─────────────────────────────────────────────────────────
    uploadButton: either(page.getByTestId('upload-button'), page.getByRole('button', { name: /upload/i })),
    fileInput: page.locator('input[type="file"]'),
    uploadQueue: page.getByTestId('upload-queue'),
    uploadItems: page.getByTestId('upload-item'),
    uploadItemByName: (name: string) => page.getByTestId('upload-item').filter({ hasText: name }),

    // ── viewer ──────────────────────────────────────────────────────────
    pdfViewer: page.getByTestId('pdf-viewer'),
    pdfPage: page.getByTestId('pdf-page'),
    unsupportedPreview: page.getByTestId('unsupported-preview'),
    downloadButton: either(
      page.getByTestId('download-button'),
      page.getByRole('button', { name: /download/i }),
    ),

    // ── sharing ─────────────────────────────────────────────────────────
    shareButton: either(page.getByTestId('share-button'), page.getByRole('button', { name: /^share$/i })),
    shareDialog: either(page.getByTestId('share-dialog'), page.getByRole('dialog', { name: /shar/i })),
    shareLinkTab: either(page.getByTestId('share-link-tab'), page.getByRole('tab', { name: /link/i })),
    sharePeopleTab: either(page.getByTestId('share-people-tab'), page.getByRole('tab', { name: /people/i })),
    shareLinkUrl: page.getByTestId('share-link-url'),
    shareCopy: either(page.getByTestId('share-copy'), page.getByRole('button', { name: /copy/i })),
    shareRevoke: either(page.getByTestId('share-revoke'), page.getByRole('button', { name: /revoke/i })),
    shareRevokeConfirm: either(
      page.getByTestId('share-revoke-confirm'),
      page.getByRole('button', { name: /revoke/i }).last(),
    ),
    recipientEmailInput: either(
      page.getByTestId('recipient-email-input'),
      page.getByRole('textbox', { name: /email/i }),
    ),
    recipientRow: (email: string) => page.getByTestId('recipient-row').filter({ hasText: email }),

    // ── layout, chosen from `access` and never from the route ───────────
    sharedLayout: page.getByTestId('shared-layout'),
    ownerLayout: page.getByTestId('owner-layout'),

    // ── the six designed access-failure screens ─────────────────────────
    state: {
      forbidden: either(page.getByTestId('state-forbidden'), page.getByText(/don't have access/i)),
      accessRevoked: either(
        page.getByTestId('state-access-revoked'),
        page.getByText(/access was removed/i),
      ),
      shareExpired: either(page.getByTestId('state-share-expired'), page.getByText(/expired/i)),
      itemGone: either(
        page.getByTestId('state-item-gone'),
        page.getByText(/(was|been) (deleted|removed) by the owner/i),
      ),
      wrongAccount: either(page.getByTestId('state-wrong-account'), page.getByText(/signed in as/i)),
      notFound: either(page.getByTestId('state-not-found'), page.getByText(/isn't valid|not found/i)),
    },
  };
}

export type Ui = ReturnType<typeof ui>;
