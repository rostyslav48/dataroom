import { describe, expect, it } from 'vitest';
import { ErrorCode, endpoints, fixtures } from '@dataroom/contracts';
import { useMockApi } from '@/test/msw';
import { ApiClientError } from '@/lib/api';
import {
  abortUpload,
  completeUpload,
  createDataRoom,
  createFolder,
  createShare,
  deleteNode,
  getDataRoom,
  getDeletePreview,
  getMe,
  getNode,
  getNodeStats,
  initUpload,
  listChildren,
  listDataRooms,
  listSharesForNode,
  moveNode,
  renameNode,
  resolveShare,
  retryUpload,
  revokeShare,
} from '@/lib/apiEndpoints';
import { handlerKeys } from './handlers';
import { clearForcedErrors, forceError } from './errorMode';
import { state } from './db';

useMockApi();

const { IDS } = fixtures;

describe('MSW handler coverage', () => {
  it('mocks every endpoint the contract declares', () => {
    const contractKeys = Object.entries(endpoints).flatMap(([group, groupEndpoints]) =>
      Object.keys(groupEndpoints).map((name) => `${group}.${name}`),
    );
    expect([...handlerKeys].sort()).toEqual([...contractKeys].sort());
  });
});

describe('fixtures are served', () => {
  it('serves the fixture user from /me', async () => {
    await expect(getMe()).resolves.toEqual(fixtures.users.owner);
  });

  it('serves the fixture data room in the owned section', async () => {
    const rooms = await listDataRooms();
    expect(rooms.owned.map((room) => room.id)).toEqual([IDS.room]);
    expect(rooms.sharedWithMe).toEqual([]);
  });

  it('serves the fixture tree with folders before files', async () => {
    const page = await listChildren(IDS.rootNode);
    expect(page.items.map((item) => item.name)).toEqual(['Financials', 'Legal', 'overview.pdf']);
    expect(page.nextCursor).toBeNull();
  });

  it('serves node detail with breadcrumbs root-first including the node itself', async () => {
    const detail = await getNode(IDS.folderQ3);
    expect(detail.access).toBe('owner');
    expect(detail.breadcrumbs.map((crumb) => crumb.name)).toEqual([
      'Project Atlas',
      'Financials',
      'Q3',
    ]);
    expect(detail.shareRootId).toBe(IDS.rootNode);
  });

  it('serves the fixture shares for a node', async () => {
    const { shares } = await listSharesForNode(IDS.folderFin);
    expect(shares.map((share) => share.id)).toEqual([IDS.shareLink]);
  });

  it('resolves the fixture public link token', async () => {
    const resolved = await resolveShare(fixtures.PUBLIC_LINK_TOKEN);
    expect(resolved.nodeId).toBe(IDS.folderFin);
    expect(resolved.nodeName).toBe('Financials');
  });
});

describe('a shared room is projected onto the caller’s share root', () => {
  // Both shapes satisfy `DataRoomDto.strict()`, so these assertions — not the contract tests —
  // are what keeps the mock honest about what a recipient actually receives.
  it('names a shared room for the share root and reports the share root’s rollups', async () => {
    state.currentUserId = IDS.viewer;
    const rooms = await listDataRooms();

    expect(rooms.owned).toEqual([]);
    expect(rooms.sharedWithMe).toHaveLength(1);
    expect(rooms.sharedWithMe[0]).toMatchObject({
      id: IDS.room, // the room's id: which room it is, is not a secret
      name: 'Legal', // …but its name, entry point and rollups are the grant's
      rootNodeId: IDS.folderLegal,
      access: 'viewer',
      fileCount: 1,
      sizeBytes: 1_048_576,
      ownerName: fixtures.users.owner.name,
    });
  });

  it('lists the room once when the caller holds several grants, entered at the shallowest', async () => {
    await createShare(IDS.folderQ3, { type: 'permissioned', recipients: ['viewer@example.com'] });
    state.currentUserId = IDS.viewer;

    const rooms = await listDataRooms();
    expect(rooms.sharedWithMe).toHaveLength(1);
    expect(rooms.sharedWithMe[0]?.rootNodeId).toBe(IDS.folderLegal);
  });

  it('projects GET /data-rooms/:id the same way for a recipient', async () => {
    state.currentUserId = IDS.viewer;
    const room = await getDataRoom(IDS.room);
    expect(room).toMatchObject({ name: 'Legal', rootNodeId: IDS.folderLegal, access: 'viewer' });
  });

  it('projects GET /data-rooms/:id onto a share token, with no session at all', async () => {
    state.currentUserId = null;
    const room = await getDataRoom(IDS.room, { shareToken: fixtures.PUBLIC_LINK_TOKEN });
    expect(room).toMatchObject({
      name: 'Financials',
      rootNodeId: IDS.folderFin,
      access: 'viewer',
      fileCount: 1,
      sizeBytes: 1_572_864,
    });
  });

  it('hides a room the caller neither owns nor holds a grant in', async () => {
    state.currentUserId = IDS.stranger;
    const error = await getDataRoom(IDS.room).catch((e: unknown) => e);
    expect((error as ApiClientError).code).toBe('NOT_FOUND');
    await expect(listDataRooms()).resolves.toEqual({ owned: [], sharedWithMe: [] });
  });

  it('drops a revoked grant from the list', async () => {
    await revokeShare(IDS.sharePerm);
    state.currentUserId = IDS.viewer;
    await expect(listDataRooms()).resolves.toEqual({ owned: [], sharedWithMe: [] });
  });
});

