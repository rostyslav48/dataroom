import type { DataRoomDto } from './data-rooms.contract';
import type { NodeDto } from './nodes.contract';
import type { ShareDto } from './shares.contract';
import type { UserDto } from './auth.contract';

/**
 * Canonical sample data, shared by both tracks.
 *
 *   - Frontend: MSW handlers serve these, so component tests run with no backend.
 *   - Backend:  integration tests seed these, so assertions reference the same ids.
 *
 * Having ONE fixture set is what makes "it worked against mocks" mean something. If the two
 * tracks invented their own sample data, mock-passing frontend tests would prove nothing about
 * the real API. Every fixture is typed against its DTO, so a contract change breaks the
 * fixtures at compile time and both tracks find out immediately.
 *
 * Ids are fixed and human-readable-ish so failures are legible in test output.
 */

export const IDS = {
  owner:        '00000000-0000-4000-8000-000000000001',
  viewer:       '00000000-0000-4000-8000-000000000002',
  stranger:     '00000000-0000-4000-8000-000000000003',
  room:         '00000000-0000-4000-8000-000000000010',
  rootNode:     '00000000-0000-4000-8000-000000000100',
  folderLegal:  '00000000-0000-4000-8000-000000000101',
  folderFin:    '00000000-0000-4000-8000-000000000102',
  folderQ3:     '00000000-0000-4000-8000-000000000103', // nested inside folderFin
  fileNda:      '00000000-0000-4000-8000-000000000201', // inside folderLegal
  fileBalance:  '00000000-0000-4000-8000-000000000202', // inside folderQ3
  fileOrphan:   '00000000-0000-4000-8000-000000000203', // directly under root
  shareLink:    '00000000-0000-4000-8000-000000000301', // public link on folderFin
  sharePerm:    '00000000-0000-4000-8000-000000000302', // permissioned on folderLegal
  recipient:    '00000000-0000-4000-8000-000000000401',
} as const;

/**
 * The fixture tree. Chosen to exercise every interesting relationship in one dataset:
 *
 *   root
 *   ├─ Legal/            ← permissioned share to viewer@example.com
 *   │  └─ NDA.pdf
 *   ├─ Financials/       ← public link share
 *   │  └─ Q3/
 *   │     └─ balance-sheet.pdf
 *   └─ overview.pdf
 *
 * This gives: a share root, a descendant of a share root, a sibling *outside* both shares
 * (`overview.pdf`, which must 403 for the viewer), and two nesting levels for breadcrumb
 * truncation tests.
 */

const T = '2026-01-15T10:00:00.000Z';

export const users: Record<'owner' | 'viewer' | 'stranger', UserDto> = {
  owner:    { id: IDS.owner,    email: 'owner@example.com',    name: 'Acme Owner',   avatarUrl: null },
  viewer:   { id: IDS.viewer,   email: 'viewer@example.com',   name: 'Due Diligence', avatarUrl: null },
  stranger: { id: IDS.stranger, email: 'stranger@example.com', name: 'Nobody',        avatarUrl: null },
};

export const dataRoom: DataRoomDto = {
  id: IDS.room,
  name: 'Project Atlas',
  rootNodeId: IDS.rootNode,
  ownerId: IDS.owner,
  ownerName: users.owner.name,
  access: 'owner',
  fileCount: 3,
  sizeBytes: 3_145_728,
  createdAt: T,
  updatedAt: T,
};

const folder = (id: string, parentId: string | null, name: string, files: number, size: number): NodeDto => ({
  id,
  dataRoomId: IDS.room,
  parentId,
  type: 'folder',
  name,
  sizeBytes: null,
  mimeType: null,
  subtreeFileCount: files,
  subtreeSizeBytes: size,
  createdAt: T,
  updatedAt: T,
});

const file = (id: string, parentId: string, name: string, size: number): NodeDto => ({
  id,
  dataRoomId: IDS.room,
  parentId,
  type: 'file',
  name,
  sizeBytes: size,
  mimeType: 'application/pdf',
  subtreeFileCount: null,
  subtreeSizeBytes: null,
  createdAt: T,
  updatedAt: T,
});

export const nodes = {
  root:       folder(IDS.rootNode,    null,             'Project Atlas', 3, 3_145_728),
  legal:      folder(IDS.folderLegal, IDS.rootNode,     'Legal',         1, 1_048_576),
  financials: folder(IDS.folderFin,   IDS.rootNode,     'Financials',    1, 1_572_864),
  q3:         folder(IDS.folderQ3,    IDS.folderFin,    'Q3',            1, 1_572_864),
  nda:        file(IDS.fileNda,       IDS.folderLegal,  'NDA.pdf',           1_048_576),
  balance:    file(IDS.fileBalance,   IDS.folderQ3,     'balance-sheet.pdf', 1_572_864),
  overview:   file(IDS.fileOrphan,    IDS.rootNode,     'overview.pdf',        524_288),
} satisfies Record<string, NodeDto>;

export const shares = {
  publicLink: {
    id: IDS.shareLink,
    nodeId: IDS.folderFin,
    nodeName: 'Financials',
    nodeType: 'folder',
    type: 'public_link',
    role: 'viewer',
    url: 'https://dataroom.example.com/s/TESTTOKENpubliclink000000000000000000000000',
    expiresAt: null,
    revokedAt: null,
    recipients: [],
    createdAt: T,
  },
  permissioned: {
    id: IDS.sharePerm,
    nodeId: IDS.folderLegal,
    nodeName: 'Legal',
    nodeType: 'folder',
    type: 'permissioned',
    role: 'viewer',
    url: null,
    expiresAt: null,
    revokedAt: null,
    recipients: [
      {
        id: IDS.recipient,
        email: 'viewer@example.com',
        userId: IDS.viewer,
        invitedAt: T,
        acceptedAt: T,
        revokedAt: null,
      },
    ],
    createdAt: T,
  },
} satisfies Record<string, ShareDto>;

/** Token embedded in `shares.publicLink.url`. Integration and E2E tests seed exactly this value. */
export const PUBLIC_LINK_TOKEN = 'TESTTOKENpubliclink000000000000000000000000';
