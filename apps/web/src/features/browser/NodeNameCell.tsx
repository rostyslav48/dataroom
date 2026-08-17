import { useEffect, useRef, useState } from 'react';
import type { NodeListItem } from '@dataroom/contracts';
import { Input } from '@/components/ui/Input';
import { NodeIcon } from './NodeIcon';

export interface NodeNameCellProps {
  node: NodeListItem;
  isRenaming: boolean;
  /** Inline message under the input, used for NAME_CONFLICT — a toast would lose the typing. */
  renameError?: string | null | undefined;
  renameBusy?: boolean | undefined;
  onOpen: () => void;
  onRenameCommit: (name: string) => void;
  onRenameCancel: () => void;
}

/**
 * The name swaps to an input in place rather than opening a dialog: renaming is a small edit and a
 * modal for it costs two extra interactions. Enter commits, Escape restores the original, blur
 * commits — the same contract as Finder and Drive, so nobody has to learn it.
 */
export function NodeNameCell({
  node,
  isRenaming,
  renameError,
  renameBusy = false,
  onOpen,
  onRenameCommit,
  onRenameCancel,
}: NodeNameCellProps): JSX.Element {
  const [draft, setDraft] = useState(node.name);
  const inputRef = useRef<HTMLInputElement>(null);
  const committedRef = useRef(false);

  useEffect(() => {
    if (isRenaming) {
      setDraft(node.name);
      committedRef.current = false;
    }
  }, [isRenaming, node.name]);

  useEffect(() => {
    if (isRenaming) inputRef.current?.select();
  }, [isRenaming]);

  if (isRenaming) {
    const commit = (): void => {
      if (committedRef.current) return;
      committedRef.current = true;
      onRenameCommit(draft);
    };

    return (
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <NodeIcon node={node} />
          <Input
            ref={inputRef}
            aria-label={`Rename ${node.name}`}
            value={draft}
            disabled={renameBusy}
            invalid={renameError !== null && renameError !== undefined}
            aria-describedby={renameError === null || renameError === undefined ? undefined : `rename-error-${node.id}`}
            onChange={(event) => {
              setDraft(event.target.value);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                commit();
              }
              if (event.key === 'Escape') {
                event.preventDefault();
                committedRef.current = true;
                onRenameCancel();
              }
            }}
            onBlur={commit}
            className="h-7"
          />
        </div>
        {renameError === null || renameError === undefined ? null : (
          <p id={`rename-error-${node.id}`} role="alert" className="mt-1 pl-6 text-xs text-danger">
            {renameError}
          </p>
        )}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex min-w-0 items-center gap-2 text-left text-ink hover:underline"
    >
      <NodeIcon node={node} />
      <span className="truncate">{node.name}</span>
    </button>
  );
}
