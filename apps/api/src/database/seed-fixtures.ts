import { createHash } from 'node:crypto';
import type { DataSource, EntityManager } from 'typeorm';
import { fixtures } from '@dataroom/contracts';
import { buildPath, rootPath } from '../nodes/path.util';

/**
 * The canonical fixture tree, built in the database.
 *
 *   root (Project Atlas)
 *   ├─ Legal/                 ← permissioned share to viewer@example.com
 *   │  └─ NDA.pdf
 *   ├─ Financials/            ← public link share
 *   │  └─ Q3/
 *   │     └─ balance-sheet.pdf
 *   └─ overview.pdf           ← outside both shares: the viewer must NOT be able to read this
 *
 * One fixture set, shared by the integration tests and by `pnpm db:seed`, and typed against the
 * same DTOs the frontend's MSW handlers serve. That is what makes "it worked against mocks" mean
 * something about the real API.
 */

export interface SeededFixtures {
  ownerId: string;
  viewerId: string;
  strangerId: string;
  roomId: string;
  rootNodeId: string;
  legalId: string;
  financialsId: string;
  q3Id: string;
  ndaId: string;
  balanceId: string;
  overviewId: string;
  publicShareId: string;
  permissionedShareId: string;
  publicToken: string;
}

const { IDS, nodes, users, dataRoom, PUBLIC_LINK_TOKEN } = fixtures;

/**
 * A version id derived from its node's, rather than a random one.
 *
 * The fixture node ids are constants; the version ids were not, so re-seeding produced new storage
 * keys (`room/node/version`) every time and orphaned whatever had been uploaded under the old ones.
 * Hashing keeps `pnpm db:seed` genuinely repeatable — same tree, same keys — and the fixtures live
 * in `@dataroom/contracts`, which is frozen, so the ids cannot simply be added there.
 */
function versionIdFor(nodeId: string): string {
  const hash = createHash('sha256').update(`file-version:${nodeId}`).digest('hex');
  return [
    hash.slice(0, 8),
    hash.slice(8, 12),
    `4${hash.slice(13, 16)}`,
    `8${hash.slice(17, 20)}`,
    hash.slice(20, 32),
  ].join('-');
}

async function insertUser(
  manager: EntityManager,
  id: string,
  email: string,
  name: string,
): Promise<void> {
  await manager.query(
    `INSERT INTO users (id, google_sub, email, name) VALUES ($1, $2, $3, $4)
     ON CONFLICT (id) DO NOTHING`,
    [id, `google-sub-${id}`, email, name],
  );
}

async function insertFolder(
  manager: EntityManager,
  params: {
    id: string;
    roomId: string;
    parentId: string | null;
    name: string;
    path: string;
    depth: number;
    ownerId: string;
    subtreeSizeBytes: number;
    subtreeFileCount: number;
  },
): Promise<void> {
  await manager.query(
    `INSERT INTO nodes
       (id, data_room_id, parent_id, type, name, path, depth, created_by,
        subtree_size_bytes, subtree_file_count)
     VALUES ($1, $2, $3, 'folder', $4, $5, $6, $7, $8, $9)`,
    [
      params.id,
      params.roomId,
      params.parentId,
      params.name,
      params.path,
      params.depth,
      params.ownerId,
      params.subtreeSizeBytes,
      params.subtreeFileCount,
    ],
  );
}

/** Files are inserted the way an upload creates them: node, then version, then promotion. */
async function insertFile(
  manager: EntityManager,
  params: {
    id: string;
    roomId: string;
    parentId: string;
    name: string;
    path: string;
    depth: number;
    ownerId: string;
    sizeBytes: number;
    mimeType: string;
  },
): Promise<void> {
  await manager.query(
    `INSERT INTO nodes (id, data_room_id, parent_id, type, name, path, depth, created_by)
     VALUES ($1, $2, $3, 'file', $4, $5, $6, $7)`,
    [
      params.id,
      params.roomId,
      params.parentId,
      params.name,
      params.path,
      params.depth,
      params.ownerId,
    ],
  );

  const versionId = versionIdFor(params.id);
  await manager.query(
    `INSERT INTO file_versions
       (id, node_id, version, storage_key, size_bytes, mime_type, status, uploaded_by)
     VALUES ($1, $2, 1, $3, $4, $5, 'ready', $6)`,
    [
      versionId,
      params.id,
      `${params.roomId}/${params.id}/${versionId}`,
      params.sizeBytes,
      params.mimeType,
      params.ownerId,
    ],
  );

  await manager.query(
    `UPDATE nodes SET current_version_id = $2, size_bytes = $3, mime_type = $4 WHERE id = $1`,
    [params.id, versionId, params.sizeBytes, params.mimeType],
  );
}