describe('a permissioned recipient reads through their grant', () => {
  it('answers GET /nodes/:id with the share root’s name as dataRoomName', async () => {
    state.currentUserId = IDS.viewer;
    const detail = await getNode(IDS.fileNda);

    expect(detail.access).toBe('viewer');
    expect(detail.shareRootId).toBe(IDS.folderLegal);
    expect(detail.dataRoomName).toBe('Legal');
    expect(detail.breadcrumbs.map((crumb) => crumb.name)).toEqual(['Legal', 'NDA.pdf']);
  });

  it('still gives the owner the room’s own name', async () => {
    const detail = await getNode(IDS.fileNda);
    expect(detail.access).toBe('owner');
    expect(detail.dataRoomName).toBe('Project Atlas');
  });

  it('forbids everything above and beside the grant', async () => {
    state.currentUserId = IDS.viewer;
    for (const id of [IDS.rootNode, IDS.folderFin, IDS.fileOrphan]) {
      const error = await getNode(id).catch((e: unknown) => e);
      expect((error as ApiClientError).code, id).toBe('FORBIDDEN');
    }
  });

  it('still answers ITEM_GONE, not FORBIDDEN, for a deleted node inside the grant', async () => {
    await deleteNode(IDS.fileNda);
    state.currentUserId = IDS.viewer;
    const error = await getNode(IDS.fileNda).catch((e: unknown) => e);
    expect((error as ApiClientError).code).toBe('ITEM_GONE');
  });
});

describe('pagination', () => {
  it('pages by cursor and only signals the end with nextCursor === null', async () => {
    const first = await listChildren(IDS.rootNode, { limit: 2 });
    expect(first.items).toHaveLength(2);
    expect(first.nextCursor).not.toBeNull();

    const second = await listChildren(IDS.rootNode, { limit: 2, cursor: first.nextCursor ?? '' });
    expect(second.items.map((item) => item.name)).toEqual(['overview.pdf']);
    expect(second.nextCursor).toBeNull();
  });

  it('never repeats or skips an item across pages', async () => {
    const seen: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await listChildren(IDS.rootNode, { limit: 1, cursor });
      seen.push(...page.items.map((item) => item.id));
      cursor = page.nextCursor ?? undefined;
    } while (cursor !== undefined);
    expect(new Set(seen).size).toBe(3);
  });
});

