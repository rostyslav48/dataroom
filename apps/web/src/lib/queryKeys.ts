/**
 * Every query key in one place, so invalidation after a mutation is mechanical rather than
 * guessed. A mutation that invalidates `qk.children(parentId, …)` and a query that registered
 * itself under a hand-written array would silently never talk to each other.
 */
export const qk = {
  me: () => ['me'] as const,
  rooms: () => ['rooms'] as const,
  room: (id: string) => ['room', id] as const,
  node: (id: string) => ['node', id] as const,
  /** `p` is the sort/direction/filter object: changing sort is a different collection, not a
   *  re-render of the same one, so it must reset pagination. */
  children: (id: string, p: object) => ['children', id, p] as const,
  stats: (id: string) => ['stats', id] as const,
  deletePreview: (id: string) => ['deletePreview', id] as const,
  shares: (nodeId: string) => ['shares', nodeId] as const,
  sharedLink: (token: string) => ['sharedLink', token] as const,
} as const;

/** Prefix used to invalidate every page of every sort order for one folder. */
export const childrenKeyPrefix = (id: string): readonly ['children', string] => ['children', id];
