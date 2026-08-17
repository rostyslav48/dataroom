import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  InvalidPathError,
  ancestorIds,
  buildPath,
  depthOf,
  isDescendantOf,
  likePrefix,
  parentPath,
  pathSegments,
  rewritePrefix,
  rootPath,
  selfAndAncestorIds,
  selfId,
} from './path.util';

describe('buildPath / rootPath', () => {
  it('appends a segment with a trailing slash', () => {
    expect(buildPath('/a/b/', 'c')).toBe('/a/b/c/');
  });

  it('builds a root path from an id alone', () => {
    expect(rootPath('r')).toBe('/r/');
    expect(depthOf(rootPath('r'))).toBe(0);
  });

  it.each(['', 'no-slashes', 'a/b/', '/a/b', 'a', '//'])('rejects %s as a parent path', (bad) => {
    expect(() => buildPath(bad, 'c')).toThrow(InvalidPathError);
  });

  it('rejects an id containing a slash, which would forge an ancestor', () => {
    expect(() => buildPath('/a/', 'b/c')).toThrow(InvalidPathError);
    expect(() => rootPath('b/c')).toThrow(InvalidPathError);
  });
});

describe('segments, ancestors and depth', () => {
  it.each([
    ['/a/', ['a']],
    ['/a/b/', ['a', 'b']],
    ['/a/b/c/', ['a', 'b', 'c']],
  ])('splits %s', (path, expected) => {
    expect(pathSegments(path)).toEqual(expected);
    expect(selfAndAncestorIds(path)).toEqual(expected);
  });

  it.each([
    ['/a/', []],
    ['/a/b/', ['a']],
    ['/a/b/c/', ['a', 'b']],
  ])('lists ancestors of %s excluding self', (path, expected) => {
    expect(ancestorIds(path)).toEqual(expected);
  });

  it.each([
    ['/a/', 'a'],
    ['/a/b/c/', 'c'],
  ])('reads self out of %s', (path, expected) => {
    expect(selfId(path)).toBe(expected);
  });

  it.each([
    ['/a/', 0],
    ['/a/b/', 1],
    ['/a/b/c/d/e/', 4],
  ])('computes depth of %s', (path, expected) => {
    expect(depthOf(path)).toBe(expected);
  });

  it('returns null for the parent of a root', () => {
    expect(parentPath('/a/')).toBeNull();
    expect(parentPath('/a/b/')).toBe('/a/');
  });
});

describe('isDescendantOf', () => {
  it('is strict — a node is not its own descendant', () => {
    expect(isDescendantOf('/a/b/', '/a/b/')).toBe(false);
  });

  it('recognises direct and deep descendants', () => {
    expect(isDescendantOf('/a/b/', '/a/')).toBe(true);
    expect(isDescendantOf('/a/b/c/d/', '/a/')).toBe(true);
  });

  it('is not fooled by an id that merely starts with another id', () => {
    // The trailing slash is what makes the prefix test a *segment* test.
    expect(isDescendantOf('/abc/', '/ab/')).toBe(false);
    expect(isDescendantOf('/a/bcd/', '/a/bc/')).toBe(false);
  });

  it('rejects unrelated subtrees', () => {
    expect(isDescendantOf('/a/b/', '/c/')).toBe(false);
    expect(isDescendantOf('/a/', '/a/b/')).toBe(false);
  });
});

describe('rewritePrefix', () => {
  it('swaps the moving subtree prefix and preserves the suffix', () => {
    expect(rewritePrefix('/r/a/b/c/', '/r/a/', '/r/x/y/')).toBe('/r/x/y/b/c/');
  });

  it('handles the moving node itself, whose suffix is empty', () => {
    expect(rewritePrefix('/r/a/', '/r/a/', '/r/x/a/')).toBe('/r/x/a/');
  });

  it('refuses a path outside the subtree, rather than producing a plausible wrong answer', () => {
    expect(() => rewritePrefix('/r/z/', '/r/a/', '/r/x/')).toThrow(InvalidPathError);
  });
});

describe('likePrefix', () => {
  it('appends the wildcard', () => {
    expect(likePrefix('/a/b/')).toBe('/a/b/%');
  });

  it('escapes LIKE metacharacters so a path can never inject a wildcard', () => {
    expect(likePrefix('/a/1%_2/')).toBe('/a/1\\%\\_2/%');
  });
});

/**
 * Property-style: build random trees out of real UUIDs and assert the four invariants the whole
 * data model rests on. These are the same assertions the integration tests make after every
 * mutation — here they are checked against the arithmetic alone.
 */
describe('path invariants over random trees', () => {
  interface Node {
    id: string;
    path: string;
    depth: number;
    parent: Node | null;
  }

  const buildRandomTree = (size: number): Node[] => {
    const root: Node = { id: randomUUID(), path: '', depth: 0, parent: null };
    root.path = rootPath(root.id);
    const nodes: Node[] = [root];

    for (let i = 1; i < size; i += 1) {
      const parent = nodes[Math.floor(Math.random() * nodes.length)] as Node;
      const id = randomUUID();
      nodes.push({ id, path: buildPath(parent.path, id), depth: parent.depth + 1, parent });
    }
    return nodes;
  };

  it('holds for 20 random trees of 50 nodes each', () => {
    for (let trial = 0; trial < 20; trial += 1) {
      const nodes = buildRandomTree(50);

      for (const node of nodes) {
        expect(node.path.startsWith('/')).toBe(true);
        expect(node.path.endsWith(`/${node.id}/`)).toBe(true);
        expect(depthOf(node.path)).toBe(node.depth);
        expect(selfId(node.path)).toBe(node.id);

        if (node.parent) {
          expect(node.path.startsWith(node.parent.path)).toBe(true);
          expect(node.path).not.toBe(node.parent.path);
          expect(isDescendantOf(node.path, node.parent.path)).toBe(true);
          expect(ancestorIds(node.path)).toEqual([
            ...ancestorIds(node.parent.path),
            node.parent.id,
          ]);
          expect(parentPath(node.path)).toBe(node.parent.path);
        } else {
          expect(node.depth).toBe(0);
          expect(ancestorIds(node.path)).toEqual([]);
        }
      }
    }
  });

  it('keeps every invariant after moving a subtree', () => {
    const nodes = buildRandomTree(60);
    const source = nodes.find((n) => n.parent !== null && n.depth >= 1);
    const target = nodes.find(
      (n) => source && !isDescendantOf(n.path, source.path) && n.path !== source.path,
    );
    if (!source || !target) return;

    const oldPrefix = source.path;
    const newPrefix = buildPath(target.path, source.id);
    const depthDelta = depthOf(newPrefix) - depthOf(oldPrefix);

    const moved = nodes
      .filter((n) => n.path === oldPrefix || isDescendantOf(n.path, oldPrefix))
      .map((n) => ({
        ...n,
        path: rewritePrefix(n.path, oldPrefix, newPrefix),
        depth: n.depth + depthDelta,
      }));

    for (const node of moved) {
      expect(node.path.endsWith(`/${node.id}/`)).toBe(true);
      expect(depthOf(node.path)).toBe(node.depth);
      expect(node.path.startsWith(newPrefix)).toBe(true);
    }
  });
});
