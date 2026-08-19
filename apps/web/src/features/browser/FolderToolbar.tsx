import { FolderPlus, Pencil, Share2, Upload } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { formatBytes } from '@/lib/format';

export interface FolderToolbarProps {
  folderName: string;
  fileCount: number | null;
  sizeBytes: number | null;
  /** Each control renders only when it is wired. A viewer gets none of them at all. */
  onNewFolder?: (() => void) | undefined;
  onUpload?: (() => void) | undefined;
  onShare?: (() => void) | undefined;
  onRenameRoom?: (() => void) | undefined;
}

export function FolderToolbar({
  folderName,
  fileCount,
  sizeBytes,
  onNewFolder,
  onUpload,
  onShare,
  onRenameRoom,
}: FolderToolbarProps): JSX.Element {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="truncate text-lg font-semibold text-ink">{folderName}</h1>
        <p className="text-sm text-ink-muted">
          {fileCount === null
            ? formatBytes(sizeBytes)
            : `${String(fileCount)} ${fileCount === 1 ? 'file' : 'files'} · ${formatBytes(sizeBytes)}`}
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {onRenameRoom === undefined ? null : (
          <Button
            leadingIcon={<Pencil aria-hidden="true" className="h-4 w-4" />}
            onClick={onRenameRoom}
          >
            Rename data room
          </Button>
        )}
        {onNewFolder === undefined ? null : (
          <Button
            leadingIcon={<FolderPlus aria-hidden="true" className="h-4 w-4" />}
            onClick={onNewFolder}
          >
            New folder
          </Button>
        )}
        {onUpload === undefined ? null : (
          <Button leadingIcon={<Upload aria-hidden="true" className="h-4 w-4" />} onClick={onUpload}>
            Upload
          </Button>
        )}
        {onShare === undefined ? null : (
          <Button
            variant="primary"
            leadingIcon={<Share2 aria-hidden="true" className="h-4 w-4" />}
            onClick={onShare}
          >
            Share
          </Button>
        )}
      </div>
    </div>
  );
}
