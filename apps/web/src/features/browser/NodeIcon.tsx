import { File, FileText, Folder } from 'lucide-react';
import type { NodeDto } from '@dataroom/contracts';

export interface NodeIconProps {
  node: Pick<NodeDto, 'type' | 'mimeType'>;
}

export function NodeIcon({ node }: NodeIconProps): JSX.Element {
  if (node.type === 'folder') {
    return <Folder aria-hidden="true" className="h-4 w-4 shrink-0 text-accent" />;
  }
  if (node.mimeType === 'application/pdf') {
    return <FileText aria-hidden="true" className="h-4 w-4 shrink-0 text-ink-muted" />;
  }
  return <File aria-hidden="true" className="h-4 w-4 shrink-0 text-ink-subtle" />;
}
