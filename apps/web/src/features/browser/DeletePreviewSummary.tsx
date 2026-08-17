import type { DeletePreviewDto } from '@dataroom/contracts';
import { Skeleton } from '@/components/ui/Skeleton';
import { presentError } from '@/lib/errorMap';
import { formatBytes, formatCounts } from '@/lib/format';

export interface DeletePreviewSummaryProps {
  preview: DeletePreviewDto | undefined;
  isLoading: boolean;
  error: unknown;
  nodeName: string;
  nodeType: 'folder' | 'file';
}

/**
 * The blast radius, counted by the server rather than guessed from the page the client happens to
 * hold. A client-side count would only ever see the first 50 rows and would understate what is
 * about to be destroyed — on the one action in this app that cannot be undone.
 */
export function DeletePreviewSummary({
  preview,
  isLoading,
  error,
  nodeName,
  nodeType,
}: DeletePreviewSummaryProps): JSX.Element {
  if (isLoading) {
    return (
      <div role="status" aria-live="polite" className="space-y-2">
        <span className="sr-only">Working out what will be deleted</span>
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-4 w-1/2" />
      </div>
    );
  }

  if (error !== null && error !== undefined) {
    return (
      <p role="alert" className="text-sm text-danger">
        {`${presentError(error).title}. Deleting is blocked until we can tell you what it would remove.`}
      </p>
    );
  }

  if (preview === undefined) return <span />;

  const affected = preview.folderCount + preview.fileCount;

  return (
    <div className="space-y-2 text-sm">
      <p>
        {nodeType === 'file'
          ? `“${nodeName}” will be deleted permanently.`
          : affected === 0
            ? `“${nodeName}” is empty and will be deleted permanently.`
            : `Deletes “${nodeName}” and everything inside it: ${formatCounts(preview.folderCount, preview.fileCount)}, ${formatBytes(preview.sizeBytes)}.`}
      </p>
      {preview.affectedShareCount > 0 ? (
        <p className="text-danger">
          {`${String(preview.affectedShareCount)} ${
            preview.affectedShareCount === 1 ? 'share' : 'shares'
          } will stop working immediately for whoever holds them.`}
        </p>
      ) : null}
      <p className="font-medium text-ink">This cannot be undone.</p>
    </div>
  );
}
