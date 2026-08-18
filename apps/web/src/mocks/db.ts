import {
  fixtures,
  type DataRoomDto,
  type NodeDto,
  type ShareDto,
  type NodeSortField,
  type ShareRecipientDto,
} from '@dataroom/contracts';

/**
 * The mock's in-memory tree.
 *
 * It is mutable on purpose: a mock that only ever returns static JSON cannot exercise rename,
 * move, delete or upload, which is where most of this UI's behaviour lives. Every row starts as a
 * clone of the shared fixtures, so what the component tests see is what the backend seeds.
 */

export interface UploadRecord {
  versionId: string;
  nodeId: string;
  parentId: string;
  finalName: string;
  sizeBytes: number;
  mimeType: string;
  completed: boolean;
  aborted: boolean;
}

export interface MockState {
  /** null means "no session": `/me` and `/auth/refresh` then answer 401. */
  currentUserId: string | null;
  rooms: DataRoomDto[];
  nodes: Map<string, NodeDto>;
  /** Ids that existed and were deleted, so the mock can answer 410 ITEM_GONE rather than 404. */
  deletedIds: Set<string>;
  shares: ShareDto[];
  /** share id → public link token, kept even after revocation so a revoked link can be told
   *  apart from a link that never existed. */
  shareTokens: Map<string, string>;
  uploads: Map<string, UploadRecord>;
  /** Forces `access: 'viewer'` for an authenticated caller, i.e. a permissioned recipient. */
  forcedAccess: 'owner' | 'viewer' | null;
  forcedShareRootId: string | null;
}

let seq = 0;
export function mockUuid(): string {
  seq += 1;
  return `00000000-0000-4000-8000-${String(900_000_000_000 + seq).slice(-12)}`;
}

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

function initialShareTokens(): Map<string, string> {
  return new Map([[fixtures.IDS.shareLink, fixtures.PUBLIC_LINK_TOKEN]]);
}

function initialNodes(): Map<string, NodeDto> {
  const map = new Map<string, NodeDto>();
  for (const node of Object.values(fixtures.nodes)) map.set(node.id, clone(node));
  return map;
}

export const state: MockState = {
  currentUserId: fixtures.IDS.owner,
  rooms: [clone(fixtures.dataRoom)],
  nodes: initialNodes(),
  deletedIds: new Set(),
  shares: Object.values(fixtures.shares).map((share) => clone(share)),
  shareTokens: initialShareTokens(),
  uploads: new Map(),
  forcedAccess: null,
  forcedShareRootId: null,
};

export function resetDb(): void {
  seq = 0;
  state.currentUserId = fixtures.IDS.owner;
  state.rooms = [clone(fixtures.dataRoom)];
  state.nodes = initialNodes();
  state.deletedIds = new Set();
  state.shares = Object.values(fixtures.shares).map((share) => clone(share));
  state.shareTokens = initialShareTokens();
  state.uploads = new Map();
  state.forcedAccess = null;
  state.forcedShareRootId = null;
}

// ── tree helpers ─────────────────────────────────────────────────────────────────────────────

export function getNode(id: string): NodeDto | undefined {
  return state.nodes.get(id);
}

export function childrenOf(parentId: string): NodeDto[] {
  return [...state.nodes.values()].filter((node) => node.parentId === parentId);
}

export function ancestorsOf(id: string): NodeDto[] {
  const chain: NodeDto[] = [];
  let current = state.nodes.get(id);
  while (current !== undefined) {
    chain.unshift(current);
    current = current.parentId === null ? undefined : state.nodes.get(current.parentId);
  }
  return chain;
}

export function isDescendantOf(candidateId: string, ancestorId: string): boolean {
  if (candidateId === ancestorId) return true;
  return ancestorsOf(candidateId).some((node) => node.id === ancestorId);
}

export function subtreeOf(id: string): NodeDto[] {
  const root = state.nodes.get(id);
  if (root === undefined) return [];
  const out: NodeDto[] = [root];
  const walk = (parentId: string): void => {
    for (const child of childrenOf(parentId)) {
      out.push(child);
      if (child.type === 'folder') walk(child.id);
    }
  };
  walk(id);
  return out;
}

export function nameTaken(parentId: string, name: string, exceptId?: string): boolean {
  return childrenOf(parentId).some(
    (node) => node.id !== exceptId && node.name.toLowerCase() === name.toLowerCase(),
  );
}

