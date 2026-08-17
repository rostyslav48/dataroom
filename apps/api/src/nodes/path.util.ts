/**
 * Materialized-path arithmetic. Pure, dependency-free, and exhaustively tested — every one of
 * these functions is silent when wrong, and a wrong path is not a rendering bug but a permission
 * bug: `ancestorIds` is what the access check consumes.
 *
 * Format: `/<rootId>/<...ancestorIds>/<selfId>/` — leading and trailing slash, ids only.
 */

const PATH_SHAPE = /^\/(?:[^/]+\/)+$/;

export class InvalidPathError extends Error {
  constructor(path: string) {
    super(`Not a node path: ${JSON.stringify(path)}`);
    this.name = 'InvalidPathError';
  }
}

function assertPath(path: string): void {
  if (!PATH_SHAPE.test(path)) throw new InvalidPathError(path);
}

/** `'/a/b/'` + `'c'` → `'/a/b/c/'`. The parent's path is a strict prefix of the child's, always. */
export function buildPath(parentPath: string, id: string): string {
  assertPath(parentPath);
  if (id.length === 0 || id.includes('/')) throw new InvalidPathError(id);
  return `${parentPath}${id}/`;
}

/** The root of a data room: its own id and nothing else. */
export function rootPath(id: string): string {
  if (id.length === 0 || id.includes('/')) throw new InvalidPathError(id);
  return `/${id}/`;
}

export function pathSegments(path: string): string[] {
  assertPath(path);
  return path.slice(1, -1).split('/');
}

/**
 * Ancestors, root first, **excluding** the node itself.
 *
 * This is the load-bearing one: the permission check needs "every node a share could be attached
 * to that would cover this node", and it gets it from a string already in memory rather than from
 * a recursive query.
 */
export function ancestorIds(path: string): string[] {
  return pathSegments(path).slice(0, -1);
}

/** Ancestors plus the node itself — the exact set `shares.node_id` is matched against. */
export function selfAndAncestorIds(path: string): string[] {
  return pathSegments(path);
}

export function selfId(path: string): string {
  const segments = pathSegments(path);
  return segments[segments.length - 1] as string;
}

export function parentPath(path: string): string | null {
  const segments = pathSegments(path);
  if (segments.length === 1) return null;
  return `/${segments.slice(0, -1).join('/')}/`;
}

/** Root is 0. Equivalent to `(number of slashes) - 2`, which is how the design document states it. */
export function depthOf(path: string): number {
  return pathSegments(path).length - 1;
}

/** Strict: a node is not a descendant of itself. */
export function isDescendantOf(childPath: string, ancestorPath: string): boolean {
  assertPath(childPath);
  assertPath(ancestorPath);
  return childPath !== ancestorPath && childPath.startsWith(ancestorPath);
}

/**
 * Used by move: every descendant's path is rewritten by swapping the moving node's old prefix for
 * its new one, in one `UPDATE`. The suffix is preserved exactly, so relative structure survives.
 */
export function rewritePrefix(path: string, oldPrefix: string, newPrefix: string): string {
  assertPath(path);
  assertPath(oldPrefix);
  assertPath(newPrefix);
  if (!path.startsWith(oldPrefix)) {
    throw new InvalidPathError(`${path} does not start with ${oldPrefix}`);
  }
  return `${newPrefix}${path.slice(oldPrefix.length)}`;
}

/**
 * `%` and `_` are wildcards in `LIKE`. Node ids are UUIDs so they cannot contain either, but a path
 * prefix is still user-reachable input by the time it is a query parameter, and "it can't happen"
 * is how injection bugs are written. Escaping here costs nothing.
 */
export function likePrefix(path: string): string {
  assertPath(path);
  return `${path.replace(/([%_\\])/g, '\\$1')}%`;
}
