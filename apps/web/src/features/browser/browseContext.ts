/**
 * Where the user is browsing from: their own room, or a public link.
 *
 * The two differ in exactly two ways — the URL prefix, and whether requests carry an
 * `X-Share-Token`. Everything else about browsing is identical, which is why there is no separate
 * component tree for shared views; a permissioned recipient uses the room routes like anyone else.
 */
export type BrowseContext =
  | { kind: 'room'; roomId: string }
  | { kind: 'share'; token: string };

export function contextRoot(context: BrowseContext): string {
  return context.kind === 'room' ? `/rooms/${context.roomId}` : `/s/${context.token}`;
}

export function folderPath(context: BrowseContext, nodeId: string): string {
  return `${contextRoot(context)}/f/${nodeId}`;
}

export function filePath(context: BrowseContext, nodeId: string): string {
  return `${contextRoot(context)}/file/${nodeId}`;
}

export function shareTokenOf(context: BrowseContext): string | undefined {
  return context.kind === 'share' ? context.token : undefined;
}