/** Mirrors the backend's auto-suffix rule for uploads: `report.pdf` → `report (2).pdf`. */
export function nextAvailableName(parentId: string, name: string): string {
  if (!nameTaken(parentId, name)) return name;
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  for (let attempt = 2; attempt < 102; attempt += 1) {
    const candidate = `${stem} (${String(attempt)})${ext}`;
    if (!nameTaken(parentId, candidate)) return candidate;
  }
  throw new Error('No available name after 100 attempts');
}

/** Recomputes the rollups the backend maintains incrementally. Cheap at fixture scale. */
export function recomputeRollups(): void {
  for (const node of state.nodes.values()) {
    if (node.type !== 'folder') continue;
    const descendants = subtreeOf(node.id).filter((n) => n.id !== node.id && n.type === 'file');
    node.subtreeFileCount = descendants.length;
    node.subtreeSizeBytes = descendants.reduce((sum, n) => sum + (n.sizeBytes ?? 0), 0);
  }
  for (const room of state.rooms) {
    const root = state.nodes.get(room.rootNodeId);
    room.fileCount = root?.subtreeFileCount ?? 0;
    room.sizeBytes = root?.subtreeSizeBytes ?? 0;
  }
}

export function statsFor(id: string): { sizeBytes: number; fileCount: number; folderCount: number } {
  const descendants = subtreeOf(id).filter((node) => node.id !== id);
  return {
    sizeBytes: descendants.reduce((sum, node) => sum + (node.sizeBytes ?? 0), 0),
    fileCount: descendants.filter((node) => node.type === 'file').length,
    folderCount: descendants.filter((node) => node.type === 'folder').length,
  };
}

export function insertNode(node: NodeDto): NodeDto {
  state.nodes.set(node.id, node);
  recomputeRollups();
  return node;
}

export function removeSubtree(id: string): void {
  for (const node of subtreeOf(id)) {
    state.nodes.delete(node.id);
    state.deletedIds.add(node.id);
    // Deleting a subtree auto-revokes every share rooted inside it.
    for (const share of state.shares) {
      if (share.nodeId === node.id && share.revokedAt === null) {
        share.revokedAt = new Date().toISOString();
        share.url = null;
      }
    }
  }
  recomputeRollups();
}

// ── ordering and keyset pagination ───────────────────────────────────────────────────────────

export interface PageParams {
  sort: NodeSortField;
  dir: 'asc' | 'desc';
  cursor?: string | undefined;
  limit: number;
}

/** Folders always precede files, whatever the sort — the backend does not make this configurable. */
export function sortNodes(nodes: NodeDto[], sort: NodeSortField, dir: 'asc' | 'desc'): NodeDto[] {
  const factor = dir === 'asc' ? 1 : -1;
  return [...nodes].sort((a, b) => {
    if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
    if (sort === 'size') {
      const sizeA = a.type === 'folder' ? (a.subtreeSizeBytes ?? 0) : (a.sizeBytes ?? 0);
      const sizeB = b.type === 'folder' ? (b.subtreeSizeBytes ?? 0) : (b.sizeBytes ?? 0);
      if (sizeA !== sizeB) return (sizeA - sizeB) * factor;
    } else if (sort === 'updatedAt' && a.updatedAt !== b.updatedAt) {
      return a.updatedAt.localeCompare(b.updatedAt) * factor;
    }
    return a.name.toLowerCase().localeCompare(b.name.toLowerCase()) * factor;
  });
}

export function encodeCursor(node: NodeDto): string {
  return btoa(encodeURIComponent(JSON.stringify({ t: node.type, n: node.name.toLowerCase(), i: node.id })));
}

export function decodeCursorId(cursor: string): string | null {
  try {
    const decoded: unknown = JSON.parse(decodeURIComponent(atob(cursor)));
    if (typeof decoded === 'object' && decoded !== null && 'i' in decoded) {
      const id = (decoded as { i: unknown }).i;
      return typeof id === 'string' ? id : null;
    }
    return null;
  } catch {
    return null;
  }
}

export function paginate(nodes: NodeDto[], params: PageParams): {
  items: NodeDto[];
  nextCursor: string | null;
} {
  const ordered = sortNodes(nodes, params.sort, params.dir);
  let start = 0;
  if (params.cursor !== undefined) {
    const afterId = decodeCursorId(params.cursor);
    const index = ordered.findIndex((node) => node.id === afterId);
    start = index === -1 ? 0 : index + 1;
  }
  const items = ordered.slice(start, start + params.limit);
  const last = items[items.length - 1];
  const consumed = start + items.length;
  const nextCursor = consumed < ordered.length && last !== undefined ? encodeCursor(last) : null;
  return { items, nextCursor };
}

// ── shares ───────────────────────────────────────────────────────────────────────────────────

