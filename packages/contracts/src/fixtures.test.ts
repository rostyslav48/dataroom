import { describe, expect, it } from 'vitest';
import { DataRoomDto } from './data-rooms.contract';
import { NodeDto } from './nodes.contract';
import { ShareDto } from './shares.contract';
import { UserDto } from './auth.contract';
import { ERROR_STATUS, ErrorCode } from './errors.contract';
import { endpoints } from './index';
import * as fixtures from './fixtures';

/**
 * W0-5: the fixtures are typed against their DTOs, so a contract change breaks them at compile
 * time. This suite adds the other half — that they also satisfy the *runtime* schemas, including
 * `.strict()`, so a fixture carrying a field the schema doesn't declare fails here rather than in
 * a frontend mock that silently disagrees with the real API.
 */
describe('fixtures satisfy their contracts', () => {
  it('every user parses as UserDto', () => {
    for (const user of Object.values(fixtures.users)) {
      expect(() => UserDto.parse(user)).not.toThrow();
    }
  });

  it('the data room parses as DataRoomDto', () => {
    expect(DataRoomDto.parse(fixtures.dataRoom)).toMatchObject({ id: fixtures.IDS.room });
  });

  it('every node parses as NodeDto', () => {
    for (const [name, node] of Object.entries(fixtures.nodes)) {
      expect(() => NodeDto.parse(node), name).not.toThrow();
    }
  });

  it('every share parses as ShareDto', () => {
    for (const [name, share] of Object.entries(fixtures.shares)) {
      expect(() => ShareDto.parse(share), name).not.toThrow();
    }
  });

  it('rejects a fixture-shaped object carrying an undeclared field', () => {
    expect(() => NodeDto.parse({ ...fixtures.nodes.root, extra: true })).toThrow();
  });
});

describe('fixture tree is internally consistent', () => {
  it('every non-root node points at a parent that exists in the fixture set', () => {
    const ids = new Set(Object.values(fixtures.nodes).map((n) => n.id));
    for (const node of Object.values(fixtures.nodes)) {
      if (node.parentId === null) continue;
      expect(ids.has(node.parentId), `${node.name} → ${node.parentId}`).toBe(true);
    }
  });

  it('the room root is the only parentless node', () => {
    const roots = Object.values(fixtures.nodes).filter((n) => n.parentId === null);
    expect(roots.map((n) => n.id)).toEqual([fixtures.dataRoom.rootNodeId]);
  });

  it('folders carry rollups and files carry own size, never both', () => {
    for (const node of Object.values(fixtures.nodes)) {
      if (node.type === 'folder') {
        expect(node.sizeBytes).toBeNull();
        expect(node.subtreeFileCount).not.toBeNull();
      } else {
        expect(node.subtreeSizeBytes).toBeNull();
        expect(node.sizeBytes).not.toBeNull();
      }
    }
  });

  it("the room's rollups equal the sum over the fixture files", () => {
    const files = Object.values(fixtures.nodes).filter((n) => n.type === 'file');
    expect(fixtures.dataRoom.fileCount).toBe(files.length);
    expect(fixtures.dataRoom.sizeBytes).toBe(files.reduce((sum, f) => sum + (f.sizeBytes ?? 0), 0));
  });

  it('the public link fixture embeds PUBLIC_LINK_TOKEN', () => {
    expect(fixtures.shares.publicLink.url).toContain(fixtures.PUBLIC_LINK_TOKEN);
  });
});

describe('contract invariants', () => {
  it('every error code has a status mapping', () => {
    for (const code of ErrorCode.options) {
      expect(ERROR_STATUS[code], code).toBeTypeOf('number');
    }
  });

  it('every endpoint path is rooted and uses :param placeholders only', () => {
    for (const group of Object.values(endpoints)) {
      for (const descriptor of Object.values(group)) {
        expect(descriptor.path.startsWith('/'), descriptor.path).toBe(true);
        expect(descriptor.path).not.toMatch(/[{}*]/);
      }
    }
  });

  it('endpoint paths are unique per method', () => {
    const seen = new Set<string>();
    for (const group of Object.values(endpoints)) {
      for (const descriptor of Object.values(group)) {
        const key = `${descriptor.method} ${descriptor.path}`;
        expect(seen.has(key), key).toBe(false);
        seen.add(key);
      }
    }
  });
});
