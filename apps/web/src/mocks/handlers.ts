import { http, HttpResponse, type PathParams, type RequestHandler } from 'msw';
import {
  ALLOWED_MIME_TYPES,
  API_BASE,
  AddRecipientsBody,
  CreateDataRoomBody,
  CreateFolderBody,
  CreateShareBody,
  ERROR_STATUS,
  ListChildrenQuery,
  MoveNodeBody,
  RenameNodeBody,
  SHARE_TOKEN_HEADER,
  UpdateDataRoomBody,
  endpoints,
  fixtures,
  type AccessLevel,
  type BreadcrumbDto,
  type DataRoomDto,
  type EndpointDescriptor,
  type ErrorCode,
  type NodeDto,
  type ShareDto,
} from '@dataroom/contracts';
import {
  ancestorsOf,
  childrenOf,
  coveringShareRootFor,
  getNode,
  insertNode,
  isDescendantOf,
  findShareByToken,
  makeRecipient,
  mockUuid,
  nameTaken,
  nextAvailableName,
  paginate,
  projectRoomOntoShareRoot,
  publicLinkUrl,
  recomputeRollups,
  removeSubtree,
  shallowestShareRootIn,
  sharedRoomsFor,
  state,
  statsFor,
  subtreeOf,
} from './db';
import { takeForcedError } from './errorMode';

/**
 * MSW handlers built from the contract's `endpoints` and served from the shared `fixtures`.
 *
 * Paths come from the contract rather than being retyped, so a path typo is a compile error here
 * exactly as it is in the backend's controllers. Behaviour — conflicts, cycles, pagination,
 * auto-suffixing, share scoping — is modelled rather than stubbed, because the components under
 * test branch on all of it.
 */

const MAX_UPLOAD_BYTES = 104_857_600;
const STORAGE_ORIGIN = 'https://storage.mock.local';

/** A single-page PDF, so the viewer has something real to render in mock mode. */
const MINIMAL_PDF = [
  '%PDF-1.4',
  '1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj',
  '2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj',
  '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj',
  'trailer<</Root 1 0 R>>',
  '%%EOF',
].join('\n');

const path = (endpoint: EndpointDescriptor): string => `*${API_BASE}${endpoint.path}`;

let requestSeq = 0;
function apiError(code: ErrorCode, message: string, details?: Record<string, string[]>): Response {
  requestSeq += 1;
  return HttpResponse.json(
    {
      code,
      message,
      requestId: `mock-request-${String(requestSeq)}`,
      ...(details === undefined ? {} : { details }),
    },
    { status: ERROR_STATUS[code] },
  );
}

const param = (params: PathParams, key: string): string => {
  const value = params[key];
  if (Array.isArray(value)) return value[0] ?? '';
  return typeof value === 'string' ? value : '';
};

function requireSession(): Response | null {
  return state.currentUserId === null
    ? apiError('UNAUTHENTICATED', 'No session')
    : null;
}

/**
 * The API refuses to make the room's owner a recipient of their own share — the row would grant
 * nothing and cannot be revoked away. Mirrored here so the mocked app fails the same way.
 */
function rejectOwnAddress(emails: string[]): Response | null {
  const self = Object.values(fixtures.users).find((user) => user.id === state.currentUserId);
  if (self === undefined) return null;
  return emails.some((email) => email.toLowerCase() === self.email.toLowerCase())
    ? apiError('VALIDATION_FAILED', 'Cannot invite yourself', {
        emails: ['You already have access to this as its owner, so you cannot invite yourself.'],
      })
    : null;
}

interface ResolvedAccess {
  access: AccessLevel;
  shareRootId: string;
}

/** A live share for this token, or the designed failure that explains why there isn't one. */
function shareForToken(token: string): ShareDto | Response {
  const share = findShareByToken(token);
  if (share === undefined) return apiError('NOT_FOUND', 'Unknown share token');
  if (share.revokedAt !== null) return apiError('ACCESS_REVOKED', 'This share was revoked');
  if (share.expiresAt !== null && Date.parse(share.expiresAt) < Date.now()) {
    return apiError('SHARE_EXPIRED', 'This share expired');
  }
  return share;
}

/**
 * The permission answer, modelled the way the backend's guard answers it: a grant — a token, or a
 * permissioned share held by the signed-in caller — scopes them to one subtree, and everything
 * outside it is FORBIDDEN rather than merely absent.
 *
 * A caller who is neither the room's owner nor a recipient is refused, so "the mock always says
 * owner" can never again hide a viewer-only bug.
 */