describe('the tree is mutable within a session', () => {
  it('reflects a created folder in the next listing', async () => {
    const created = await createFolder(IDS.rootNode, 'Diligence');
    const page = await listChildren(IDS.rootNode);
    expect(page.items.map((item) => item.name)).toContain('Diligence');
    expect(created.parentId).toBe(IDS.rootNode);
  });

  it('rejects a duplicate folder name with NAME_CONFLICT', async () => {
    const error = await createFolder(IDS.rootNode, 'Legal').catch((e: unknown) => e);
    expect((error as ApiClientError).code).toBe('NAME_CONFLICT');
  });

  it('reflects a rename', async () => {
    await renameNode(IDS.folderLegal, 'Contracts');
    const detail = await getNode(IDS.folderLegal);
    expect(detail.node.name).toBe('Contracts');
  });

  it('rejects a rename onto a sibling name', async () => {
    const error = await renameNode(IDS.folderLegal, 'Financials').catch((e: unknown) => e);
    expect((error as ApiClientError).code).toBe('NAME_CONFLICT');
  });

  it('reflects a move, and rejects a cycle', async () => {
    await moveNode(IDS.fileOrphan, IDS.folderLegal);
    const legal = await listChildren(IDS.folderLegal);
    expect(legal.items.map((item) => item.name)).toContain('overview.pdf');

    const error = await moveNode(IDS.folderFin, IDS.folderQ3).catch((e: unknown) => e);
    expect((error as ApiClientError).code).toBe('CYCLE_NOT_ALLOWED');
  });

  it('treats a move to the current parent as a no-op success', async () => {
    await expect(moveNode(IDS.fileOrphan, IDS.rootNode)).resolves.toMatchObject({
      parentId: IDS.rootNode,
    });
  });

  it('deletes a subtree and then answers ITEM_GONE for its members', async () => {
    await deleteNode(IDS.folderFin);
    const page = await listChildren(IDS.rootNode);
    expect(page.items.map((item) => item.name)).not.toContain('Financials');

    const error = await getNode(IDS.folderQ3).catch((e: unknown) => e);
    expect((error as ApiClientError).code).toBe('ITEM_GONE');
  });

  it('auto-revokes shares rooted inside a deleted subtree', async () => {
    await deleteNode(IDS.folderFin);
    const error = await resolveShare(fixtures.PUBLIC_LINK_TOKEN).catch((e: unknown) => e);
    expect((error as ApiClientError).code).toBe('ACCESS_REVOKED');
  });

  it('recomputes rollups after a create and a delete', async () => {
    const before = await getNodeStats(IDS.rootNode);
    expect(before.fileCount).toBe(3);
    await deleteNode(IDS.fileOrphan);
    const after = await getNodeStats(IDS.rootNode);
    expect(after.fileCount).toBe(2);
  });

  it('creates a data room with its root node atomically', async () => {
    const room = await createDataRoom('Project Beta');
    const detail = await getNode(room.rootNodeId);
    expect(detail.node.name).toBe('Project Beta');
    expect(detail.node.parentId).toBeNull();
  });

  it('counts exactly what a delete would destroy', async () => {
    const preview = await getDeletePreview(IDS.folderFin);
    expect(preview).toEqual({
      sizeBytes: 1_572_864,
      fileCount: 1,
      folderCount: 1,
      affectedShareCount: 1,
    });
  });
});

describe('uploads', () => {
  it('auto-suffixes a conflicting name and reports it as finalName', async () => {
    const init = await initUpload({
      parentId: IDS.rootNode,
      name: 'overview.pdf',
      sizeBytes: 1024,
      mimeType: 'application/pdf',
    });
    expect(init.finalName).toBe('overview (2).pdf');
  });

  it('keeps the node invisible until complete, then shows it', async () => {
    const init = await initUpload({
      parentId: IDS.rootNode,
      name: 'new.pdf',
      sizeBytes: 1024,
      mimeType: 'application/pdf',
    });
    const before = await listChildren(IDS.rootNode);
    expect(before.items.map((item) => item.name)).not.toContain('new.pdf');

    await completeUpload(init.versionId);
    const after = await listChildren(IDS.rootNode);
    expect(after.items.map((item) => item.name)).toContain('new.pdf');
  });

  it('retry issues a fresh URL for the same version without reserving a second node', async () => {
    const init = await initUpload({
      parentId: IDS.rootNode,
      name: 'retry.pdf',
      sizeBytes: 1024,
      mimeType: 'application/pdf',
    });
    const retry = await retryUpload(init.versionId);
    expect(retry.uploadUrl).toContain(init.versionId);
    expect(state.uploads.size).toBe(1);
  });

  it('rejects an oversize file at init', async () => {
    const error = await initUpload({
      parentId: IDS.rootNode,
      name: 'huge.pdf',
      sizeBytes: 200_000_000,
      mimeType: 'application/pdf',
    }).catch((e: unknown) => e);
    expect((error as ApiClientError).code).toBe('FILE_TOO_LARGE');
  });

  it('rejects a disallowed mime type at init', async () => {
    const error = await initUpload({
      parentId: IDS.rootNode,
      name: 'app.exe',
      sizeBytes: 10,
      mimeType: 'application/x-msdownload',
    }).catch((e: unknown) => e);
    expect((error as ApiClientError).code).toBe('UNSUPPORTED_TYPE');
  });

  it('refuses to complete an aborted upload', async () => {
    const init = await initUpload({
      parentId: IDS.rootNode,
      name: 'gone.pdf',
      sizeBytes: 10,
      mimeType: 'application/pdf',
    });
    await abortUpload(init.versionId);
    const error = await completeUpload(init.versionId).catch((e: unknown) => e);
    expect((error as ApiClientError).code).toBe('UPLOAD_INCOMPLETE');
  });
});

