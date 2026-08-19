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
  /** -1 for rows outside the roving tab order; the grid's arrow keys reach them instead. */
  tabIndex?: number | undefined;
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
  tabIndex,
  onOpen,
  onRenameCommit,
  onRenameCancel,
}: NodeNameCellProps): JSX.Element {
  const [draft, setDraft] = useState(node.name);
  const inputRef = useRef<HTMLInputElement>(null);
  const committedRef = useRef(false);
  const wasRenaming = useRef(false);

  /**
   * Seed the draft when the field **opens**, and never again while it is open.
   *
   * Reseeding on every `node.name` change looks harmless and is not: a rename is optimistic, so a
   * rejected one writes the new name into the cache and then puts the old one back, and both writes
   * arrive here as a changed `node.name`. The second one overwrote whatever the user had typed —
   * so a `NAME_CONFLICT` cleared the field it was supposed to keep, which is the opposite of what
   * SPEC-07 promises ("keeps the input open with the text preserved — a toast would lose the user's
   * typing"). It also meant a second tab renaming this node could wipe the edit in progress.
   */
  useEffect(() => {
    if (isRenaming && !wasRenaming.current) {
      setDraft(node.name);
      committedRef.current = false;
    }
    wasRenaming.current = isRenaming;
  }, [isRenaming, node.name]);

  /**
   * A rejected commit has to be retryable. `committedRef` exists to stop blur from committing again
   * after Enter already did, and it used to be cleared by the reseed above — which is the same
   * effect that was eating the typing, so removing one without the other would leave the field open,
   * the text intact, and every further Enter ignored.
   */
  useEffect(() => {
    if (renameError !== null && renameError !== undefined) committedRef.current = false;
  }, [renameError]);

  useEffect(() => {
    if (!isRenaming) return;
    // Focus is taken on the next task, not synchronously: the action menu that opened this field
    // is still unmounting, and its focus scope moves focus as it goes. Grabbing focus first would
    // simply be overridden — and the resulting blur would commit an edit the user never made.
    const timer = setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 0);
    return () => {
      clearTimeout(timer);
    };
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
      {...(tabIndex === undefined ? {} : { tabIndex })}
      className="flex min-w-0 items-center gap-2 rounded text-left text-ink hover:underline"
    >
      <NodeIcon node={node} />
      <span className="truncate">{node.name}</span>
    </button>
  );
}