function resolveAccess(nodeId: string, request: Request): ResolvedAccess | Response {
  const token = request.headers.get(SHARE_TOKEN_HEADER);
  if (token !== null && token !== '') {
    const share = shareForToken(token);
    if (isResponse(share)) return share;
    if (!isDescendantOf(nodeId, share.nodeId)) {
      return apiError('FORBIDDEN', 'Outside the shared subtree');
    }
    return { access: 'viewer', shareRootId: share.nodeId };
  }

  const unauthenticated = requireSession();
  if (unauthenticated !== null) return unauthenticated;
  const userId = state.currentUserId ?? '';

  if (state.forcedAccess === 'viewer') {
    return { access: 'viewer', shareRootId: state.forcedShareRootId ?? nodeId };
  }

  const node = getNode(nodeId);
  // A node that is gone has no permissions left to evaluate; `nodeOr404` answers 404 or 410.
  if (node === undefined) return { access: 'owner', shareRootId: fixtures.IDS.rootNode };

  const room = state.rooms.find((candidate) => candidate.id === node.dataRoomId);
  if (room !== undefined && room.ownerId === userId) {
    return { access: 'owner', shareRootId: room.rootNodeId };
  }

  const shareRootId = coveringShareRootFor(userId, nodeId);
  if (shareRootId !== null) return { access: 'viewer', shareRootId };
  if (room === undefined) return { access: 'owner', shareRootId: fixtures.IDS.rootNode };
  return apiError('FORBIDDEN', 'You have no grant covering this item');
}

function nodeOr404(id: string): NodeDto | Response {
  const node = getNode(id);
  if (node !== undefined) return node;
  return state.deletedIds.has(id)
    ? apiError('ITEM_GONE', 'This item was deleted by the owner')
    : apiError('NOT_FOUND', 'No such node');
}

const isResponse = (value: unknown): value is Response => value instanceof Response;

function breadcrumbsFor(nodeId: string, shareRootId: string): BreadcrumbDto[] {
  const chain = ancestorsOf(nodeId);
  const rootIndex = chain.findIndex((node) => node.id === shareRootId);
  const visible = rootIndex === -1 ? chain : chain.slice(rootIndex);
  return visible.map((node) => ({ id: node.id, name: node.name, type: node.type }));
}

function folderNode(id: string, parentId: string | null, dataRoomId: string, name: string): NodeDto {
  const now = new Date().toISOString();
  return {
    id,
    dataRoomId,
    parentId,
    type: 'folder',
    name,
    sizeBytes: null,
    mimeType: null,
    subtreeFileCount: 0,
    subtreeSizeBytes: 0,
    createdAt: now,
    updatedAt: now,
  };
}

async function readBody(request: Request): Promise<unknown> {
  try {
    return (await request.json()) as unknown;
  } catch {
    return undefined;
  }
}

interface HandlerSpec {
  key: string;
  endpoint: EndpointDescriptor;
  resolve: (info: { request: Request; params: PathParams }) => Response | Promise<Response>;
}

