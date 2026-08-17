import { File } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { formatBytes } from '@/lib/format';

export interface UnsupportedPreviewProps {
  fileName: string;
  mimeType: string | null;
  sizeBytes: number | null;
  onDownload: () => void;
}

/**
 * PDF is the only type this app previews. Everything else gets an honest card rather than an
 * embed that renders as a grey box or, worse, prompts a plugin.
 */
export function UnsupportedPreview({
  fileName,
  mimeType,
  sizeBytes,
  onDownload,
}: UnsupportedPreviewProps): JSX.Element {
  return (
    <div className="m-6 flex flex-col items-center gap-3 rounded-lg border border-line bg-surface p-10 text-center">
      <File aria-hidden="true" className="h-10 w-10 text-ink-subtle" />
      <p className="text-sm font-semibold text-ink">{fileName}</p>
      <p className="text-sm text-ink-muted">
        {`${mimeType ?? 'This file type'} · ${formatBytes(sizeBytes)}`}
      </p>
      <p className="max-w-sm text-sm text-ink-muted">
        Only PDFs can be previewed here. Download the file to open it in the application it belongs
        to.
      </p>
      <Button variant="primary" onClick={onDownload}>
        Download
      </Button>
    </div>
  );
}
