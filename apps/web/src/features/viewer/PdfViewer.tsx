import { useMemo } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import workerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { SHARE_TOKEN_HEADER } from '@dataroom/contracts';
import { Skeleton } from '@/components/ui/Skeleton';
import { tokenStore } from '@/lib/tokenStore';

/**
 * The pdf.js worker is bundled from the pinned `pdfjs-dist` in this app's own dependencies, never
 * fetched from a CDN. Two reasons: a CDN serving a version that does not match `react-pdf`'s
 * expectations breaks rendering silently, and a confidentiality product should not hand a third
 * party the timing and shape of every document its users open.
 */
pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;

export interface PdfViewerProps {
  /** The `/nodes/:id/content` URL, which 302s to a short-lived signed storage URL. */
  fileUrl: string;
  shareToken?: string | undefined;
  pageNumber: number;
  scale: number;
  onLoadSuccess: (numPages: number) => void;
  onLoadError: (error: unknown) => void;
}

export function PdfViewer({
  fileUrl,
  shareToken,
  pageNumber,
  scale,
  onLoadSuccess,
  onLoadError,
}: PdfViewerProps): JSX.Element {
  // Memoised: react-pdf reloads the document whenever this object's identity changes, so an
  // inline literal would restart the fetch on every render and never finish.
  const file = useMemo(() => {
    const httpHeaders: Record<string, string> = {};
    const token = tokenStore.get();
    if (token !== null) httpHeaders.Authorization = `Bearer ${token}`;
    if (shareToken !== undefined && shareToken !== '') httpHeaders[SHARE_TOKEN_HEADER] = shareToken;
    return { url: fileUrl, httpHeaders, withCredentials: true };
  }, [fileUrl, shareToken]);

  return (
    <div className="flex justify-center overflow-auto bg-surface-sunken p-4">
      <Document
        file={file}
        loading={
          <div role="status" className="w-[min(40rem,90vw)] space-y-2 p-6">
            <span className="sr-only">Loading document</span>
            <Skeleton className="h-72 w-full" />
          </div>
        }
        onLoadSuccess={(document: { numPages: number }) => {
          onLoadSuccess(document.numPages);
        }}
        onLoadError={onLoadError}
        error={null}
      >
        <Page
          pageNumber={pageNumber}
          scale={scale}
          renderTextLayer={false}
          renderAnnotationLayer={false}
        />
      </Document>
    </div>
  );
}