const specs: HandlerSpec[] = [
  // ── auth ───────────────────────────────────────────────────────────────────────────────────
  {
    key: 'auth.googleStart',
    endpoint: endpoints.auth.googleStart,
    resolve: ({ request }) => {
      const returnTo = new URL(request.url).searchParams.get('returnTo') ?? '/rooms';
      return new HttpResponse(null, {
        status: 302,
        headers: { Location: `${API_BASE}/auth/google/callback?state=${encodeURIComponent(returnTo)}` },
      });
    },
  },
  {
    key: 'auth.googleCallback',
    endpoint: endpoints.auth.googleCallback,
    resolve: ({ request }) => {
      state.currentUserId = fixtures.IDS.owner;
      const returnTo = new URL(request.url).searchParams.get('state') ?? '/rooms';
      return new HttpResponse(null, { status: 302, headers: { Location: returnTo } });
    },
  },
  {
    key: 'auth.refresh',
    endpoint: endpoints.auth.refresh,
    resolve: ({ request }) => {
      const forced = takeForcedError('auth.refresh', request.url);
      if (forced !== null) return apiError(forced, `Forced ${forced}`);
      if (state.currentUserId === null) return apiError('UNAUTHENTICATED', 'No refresh cookie');
      const signedIn = Object.values(fixtures.users).find((u) => u.id === state.currentUserId);
      return HttpResponse.json({
        user: signedIn ?? fixtures.users.owner,
        accessToken: `mock-access-token-${String(Date.now())}`,
        accessTokenExpiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
      });
    },
  },
  {
    key: 'auth.logout',
    endpoint: endpoints.auth.logout,
    resolve: () => {
      state.currentUserId = null;
      return new HttpResponse(null, { status: 204 });
    },
  },
  {
    key: 'auth.me',
    endpoint: endpoints.auth.me,
    resolve: ({ request }) => {
      const forced = takeForcedError('auth.me', request.url);
      if (forced !== null) return apiError(forced, `Forced ${forced}`);
      const unauthenticated = requireSession();
      if (unauthenticated !== null) return unauthenticated;
      const user = Object.values(fixtures.users).find((u) => u.id === state.currentUserId);
      return HttpResponse.json(user ?? fixtures.users.owner);
    },
  },

  // ── data rooms ─────────────────────────────────────────────────────────────────────────────
  {
    key: 'dataRooms.list',
    endpoint: endpoints.dataRooms.list,
    resolve: ({ request }) => {
      const forced = takeForcedError('dataRooms.list', request.url);
      if (forced !== null) return apiError(forced, `Forced ${forced}`);
      const unauthenticated = requireSession();
      if (unauthenticated !== null) return unauthenticated;
      const userId = state.currentUserId ?? '';
      return HttpResponse.json({
        owned: state.rooms.filter((room) => room.ownerId === userId),
        // Projected onto each share root, exactly as the API does it.
        sharedWithMe: sharedRoomsFor(userId),
      });
    },
  },
  {
    key: 'dataRooms.create',
    endpoint: endpoints.dataRooms.create,
    resolve: async ({ request }) => {
      const forced = takeForcedError('dataRooms.create', request.url);
      if (forced !== null) return apiError(forced, `Forced ${forced}`);
      const unauthenticated = requireSession();
      if (unauthenticated !== null) return unauthenticated;

      const parsed = CreateDataRoomBody.safeParse(await readBody(request));
      if (!parsed.success) return apiError('VALIDATION_FAILED', 'Invalid room name', { name: ['Invalid'] });

      const roomId = mockUuid();
      const rootId = mockUuid();
      insertNode(folderNode(rootId, null, roomId, parsed.data.name));
      const now = new Date().toISOString();
      // Owned by whoever is signed in, so a created room lands in *their* `owned` list.
      const creator =
        Object.values(fixtures.users).find((user) => user.id === state.currentUserId) ??
        fixtures.users.owner;
      const room: DataRoomDto = {
        id: roomId,
        name: parsed.data.name,
        rootNodeId: rootId,
        ownerId: creator.id,
        ownerName: creator.name,
        access: 'owner',
        fileCount: 0,
        sizeBytes: 0,
        createdAt: now,
        updatedAt: now,
      };
      state.rooms.push(room);
      return HttpResponse.json(room, { status: 201 });
    },
  },
  {
    key: 'dataRooms.get',
    endpoint: endpoints.dataRooms.get,
    resolve: ({ request, params }) => {
      const forced = takeForcedError('dataRooms.get', request.url);
      if (forced !== null) return apiError(forced, `Forced ${forced}`);
      const id = param(params, 'id');
      const room = state.rooms.find((candidate) => candidate.id === id);

      // A token carries its own grant, so this branch answers with no session at all.
      const token = request.headers.get(SHARE_TOKEN_HEADER);
      if (token !== null && token !== '') {
        const share = shareForToken(token);
        if (isResponse(share)) return share;
        const shareRoot = getNode(share.nodeId);
        if (room === undefined || shareRoot === undefined || shareRoot.dataRoomId !== id) {
          return apiError('NOT_FOUND', 'No such data room');
        }
        return HttpResponse.json(projectRoomOntoShareRoot(room, shareRoot));
      }

      const unauthenticated = requireSession();
      if (unauthenticated !== null) return unauthenticated;
      const userId = state.currentUserId ?? '';
      if (room === undefined) return apiError('NOT_FOUND', 'No such data room');
      if (room.ownerId === userId) return HttpResponse.json(room);

      const shareRoot = shallowestShareRootIn(userId, room.id);
      // A room the caller holds no grant in is not merely unreadable — it is not theirs to know of.
      return shareRoot === undefined
        ? apiError('NOT_FOUND', 'No such data room')
        : HttpResponse.json(projectRoomOntoShareRoot(room, shareRoot));
    },
  },
  {
    key: 'dataRooms.update',
    endpoint: endpoints.dataRooms.update,
    resolve: async ({ request, params }) => {
      const forced = takeForcedError('dataRooms.update', request.url);
      if (forced !== null) return apiError(forced, `Forced ${forced}`);
      const room = state.rooms.find((candidate) => candidate.id === param(params, 'id'));
      if (room === undefined) return apiError('NOT_FOUND', 'No such data room');
      const parsed = UpdateDataRoomBody.safeParse(await readBody(request));
      if (!parsed.success) return apiError('VALIDATION_FAILED', 'Invalid room name');
      room.name = parsed.data.name;
      room.updatedAt = new Date().toISOString();
      const root = getNode(room.rootNodeId);
      if (root !== undefined) root.name = parsed.data.name;
      return HttpResponse.json(room);
    },
  },
  {
    key: 'dataRooms.remove',
    endpoint: endpoints.dataRooms.remove,
    resolve: ({ request, params }) => {
      const forced = takeForcedError('dataRooms.remove', request.url);
      if (forced !== null) return apiError(forced, `Forced ${forced}`);
      const id = param(params, 'id');
      const room = state.rooms.find((candidate) => candidate.id === id);
      if (room === undefined) return apiError('NOT_FOUND', 'No such data room');
      removeSubtree(room.rootNodeId);
      state.rooms = state.rooms.filter((candidate) => candidate.id !== id);
      return new HttpResponse(null, { status: 204 });
    },
  },

  // ── nodes ──────────────────────────────────────────────────────────────────────────────────
  {
    key: 'nodes.get',
    endpoint: endpoints.nodes.get,
    resolve: ({ request, params }) => {
      const forced = takeForcedError('nodes.get', request.url);
      if (forced !== null) return apiError(forced, `Forced ${forced}`);
      const id = param(params, 'id');
      const access = resolveAccess(id, request);
      if (isResponse(access)) return access;
      const node = nodeOr404(id);
      if (isResponse(node)) return node;
      const room = state.rooms.find((candidate) => candidate.id === node.dataRoomId);
      // For a viewer this names their share root, not the room: the room's name is outside the
      // grant, and this string is what the chrome above the breadcrumbs shows.
      const dataRoomName =
        access.access === 'viewer'
          ? (getNode(access.shareRootId)?.name ?? node.name)
          : (room?.name ?? fixtures.dataRoom.name);
      return HttpResponse.json({
        node,
        breadcrumbs: breadcrumbsFor(id, access.shareRootId),
        access: access.access,
        shareRootId: access.shareRootId,
        dataRoomName,
      });
    },
  },
  {
    key: 'nodes.children',
    endpoint: endpoints.nodes.children,
    resolve: ({ request, params }) => {
      const forced = takeForcedError('nodes.children', request.url);
      if (forced !== null) return apiError(forced, `Forced ${forced}`);
      const id = param(params, 'id');
      const access = resolveAccess(id, request);
      if (isResponse(access)) return access;
      const node = nodeOr404(id);
      if (isResponse(node)) return node;

      const query = ListChildrenQuery.safeParse(
        Object.fromEntries(new URL(request.url).searchParams.entries()),
      );
      if (!query.success) return apiError('VALIDATION_FAILED', 'Invalid list query');
      // Filename search is not implemented server-side; the contract permits 404 until it ships.
      if (query.data.q !== undefined) return apiError('NOT_FOUND', 'Search is not available');

      const page = paginate(childrenOf(id), {
        sort: query.data.sort,
        dir: query.data.dir,
        cursor: query.data.cursor,
        limit: query.data.limit,
      });
      return HttpResponse.json(page);
    },
  },
  {
    key: 'nodes.stats',
    endpoint: endpoints.nodes.stats,
    resolve: ({ request, params }) => {
      const forced = takeForcedError('nodes.stats', request.url);
      if (forced !== null) return apiError(forced, `Forced ${forced}`);
      const id = param(params, 'id');
      const access = resolveAccess(id, request);
      if (isResponse(access)) return access;
      const node = nodeOr404(id);
      if (isResponse(node)) return node;
      return HttpResponse.json(statsFor(id));
    },
  },
  {
    key: 'nodes.deletePreview',
    endpoint: endpoints.nodes.deletePreview,
    resolve: ({ request, params }) => {
      const forced = takeForcedError('nodes.deletePreview', request.url);
      if (forced !== null) return apiError(forced, `Forced ${forced}`);
      const unauthenticated = requireSession();
      if (unauthenticated !== null) return unauthenticated;
      const id = param(params, 'id');
      const node = nodeOr404(id);
      if (isResponse(node)) return node;
      const affectedShareCount = state.shares.filter(
        (share) => share.revokedAt === null && isDescendantOf(share.nodeId, id),
      ).length;
      return HttpResponse.json({ ...statsFor(id), affectedShareCount });
    },
  },
  {
    key: 'nodes.createFolder',
    endpoint: endpoints.nodes.createFolder,
    resolve: async ({ request }) => {
      const forced = takeForcedError('nodes.createFolder', request.url);
      if (forced !== null) return apiError(forced, `Forced ${forced}`);
      const unauthenticated = requireSession();
      if (unauthenticated !== null) return unauthenticated;

      const parsed = CreateFolderBody.safeParse(await readBody(request));
      if (!parsed.success) {
        return apiError('VALIDATION_FAILED', 'Invalid folder', {
          name: parsed.error.issues.map((issue) => issue.message),
        });
      }
      const parent = nodeOr404(parsed.data.parentId);
      if (isResponse(parent)) return parent;
      if (parent.type !== 'folder') return apiError('INVALID_MOVE_TARGET', 'Parent is not a folder');
      if (nameTaken(parent.id, parsed.data.name)) {
        return apiError('NAME_CONFLICT', 'A folder with that name already exists');
      }
      const created = insertNode(
        folderNode(mockUuid(), parent.id, parent.dataRoomId, parsed.data.name),
      );
      return HttpResponse.json(created, { status: 201 });
    },
  },
  {
    key: 'nodes.rename',
    endpoint: endpoints.nodes.rename,
    resolve: async ({ request, params }) => {
      const forced = takeForcedError('nodes.rename', request.url);
      if (forced !== null) return apiError(forced, `Forced ${forced}`);
      const unauthenticated = requireSession();
      if (unauthenticated !== null) return unauthenticated;

      const id = param(params, 'id');
      const node = nodeOr404(id);
      if (isResponse(node)) return node;
      const parsed = RenameNodeBody.safeParse(await readBody(request));
      if (!parsed.success) {
        return apiError('VALIDATION_FAILED', 'Invalid name', {
          name: parsed.error.issues.map((issue) => issue.message),
        });
      }
      if (node.parentId !== null && nameTaken(node.parentId, parsed.data.name, node.id)) {
        return apiError('NAME_CONFLICT', 'That name is already taken in this folder');
      }
      node.name = parsed.data.name;
      node.updatedAt = new Date().toISOString();
      for (const share of state.shares) {
        if (share.nodeId === node.id) share.nodeName = node.name;
      }
      return HttpResponse.json(node);
    },
  },
  {
    key: 'nodes.move',
    endpoint: endpoints.nodes.move,
    resolve: async ({ request, params }) => {
      const forced = takeForcedError('nodes.move', request.url);
      if (forced !== null) return apiError(forced, `Forced ${forced}`);
      const unauthenticated = requireSession();
      if (unauthenticated !== null) return unauthenticated;

      const id = param(params, 'id');
      const node = nodeOr404(id);
      if (isResponse(node)) return node;
      const parsed = MoveNodeBody.safeParse(await readBody(request));
      if (!parsed.success) return apiError('VALIDATION_FAILED', 'Invalid move target');

      const target = getNode(parsed.data.parentId);
      if (target === undefined) return apiError('NOT_FOUND', 'No such destination');
      if (target.type !== 'folder') return apiError('INVALID_MOVE_TARGET', 'Destination is not a folder');
      if (target.dataRoomId !== node.dataRoomId) {
        return apiError('INVALID_MOVE_TARGET', 'Destination is in another data room');
      }
      if (isDescendantOf(target.id, node.id)) {
        return apiError('CYCLE_NOT_ALLOWED', "A folder can't be moved inside itself");
      }
      if (node.parentId === target.id) return HttpResponse.json(node);
      if (nameTaken(target.id, node.name, node.id)) {
        return apiError('NAME_CONFLICT', 'The destination already has an item with that name');
      }
      node.parentId = target.id;
      node.updatedAt = new Date().toISOString();
      recomputeRollups();
      return HttpResponse.json(node);
    },
  },
  {
    key: 'nodes.remove',
    endpoint: endpoints.nodes.remove,
    resolve: ({ request, params }) => {
      const forced = takeForcedError('nodes.remove', request.url);
      if (forced !== null) return apiError(forced, `Forced ${forced}`);
      const unauthenticated = requireSession();
      if (unauthenticated !== null) return unauthenticated;
      const id = param(params, 'id');
      const node = nodeOr404(id);
      if (isResponse(node)) return node;
      removeSubtree(node.id);
      return new HttpResponse(null, { status: 204 });
    },
  },
  {
    key: 'nodes.content',
    endpoint: endpoints.nodes.content,
    resolve: ({ request, params }) => {
      const forced = takeForcedError('nodes.content', request.url);
      if (forced !== null) return apiError(forced, `Forced ${forced}`);
      const id = param(params, 'id');
      const access = resolveAccess(id, request);
      if (isResponse(access)) return access;
      const node = nodeOr404(id);
      if (isResponse(node)) return node;
      return new HttpResponse(null, {
        status: 302,
        headers: { Location: `${STORAGE_ORIGIN}/objects/${id}?disposition=inline` },
      });
    },
  },
  {
    key: 'nodes.download',
    endpoint: endpoints.nodes.download,
    resolve: ({ request, params }) => {
      const forced = takeForcedError('nodes.download', request.url);
      if (forced !== null) return apiError(forced, `Forced ${forced}`);
      const id = param(params, 'id');
      const access = resolveAccess(id, request);
      if (isResponse(access)) return access;
      const node = nodeOr404(id);
      if (isResponse(node)) return node;
      return new HttpResponse(null, {
        status: 302,
        headers: { Location: `${STORAGE_ORIGIN}/objects/${id}?disposition=attachment` },
      });
    },
  },

  // ── uploads ────────────────────────────────────────────────────────────────────────────────
  {
    key: 'uploads.init',
    endpoint: endpoints.uploads.init,
    resolve: async ({ request }) => {
      const forced = takeForcedError('uploads.init', request.url);
      if (forced !== null) return apiError(forced, `Forced ${forced}`);
      const unauthenticated = requireSession();
      if (unauthenticated !== null) return unauthenticated;

      const body = (await readBody(request)) as {
        parentId?: string;
        name?: string;
        sizeBytes?: number;
        mimeType?: string;
      };
      if (body.parentId === undefined || body.name === undefined || body.mimeType === undefined) {
        return apiError('VALIDATION_FAILED', 'Invalid upload');
      }
      if ((body.sizeBytes ?? 0) > MAX_UPLOAD_BYTES) {
        return apiError('FILE_TOO_LARGE', 'That file is over the 100 MB limit');
      }
      if (!(ALLOWED_MIME_TYPES as readonly string[]).includes(body.mimeType)) {
        return apiError('UNSUPPORTED_TYPE', 'That file type is not accepted');
      }
      const parent = nodeOr404(body.parentId);
      if (isResponse(parent)) return parent;

      const versionId = mockUuid();
      const nodeId = mockUuid();
      const finalName = nextAvailableName(parent.id, body.name);
      state.uploads.set(versionId, {
        versionId,
        nodeId,
        parentId: parent.id,
        finalName,
        sizeBytes: body.sizeBytes ?? 0,
        mimeType: body.mimeType,
        completed: false,
        aborted: false,
      });
      return HttpResponse.json(
        {
          nodeId,
          versionId,
          uploadUrl: `${STORAGE_ORIGIN}/upload/${versionId}`,
          uploadExpiresAt: new Date(Date.now() + 3_600_000).toISOString(),
          finalName,
        },
        { status: 201 },
      );
    },
  },
  {
    key: 'uploads.complete',
    endpoint: endpoints.uploads.complete,
    resolve: ({ request, params }) => {
      const forced = takeForcedError('uploads.complete', request.url);
      if (forced !== null) return apiError(forced, `Forced ${forced}`);
      const record = state.uploads.get(param(params, 'versionId'));
      if (record === undefined) return apiError('NOT_FOUND', 'No such upload');
      if (record.aborted) return apiError('UPLOAD_INCOMPLETE', 'That upload was aborted');
      const now = new Date().toISOString();
      const node: NodeDto = {
        id: record.nodeId,
        dataRoomId: getNode(record.parentId)?.dataRoomId ?? fixtures.IDS.room,
        parentId: record.parentId,
        type: 'file',
        name: record.finalName,
        sizeBytes: record.sizeBytes,
        mimeType: record.mimeType,
        subtreeFileCount: null,
        subtreeSizeBytes: null,
        createdAt: now,
        updatedAt: now,
      };
      record.completed = true;
      insertNode(node);
      return HttpResponse.json({ node });
    },
  },
  {
    key: 'uploads.retry',
    endpoint: endpoints.uploads.retry,
    resolve: ({ request, params }) => {
      const forced = takeForcedError('uploads.retry', request.url);
      if (forced !== null) return apiError(forced, `Forced ${forced}`);
      const versionId = param(params, 'versionId');
      const record = state.uploads.get(versionId);
      if (record === undefined) return apiError('NOT_FOUND', 'No such upload');
      return HttpResponse.json({
        uploadUrl: `${STORAGE_ORIGIN}/upload/${versionId}?attempt=${String(Date.now())}`,
        uploadExpiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      });
    },
  },
  {
    key: 'uploads.abort',
    endpoint: endpoints.uploads.abort,
    resolve: ({ request, params }) => {
      const forced = takeForcedError('uploads.abort', request.url);
      if (forced !== null) return apiError(forced, `Forced ${forced}`);
      const record = state.uploads.get(param(params, 'versionId'));
      if (record === undefined) return apiError('NOT_FOUND', 'No such upload');
      record.aborted = true;
      return new HttpResponse(null, { status: 204 });
    },
  },

  // ── shares ─────────────────────────────────────────────────────────────────────────────────
  {
    key: 'shares.listForNode',
    endpoint: endpoints.shares.listForNode,
    resolve: ({ request, params }) => {
      const forced = takeForcedError('shares.listForNode', request.url);
      if (forced !== null) return apiError(forced, `Forced ${forced}`);
      const unauthenticated = requireSession();
      if (unauthenticated !== null) return unauthenticated;
      const id = param(params, 'id');
      return HttpResponse.json({ shares: state.shares.filter((share) => share.nodeId === id) });
    },
  },
  {
    key: 'shares.create',
    endpoint: endpoints.shares.create,
    resolve: async ({ request, params }) => {
      const forced = takeForcedError('shares.create', request.url);
      if (forced !== null) return apiError(forced, `Forced ${forced}`);
      const unauthenticated = requireSession();
      if (unauthenticated !== null) return unauthenticated;

      const id = param(params, 'id');
      const node = nodeOr404(id);
      if (isResponse(node)) return node;
      const parsed = CreateShareBody.safeParse(await readBody(request));
      if (!parsed.success) {
        return apiError('VALIDATION_FAILED', 'Invalid share', {
          recipients: parsed.error.issues.map((issue) => issue.message),
        });
      }
      const own = rejectOwnAddress(parsed.data.recipients);
      if (own !== null) return own;

      const token = `MOCKTOKEN${mockUuid().replaceAll('-', '')}`;
      const shareId = mockUuid();
      const share: ShareDto = {
        id: shareId,
        nodeId: node.id,
        nodeName: node.name,
        nodeType: node.type,
        type: parsed.data.type,
        role: 'viewer',
        url: parsed.data.type === 'public_link' ? publicLinkUrl(token) : null,
        expiresAt: parsed.data.expiresAt,
        revokedAt: null,
        recipients: parsed.data.recipients.map((email) => makeRecipient(email)),
        createdAt: new Date().toISOString(),
      };
      state.shares.push(share);
      if (share.type === 'public_link') state.shareTokens.set(share.id, token);
      return HttpResponse.json(share, { status: 201 });
    },
  },
  {
    key: 'shares.listForRoom',
    endpoint: endpoints.shares.listForRoom,
    resolve: ({ request, params }) => {
      const forced = takeForcedError('shares.listForRoom', request.url);
      if (forced !== null) return apiError(forced, `Forced ${forced}`);
      const unauthenticated = requireSession();
      if (unauthenticated !== null) return unauthenticated;
      const room = state.rooms.find((candidate) => candidate.id === param(params, 'id'));
      if (room === undefined) return apiError('NOT_FOUND', 'No such data room');
      const ids = new Set(subtreeOf(room.rootNodeId).map((node) => node.id));
      return HttpResponse.json({ shares: state.shares.filter((share) => ids.has(share.nodeId)) });
    },
  },
  {
    key: 'shares.addRecipients',
    endpoint: endpoints.shares.addRecipients,
    resolve: async ({ request, params }) => {
      const forced = takeForcedError('shares.addRecipients', request.url);
      if (forced !== null) return apiError(forced, `Forced ${forced}`);
      const share = state.shares.find((candidate) => candidate.id === param(params, 'id'));
      if (share === undefined) return apiError('NOT_FOUND', 'No such share');
      const parsed = AddRecipientsBody.safeParse(await readBody(request));
      if (!parsed.success) return apiError('VALIDATION_FAILED', 'Invalid recipients');
      const own = rejectOwnAddress(parsed.data.emails);
      if (own !== null) return own;
      for (const email of parsed.data.emails) {
        // The API upserts: re-inviting a revoked address clears its `revoked_at` rather than
        // adding a second row. Skipping the address instead would make the mocked app show a
        // re-invitation doing nothing at all.
        const existing = share.recipients.find((recipient) => recipient.email === email);
        if (existing === undefined) {
          share.recipients.push(makeRecipient(email));
        } else {
          existing.revokedAt = null;
        }
      }
      return HttpResponse.json(share);
    },
  },
  {
    key: 'shares.revokeRecipient',
    endpoint: endpoints.shares.revokeRecipient,
    resolve: ({ request, params }) => {
      const forced = takeForcedError('shares.revokeRecipient', request.url);
      if (forced !== null) return apiError(forced, `Forced ${forced}`);
      const share = state.shares.find((candidate) => candidate.id === param(params, 'id'));
      const recipient = share?.recipients.find((r) => r.id === param(params, 'recipientId'));
      if (share === undefined || recipient === undefined) {
        return apiError('NOT_FOUND', 'No such recipient');
      }
      recipient.revokedAt = new Date().toISOString();
      return new HttpResponse(null, { status: 204 });
    },
  },
  {
    key: 'shares.revoke',
    endpoint: endpoints.shares.revoke,
    resolve: ({ request, params }) => {
      const forced = takeForcedError('shares.revoke', request.url);
      if (forced !== null) return apiError(forced, `Forced ${forced}`);
      const share = state.shares.find((candidate) => candidate.id === param(params, 'id'));
      if (share === undefined) return apiError('NOT_FOUND', 'No such share');
      share.revokedAt = new Date().toISOString();
      share.url = null;
      return new HttpResponse(null, { status: 204 });
    },
  },
  {
    key: 'shares.resolve',
    endpoint: endpoints.shares.resolve,
    resolve: ({ request, params }) => {
      const forced = takeForcedError('shares.resolve', request.url);
      if (forced !== null) return apiError(forced, `Forced ${forced}`);
      const token = param(params, 'token');
      const share = findShareByToken(token);
      if (share === undefined) return apiError('NOT_FOUND', "This link isn't valid");
      if (share.revokedAt !== null) return apiError('ACCESS_REVOKED', 'This link was revoked');
      if (share.expiresAt !== null && Date.parse(share.expiresAt) < Date.now()) {
        return apiError('SHARE_EXPIRED', 'This link expired');
      }
      const node = getNode(share.nodeId);
      if (node === undefined) return apiError('ITEM_GONE', 'The shared item was deleted');
      return HttpResponse.json({
        shareId: share.id,
        nodeId: share.nodeId,
        nodeName: node.name,
        nodeType: node.type,
        role: share.role,
        expiresAt: share.expiresAt,
        ownerName: fixtures.users.owner.name,
      });
    },
  },
];

