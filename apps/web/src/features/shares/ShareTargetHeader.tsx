import { FileText, Folder } from 'lucide-react';
import type { NodeType } from '@dataroom/contracts';

export interface ShareTargetHeaderProps {
  name: string;
  type: NodeType;
}

export function ShareTargetHeader({ name, type }: ShareTargetHeaderProps): JSX.Element {
  return (
    <p className="mb-3 flex items-center gap-2 rounded-md bg-surface-muted px-3 py-2 text-sm text-ink">
      {type === 'folder' ? (
        <Folder aria-hidden="true" className="h-4 w-4 text-accent" />
      ) : (
        <FileText aria-hidden="true" className="h-4 w-4 text-ink-muted" />
      )}
      <span className="min-w-0 truncate">
        {`Sharing: ${name}`}
        <span className="text-ink-subtle">{` (${type})`}</span>
      </span>
    </p>
  );
}