/** Any share minted with this token, revoked or not. */
export function findShareByToken(token: string): ShareDto | undefined {
  const shareId = [...state.shareTokens.entries()].find(([, value]) => value === token)?.[0];
  return shareId === undefined
    ? undefined
    : state.shares.find((share) => share.id === shareId);
}

export function liveShareForToken(token: string): ShareDto | undefined {
  const share = findShareByToken(token);
  if (share === undefined || share.revokedAt !== null) return undefined;
  if (share.expiresAt !== null && Date.parse(share.expiresAt) < Date.now()) return undefined;
  return share;
}

export function shareTokenOf(share: ShareDto): string | null {
  return state.shareTokens.get(share.id) ?? null;
}

/** Live permissioned grants this user holds: share live, and their own recipient row not revoked. */
export function permissionedSharesFor(userId: string): ShareDto[] {
  const now = Date.now();
  return state.shares.filter(
    (share) =>
      share.type === 'permissioned' &&
      share.revokedAt === null &&
      (share.expiresAt === null || Date.parse(share.expiresAt) >= now) &&
      share.recipients.some(
        (recipient) => recipient.userId === userId && recipient.revokedAt === null,
      ),
  );
}

/** Distance from the room root, which is what makes "the shallowest share" well defined. */
export function depthOf(id: string): number {
  return ancestorsOf(id).length;
}

// ── the share-root projection ────────────────────────────────────────────────────────────────

/**
 * A room as its recipient sees it: **projected onto their share root**.
 *
 * The real API answers this way because a recipient cannot read the room root. Its name, its id
 * and its rollups all belong to the grant, not to the room — sending the room's own values would
 * both produce a sidebar link that 403s on click and disclose the size of content outside the
 * grant. `id`, `ownerId`, `ownerName` and the timestamps stay the room's: those are what the
 * recipient is entitled to know about *which* room this is.
 *
 * Mocking this is not a nicety. Both shapes satisfy `DataRoomDto.strict()`, so a contract test
 * cannot tell them apart and only a mock that projects will show the UI what it will really get.
 */
export function projectRoomOntoShareRoot(room: DataRoomDto, shareRoot: NodeDto): DataRoomDto {
  return {
    ...room,
    name: shareRoot.name,
    rootNodeId: shareRoot.id,
    access: 'viewer',
    fileCount: shareRoot.type === 'folder' ? (shareRoot.subtreeFileCount ?? 0) : 1,
    sizeBytes:
      shareRoot.type === 'folder' ? (shareRoot.subtreeSizeBytes ?? 0) : (shareRoot.sizeBytes ?? 0),
  };
}

/** The node this user enters `roomId` by: the shallowest of the grants they hold inside it. */
export function shallowestShareRootIn(userId: string, roomId: string): NodeDto | undefined {
  let shallowest: NodeDto | undefined;
  for (const share of permissionedSharesFor(userId)) {
    const node = getNode(share.nodeId);
    if (node === undefined || node.dataRoomId !== roomId) continue;
    if (shallowest === undefined || depthOf(node.id) < depthOf(shallowest.id)) shallowest = node;
  }
  return shallowest;
}

/**
 * `sharedWithMe`, projected. A room appears **once** however many grants the caller holds in it,
 * entered at the shallowest — several entries for one room would read as several rooms.
 */
export function sharedRoomsFor(userId: string | null): DataRoomDto[] {
  if (userId === null) return [];
  return state.rooms.flatMap((room) => {
    if (room.ownerId === userId) return [];
    const shareRoot = shallowestShareRootIn(userId, room.id);
    return shareRoot === undefined ? [] : [projectRoomOntoShareRoot(room, shareRoot)];
  });
}

/** The share root a permissioned recipient reads `nodeId` through, or null if no grant covers it. */
export function coveringShareRootFor(userId: string, nodeId: string): string | null {
  let covering: string | null = null;
  for (const share of permissionedSharesFor(userId)) {
    if (!isDescendantOf(nodeId, share.nodeId)) continue;
    if (covering === null || depthOf(share.nodeId) < depthOf(covering)) covering = share.nodeId;
  }
  return covering;
}

export function makeRecipient(email: string): ShareRecipientDto {
  const known = Object.values(fixtures.users).find((user) => user.email === email);
  return {
    id: mockUuid(),
    email,
    userId: known?.id ?? null,
    invitedAt: new Date().toISOString(),
    acceptedAt: known === undefined ? null : new Date().toISOString(),
    revokedAt: null,
  };
}

/** The public link a freshly created share hands back, in the same shape as the fixture's. */
export function publicLinkUrl(token: string): string {
  return `https://dataroom.example.com/s/${token}`;
}
