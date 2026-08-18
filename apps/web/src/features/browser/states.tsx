import { FolderOpen, Inbox } from 'lucide-react';
import { Skeleton } from '@/components/ui/Skeleton';
import { StateBlock } from '@/components/ui/StateBlock';
import { presentError } from '@/lib/errorMap';

export interface SkeletonRowsProps {
  rows?: number;
}

export function SkeletonRows({ rows = 6 }: SkeletonRowsProps): JSX.Element {
  return (
    <div role="status" aria-live="polite" className="divide-y divide-line">
      <span className="sr-only">Loading folder contents</span>
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="flex h-11 items-center gap-3 px-3">
          <Skeleton className="h-4 w-4 rounded" />
          <Skeleton className="h-4 flex-1" />
          <Skeleton className="hidden h-4 w-16 md:block" />
          <Skeleton className="hidden h-4 w-24 md:block" />
        </div>
      ))}
    </div>
  );
}

export interface EmptyFolderStateProps {
  /** A viewer cannot add anything, so they are told the folder is empty and nothing more. */
  canManage: boolean;
  onNewFolder?: () => void;
}

export function EmptyFolderState({ canManage, onNewFolder }: EmptyFolderStateProps): JSX.Element {
  if (!canManage) {
    return (
      <StateBlock
        icon={<Inbox aria-hidden="true" className="h-7 w-7" />}
        title="This folder is empty"
        body="There is nothing shared with you in here."
        className="m-3"
      />
    );
  }

  return (
    <StateBlock
      icon={<FolderOpen aria-hidden="true" className="h-7 w-7" />}
      title="This folder is empty"
      body="Drop files here to upload them, or create a folder to organise them first."
      className="m-3"
      {...(onNewFolder === undefined ? {} : { action: { label: 'New folder', onClick: onNewFolder } })}
    />
  );
}

export interface ListErrorStateProps {
  error: unknown;
  onRetry: () => void;
}

export function ListErrorState({ error, onRetry }: ListErrorStateProps): JSX.Element {
  const presentation = presentError(error);
  return (
    <StateBlock
      tone="danger"
      title={presentation.title}
      body={presentation.body}
      action={{ label: 'Try again', onClick: onRetry }}
      className="m-3"
    />
  );
}
