import { ArrowLeft, ChevronLeft, ChevronRight, Download, ZoomIn, ZoomOut } from 'lucide-react';
import { Button } from '@/components/ui/Button';

export interface ViewerToolbarProps {
  fileName: string;
  onBack: () => void;
  onDownload: () => void;
  downloading: boolean;
  /** Paging and zoom appear only for a document that is actually paginated. */
  pagination?:
    | {
        pageNumber: number;
        numPages: number;
        onPageChange: (page: number) => void;
        scale: number;
        onScaleChange: (scale: number) => void;
      }
    | undefined;
}

export const MIN_SCALE = 0.5;
export const MAX_SCALE = 3;

export function ViewerToolbar({
  fileName,
  onBack,
  onDownload,
  downloading,
  pagination,
}: ViewerToolbarProps): JSX.Element {
  return (
    <div
      role="toolbar"
      aria-label="Document actions"
      className="flex flex-wrap items-center gap-2 border-b border-line bg-surface px-3 py-2"
    >
      <Button
        variant="ghost"
        size="sm"
        leadingIcon={<ArrowLeft aria-hidden="true" className="h-4 w-4" />}
        onClick={onBack}
      >
        Back
      </Button>
      <p className="min-w-0 flex-1 truncate text-sm font-medium text-ink">{fileName}</p>

      {pagination === undefined ? null : (
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            aria-label="Previous page"
            disabled={pagination.pageNumber <= 1}
            onClick={() => {
              pagination.onPageChange(pagination.pageNumber - 1);
            }}
          >
            <ChevronLeft aria-hidden="true" className="h-4 w-4" />
          </Button>
          <span className="text-sm tabular-nums text-ink-muted" aria-live="polite">
            {`Page ${String(pagination.pageNumber)} of ${String(pagination.numPages)}`}
          </span>
          <Button
            variant="ghost"
            size="sm"
            aria-label="Next page"
            disabled={pagination.pageNumber >= pagination.numPages}
            onClick={() => {
              pagination.onPageChange(pagination.pageNumber + 1);
            }}
          >
            <ChevronRight aria-hidden="true" className="h-4 w-4" />
          </Button>

          <Button
            variant="ghost"
            size="sm"
            aria-label="Zoom out"
            disabled={pagination.scale <= MIN_SCALE}
            onClick={() => {
              pagination.onScaleChange(Math.max(MIN_SCALE, pagination.scale - 0.25));
            }}
          >
            <ZoomOut aria-hidden="true" className="h-4 w-4" />
          </Button>
          <span className="w-12 text-center text-sm tabular-nums text-ink-muted">
            {`${String(Math.round(pagination.scale * 100))}%`}
          </span>
          <Button
            variant="ghost"
            size="sm"
            aria-label="Zoom in"
            disabled={pagination.scale >= MAX_SCALE}
            onClick={() => {
              pagination.onScaleChange(Math.min(MAX_SCALE, pagination.scale + 0.25));
            }}
          >
            <ZoomIn aria-hidden="true" className="h-4 w-4" />
          </Button>
        </div>
      )}

      <Button
        variant="secondary"
        size="sm"
        busy={downloading}
        data-testid="toolbar-download"
        leadingIcon={<Download aria-hidden="true" className="h-4 w-4" />}
        onClick={onDownload}
      >
        Download
      </Button>
    </div>
  );
}