export async function seedFixtures(dataSource: DataSource): Promise<SeededFixtures> {
  return dataSource.transaction(async (manager) => {
    await insertUser(manager, IDS.owner, users.owner.email, users.owner.name);
    await insertUser(manager, IDS.viewer, users.viewer.email, users.viewer.name);
    await insertUser(manager, IDS.stranger, users.stranger.email, users.stranger.name);

    // Room and root node: the three-statement transaction the circular FK requires.
    await manager.query(`INSERT INTO data_rooms (id, owner_id, name) VALUES ($1, $2, $3)`, [
      IDS.room,
      IDS.owner,
      dataRoom.name,
    ]);

    const rootNodePath = rootPath(IDS.rootNode);
    await insertFolder(manager, {
      id: IDS.rootNode,
      roomId: IDS.room,
      parentId: null,
      name: nodes.root.name,
      path: rootNodePath,
      depth: 0,
      ownerId: IDS.owner,
      subtreeSizeBytes: nodes.root.subtreeSizeBytes ?? 0,
      subtreeFileCount: nodes.root.subtreeFileCount ?? 0,
    });
    await manager.query(`UPDATE data_rooms SET root_node_id = $2 WHERE id = $1`, [
      IDS.room,
      IDS.rootNode,
    ]);

    const legalPath = buildPath(rootNodePath, IDS.folderLegal);
    const financialsPath = buildPath(rootNodePath, IDS.folderFin);
    const q3Path = buildPath(financialsPath, IDS.folderQ3);

    await insertFolder(manager, {
      id: IDS.folderLegal,
      roomId: IDS.room,
      parentId: IDS.rootNode,
      name: nodes.legal.name,
      path: legalPath,
      depth: 1,
      ownerId: IDS.owner,
      subtreeSizeBytes: nodes.legal.subtreeSizeBytes ?? 0,
      subtreeFileCount: nodes.legal.subtreeFileCount ?? 0,
    });
    await insertFolder(manager, {
      id: IDS.folderFin,
      roomId: IDS.room,
      parentId: IDS.rootNode,
      name: nodes.financials.name,
      path: financialsPath,
      depth: 1,
      ownerId: IDS.owner,
      subtreeSizeBytes: nodes.financials.subtreeSizeBytes ?? 0,
      subtreeFileCount: nodes.financials.subtreeFileCount ?? 0,
    });
    await insertFolder(manager, {
      id: IDS.folderQ3,
      roomId: IDS.room,
      parentId: IDS.folderFin,
      name: nodes.q3.name,
      path: q3Path,
      depth: 2,
      ownerId: IDS.owner,
      subtreeSizeBytes: nodes.q3.subtreeSizeBytes ?? 0,
      subtreeFileCount: nodes.q3.subtreeFileCount ?? 0,
    });

    await insertFile(manager, {
      id: IDS.fileNda,
      roomId: IDS.room,
      parentId: IDS.folderLegal,
      name: nodes.nda.name,
      path: buildPath(legalPath, IDS.fileNda),
      depth: 2,
      ownerId: IDS.owner,
      sizeBytes: nodes.nda.sizeBytes ?? 0,
      mimeType: nodes.nda.mimeType ?? 'application/pdf',
    });
    await insertFile(manager, {
      id: IDS.fileBalance,
      roomId: IDS.room,
      parentId: IDS.folderQ3,
      name: nodes.balance.name,
      path: buildPath(q3Path, IDS.fileBalance),
      depth: 3,
      ownerId: IDS.owner,
      sizeBytes: nodes.balance.sizeBytes ?? 0,
      mimeType: nodes.balance.mimeType ?? 'application/pdf',
    });
    await insertFile(manager, {
      id: IDS.fileOrphan,
      roomId: IDS.room,
      parentId: IDS.rootNode,
      name: nodes.overview.name,
      path: buildPath(rootNodePath, IDS.fileOrphan),
      depth: 1,
      ownerId: IDS.owner,
      sizeBytes: nodes.overview.sizeBytes ?? 0,
      mimeType: nodes.overview.mimeType ?? 'application/pdf',
    });

    // A public link on Financials, and a permissioned share on Legal to the viewer.
    await manager.query(
      `INSERT INTO shares (id, node_id, data_room_id, type, role, token, created_by)
       VALUES ($1, $2, $3, 'public_link', 'viewer', $4, $5)`,
      [IDS.shareLink, IDS.folderFin, IDS.room, PUBLIC_LINK_TOKEN, IDS.owner],
    );
    await manager.query(
      `INSERT INTO shares (id, node_id, data_room_id, type, role, created_by)
       VALUES ($1, $2, $3, 'permissioned', 'viewer', $4)`,
      [IDS.sharePerm, IDS.folderLegal, IDS.room, IDS.owner],
    );
    await manager.query(
      `INSERT INTO share_recipients (id, share_id, email, user_id, accepted_at)
       VALUES ($1, $2, $3, $4, now())`,
      [IDS.recipient, IDS.sharePerm, users.viewer.email, IDS.viewer],
    );

    return {
      ownerId: IDS.owner,
      viewerId: IDS.viewer,
      strangerId: IDS.stranger,
      roomId: IDS.room,
      rootNodeId: IDS.rootNode,
      legalId: IDS.folderLegal,
      financialsId: IDS.folderFin,
      q3Id: IDS.folderQ3,
      ndaId: IDS.fileNda,
      balanceId: IDS.fileBalance,
      overviewId: IDS.fileOrphan,
      publicShareId: IDS.shareLink,
      permissionedShareId: IDS.sharePerm,
      publicToken: PUBLIC_LINK_TOKEN,
    };
  });
}