/** Exported for the meta-test that asserts every contract endpoint is mocked. */
export const handlerKeys: string[] = specs.map((spec) => spec.key);

function toHandler(spec: HandlerSpec): RequestHandler {
  const url = path(spec.endpoint);
  const resolver = ({
    request,
    params,
  }: {
    request: Request;
    params: PathParams;
  }): Response | Promise<Response> => spec.resolve({ request, params });

  switch (spec.endpoint.method) {
    case 'GET':
      return http.get(url, resolver);
    case 'POST':
      return http.post(url, resolver);
    case 'PATCH':
      return http.patch(url, resolver);
    case 'DELETE':
      return http.delete(url, resolver);
    default:
      throw new Error(`Unsupported method for ${spec.key}`);
  }
}

/** Storage handlers: the mock stands in for Supabase so the upload PUT and the viewer both work. */
const storageHandlers: RequestHandler[] = [
  http.put(`${STORAGE_ORIGIN}/upload/:versionId`, () => new HttpResponse(null, { status: 200 })),
  http.get(
    `${STORAGE_ORIGIN}/objects/:id`,
    () =>
      new HttpResponse(MINIMAL_PDF, {
        status: 200,
        headers: { 'Content-Type': 'application/pdf' },
      }),
  ),
];

export const handlers: RequestHandler[] = [...specs.map(toHandler), ...storageHandlers];
