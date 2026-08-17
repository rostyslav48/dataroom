import type { NodeDto } from '@dataroom/contracts';
import { formatBytes } from '@/lib/format';

export interface NodeSizeCellProps {
  node: Pick<NodeDto, 'type' | 'sizeBytes' | 'subtreeSizeBytes'>;
}

/**
 * A folder shows its cached subtree rollup, a file its own size. A null rollup renders "—", never
 * "0 B": the difference between "not computed yet" and "empty" matters to someone deciding whether
 * a folder is worth opening.
 */
export function NodeSizeCell({ node }: NodeSizeCellProps): JSX.Element {
  const bytes = node.type === 'folder' ? node.subtreeSizeBytes : node.sizeBytes;
  return <span className="tabular-nums text-ink-muted">{formatBytes(bytes)}</span>;
}