describe('share-token scoping', () => {
  it('serves a node inside the shared subtree as a viewer, rooted at the share', async () => {
    const detail = await getNode(IDS.folderQ3, { shareToken: fixtures.PUBLIC_LINK_TOKEN });
    expect(detail.access).toBe('viewer');
    expect(detail.shareRootId).toBe(IDS.folderFin);
    expect(detail.breadcrumbs.map((crumb) => crumb.name)).toEqual(['Financials', 'Q3']);
  });

  it('forbids a sibling outside the shared subtree', async () => {
    const error = await getNode(IDS.fileOrphan, {
      shareToken: fixtures.PUBLIC_LINK_TOKEN,
    }).catch((e: unknown) => e);
    expect((error as ApiClientError).code).toBe('FORBIDDEN');
  });

  it('denies the next request after the share is revoked, and says why', async () => {
    await revokeShare(IDS.shareLink);
    const error = await getNode(IDS.folderFin, {
      shareToken: fixtures.PUBLIC_LINK_TOKEN,
    }).catch((e: unknown) => e);
    expect((error as ApiClientError).code).toBe('ACCESS_REVOKED');
  });

  it('answers NOT_FOUND for a token that was never minted', async () => {
    const error = await resolveShare('NEVERMINTEDTOKEN000000').catch((e: unknown) => e);
    expect((error as ApiClientError).code).toBe('NOT_FOUND');
  });

  it('reports an expired share distinctly from a revoked one', async () => {
    const share = await createShare(IDS.folderLegal, {
      type: 'public_link',
      expiresAt: new Date(Date.now() - 60_000).toISOString(),
    });
    const token = share.url?.split('/s/')[1] ?? '';
    const error = await resolveShare(token).catch((e: unknown) => e);
    expect((error as ApiClientError).code).toBe('SHARE_EXPIRED');
  });
});

describe('forced-error mode', () => {
  it('can produce every code in the contract on demand', async () => {
    for (const code of ErrorCode.options) {
      // Two failures, not one: a 401 UNAUTHENTICATED is answered by the client with a refresh and
      // a replay, so a single forced failure would be swallowed by exactly the behaviour that is
      // supposed to swallow it.
      clearForcedErrors();
      forceError(code, { endpointKey: 'nodes.get', times: 2 });
      const error = await getNode(IDS.rootNode).catch((e: unknown) => e);
      expect((error as ApiClientError).code, code).toBe(code);
    }
    clearForcedErrors();
  });

  it('expires a times-limited rule after its budget', async () => {
    forceError('INTERNAL', { endpointKey: 'nodes.children', times: 1 });
    await expect(listChildren(IDS.rootNode)).rejects.toThrow();
    await expect(listChildren(IDS.rootNode)).resolves.toBeDefined();
  });

  it('scopes a rule to one endpoint, leaving the others working', async () => {
    forceError('INTERNAL', { endpointKey: 'nodes.children' });
    await expect(listChildren(IDS.rootNode)).rejects.toThrow();
    await expect(getNode(IDS.rootNode)).resolves.toBeDefined();
  });
});

describe('authentication state', () => {
  it('answers 401 UNAUTHENTICATED when there is no session', async () => {
    state.currentUserId = null;
    const error = await getMe().catch((e: unknown) => e);
    expect((error as ApiClientError).code).toBe('UNAUTHENTICATED');
  });
});

describe('search', () => {
  it('reports filename search as unavailable, so no search control should be rendered', async () => {
    const error = await listChildren(IDS.rootNode, { q: 'balance' }).catch((e: unknown) => e);
    expect((error as ApiClientError).code).toBe('NOT_FOUND');
  });
});
