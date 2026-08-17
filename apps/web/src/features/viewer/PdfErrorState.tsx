import { FileWarning } from 'lucide-react';
import { StateBlock } from '@/components/ui/StateBlock';

export interface PdfErrorStateProps {
  fileName: string;
  onDownload: () => void;
  onRetry: () => void;
}

/**
 * A document that will not render is not a broken page. The file is still there and still
 * downloadable, and saying so is more useful than a blank viewer.
 */
export function PdfErrorState({ fileName, onDownload, onRetry }: PdfErrorStateProps): JSX.Element {
  return (
    <StateBlock
      tone="danger"
      icon={<FileWarning aria-hidden="true" className="h-8 w-8" />}
      title="This PDF couldn’t be displayed"
      body={`“${fileName}” may be damaged, or it may use a feature the in-app viewer doesn’t support. You can still download it and open it locally.`}
      action={{ label: 'Download', onClick: onDownload }}
      secondaryAction={{ label: 'Try again', onClick: onRetry }}
      className="m-6"
    />
  );
}
