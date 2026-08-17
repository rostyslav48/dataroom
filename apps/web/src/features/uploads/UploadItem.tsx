import { ArrowRight, RotateCcw, X } from 'lucide-react';
import type { UploadQueueItem } from '@dataroom/contracts';
import { cn } from '@/lib/cn';
import { formatBytes } from '@/lib/format';

export interface UploadItemProps {
  item: UploadQueueItem;
  onCancel: (localId: string) => void;
  onRetry: (localId: string) => void;
  onDismiss: (localId: string) => void;
}

const STATUS_LABEL: Record<UploadQueueItem['status'], string> = {
  queued: 'Waiting',
  initializing: 'Preparing',
  uploading: 'Uploading',
  finalizing: 'Finishing',
  done: 'Uploaded',
  error: 'Failed',
  canceled: 'Canceled',
};

export function UploadItem({ item, onCancel, onRetry, onDismiss }: UploadItemProps): JSX.Element {
  const isActive =
    item.status === 'queued' ||
    item.status === 'initializing' ||
    item.status === 'uploading' ||
    item.status === 'finalizing';
  const renamed = item.finalName !== undefined && item.finalName !== item.requestedName;

  return (
    <li className="flex items-start gap-3 border-b border-line px-3 py-2 last:border-b-0">
      <div className="min-w-0 flex-1">
        <p className="flex min-w-0 items-center gap-1 text-sm text-ink">
          <span className="truncate">{item.requestedName}</span>
          {/* The server auto-suffixes a conflicting name. Showing it here is the difference
              between a rename the user saw and one they discover in the folder later. */}
          {renamed ? (
            <>
              <ArrowRight aria-hidden="true" className="h-3 w-3 shrink-0 text-ink-subtle" />
              <span className="truncate font-medium">{item.finalName}</span>
            </>
          ) : null}
        </p>

        <div className="mt-1 flex items-center gap-2">
          <div
            role="progressbar"
            aria-label={`Upload progress for ${item.requestedName}`}
            aria-valuenow={item.status === 'done' ? 100 : item.progress}
            aria-valuemin={0}
            aria-valuemax={100}
            className="h-1.5 w-full overflow-hidden rounded bg-surface-sunken"
          >
            <div
              className={cn(
                'h-full rounded transition-[width]',
                item.status === 'error' ? 'bg-danger' : 'bg-accent',
              )}
              style={{ width: `${String(item.status === 'done' ? 100 : item.progress)}%` }}
            />
          </div>
          <span className="w-20 shrink-0 text-right text-xs text-ink-subtle">
            {STATUS_LABEL[item.status]}
          </span>
        </div>

        <p className="mt-0.5 text-xs text-ink-subtle">
          {item.error === undefined ? formatBytes(item.file.size) : null}
        </p>
        {item.error === undefined ? null : (
          <p role="alert" className="mt-0.5 text-xs text-danger">
            {item.error.message}
          </p>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-1">
        {item.status === 'error' ? (
          <button
            type="button"
            aria-label={`Retry ${item.requestedName}`}
            className="rounded p-1 text-ink-subtle hover:bg-surface-sunken hover:text-ink"
            onClick={() => {
              onRetry(item.localId);
            }}
          >
            <RotateCcw aria-hidden="true" className="h-4 w-4" />
          </button>
        ) : null}

        <button
          type="button"
          aria-label={isActive ? `Cancel ${item.requestedName}` : `Dismiss ${item.requestedName}`}
          className="rounded p-1 text-ink-subtle hover:bg-surface-sunken hover:text-ink"
          onClick={() => {
            if (isActive) onCancel(item.localId);
            else onDismiss(item.localId);
          }}
        >
          <X aria-hidden="true" className="h-4 w-4" />
        </button>
      </div>
    </li>
  );
}
