import { useId, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, Folder } from 'lucide-react';
import type { NodeListItem } from '@dataroom/contracts';
import { cn } from '@/lib/cn';
import { Skeleton } from '@/components/ui/Skeleton';
import { Tooltip } from '@/components/ui/Tooltip';
import { listChildren } from '@/lib/apiEndpoints';
import { presentError } from '@/lib/errorMap';
import { qk } from '@/lib/queryKeys';

export interface DisabledReasonInput {
  node: { id: string };
  insideMovingSubtree: boolean;
}

export interface FolderTreeNodeProps {
  id: string;
  name: string;
  depth: number;
  selectedId: string | null;
  onSelect: (id: string) => void;
  /** Returns why this folder cannot receive the move, or null when it can. */
  disabledReason: (input: DisabledReasonInput) => string | null;
  /** True once an ancestor in this branch is the node being moved. */
  insideMovingSubtree: boolean;
  movingNodeId: string;
  shareToken?: string | undefined;
  defaultExpanded?: boolean;
}

/**
 * One folder in the picker, expanding to fetch its children only when opened.
 *
 * An invalid destination is rendered disabled with the reason attached, never hidden: people look
 * for the folder they have in mind, and a missing row reads as a bug in the app rather than as an
 * answer to their question.
 */
export function FolderTreeNode({
  id,
  name,
  depth,
  selectedId,
  onSelect,
  disabledReason,
  insideMovingSubtree,
  movingNodeId,
  shareToken,
  defaultExpanded = false,
}: FolderTreeNodeProps): JSX.Element {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const reasonId = useId();

  const children = useQuery({
    queryKey: qk.folderTree(id),
    queryFn: ({ signal }) =>
      listChildren(id, { sort: 'name', dir: 'asc', limit: 100 }, { shareToken }, signal),
    enabled: expanded,
  });

  const branchInsideMoving = insideMovingSubtree || id === movingNodeId;
  const reason = disabledReason({ node: { id }, insideMovingSubtree });
  const isDisabled = reason !== null;
  const isSelected = selectedId === id;

  const folders: NodeListItem[] =
    children.data?.items.filter((item) => item.type === 'folder') ?? [];

  const label = (
    <button
      type="button"
      aria-disabled={isDisabled}
      aria-current={isSelected ? 'true' : undefined}
      aria-describedby={isDisabled ? reasonId : undefined}
      onClick={() => {
        if (!isDisabled) onSelect(id);
      }}
      className={cn(
        'flex min-w-0 flex-1 items-center gap-2 rounded px-2 py-1 text-left text-sm',
        isDisabled
          ? 'cursor-not-allowed text-ink-subtle'
          : isSelected
            ? 'bg-accent-subtle text-accent'
            : 'text-ink hover:bg-surface-sunken',
      )}
    >
      <Folder aria-hidden="true" className="h-4 w-4 shrink-0" />
      <span className="truncate">{name}</span>
    </button>
  );

  return (
    <li role="treeitem" aria-expanded={expanded} aria-selected={isSelected}>
      <div className="flex items-center" style={{ paddingLeft: `${String(depth * 12)}px` }}>
        <button
          type="button"
          aria-label={expanded ? `Collapse ${name}` : `Expand ${name}`}
          className="rounded p-1 text-ink-subtle hover:bg-surface-sunken"
          onClick={() => {
            setExpanded((value) => !value);
          }}
        >
          {expanded ? (
            <ChevronDown aria-hidden="true" className="h-3.5 w-3.5" />
          ) : (
            <ChevronRight aria-hidden="true" className="h-3.5 w-3.5" />
          )}
        </button>

        {isDisabled ? <Tooltip content={reason}>{label}</Tooltip> : label}
      </div>

      {/* The reason is real text, not only a hover tooltip: a keyboard or screen-reader user needs
          the same explanation a mouse user gets. */}
      {isDisabled ? (
        <span id={reasonId} className="sr-only">
          {reason}
        </span>
      ) : null}

      {expanded ? (
        <ul role="group">
          {children.isPending ? (
            <li className="px-8 py-1">
              <Skeleton className="h-4 w-32" />
            </li>
          ) : null}
          {children.error !== null ? (
            <li role="alert" className="px-8 py-1 text-xs text-danger">
              {presentError(children.error).title}
            </li>
          ) : null}
          {!children.isPending && children.error === null && folders.length === 0 ? (
            <li className="px-8 py-1 text-xs text-ink-subtle">No folders inside</li>
          ) : null}
          {folders.map((folder) => (
            <FolderTreeNode
              key={folder.id}
              id={folder.id}
              name={folder.name}
              depth={depth + 1}
              selectedId={selectedId}
              onSelect={onSelect}
              disabledReason={disabledReason}
              insideMovingSubtree={branchInsideMoving}
              movingNodeId={movingNodeId}
              shareToken={shareToken}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}
