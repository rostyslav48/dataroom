import { Suspense, lazy, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Skeleton } from '@/components/ui/Skeleton';
import { presentError } from '@/lib/errorMap';
import { nodeContentUrl } from '@/lib/apiEndpoints';
import { folderPath, shareTokenOf, type BrowseContext } from '@/features/browser/browseContext';
import { useNodeDetail } from '@/features/browser/useNodeQueries';
import { AccessErrorScreen } from '@/features/shares/accessStates';
import { SharedLayout } from '@/features/shares/SharedLayout';
import { useSharedByName } from '@/features/shares/useSharedBy';
import {
  shareResolveProvesRootGone,
  useShareResolve,
} from '@/features/shares/useShareResolve';
import { ViewerToolbar } from './ViewerToolbar';
import { UnsupportedPreview } from './UnsupportedPreview';
import { PdfErrorState } from './PdfErrorState';
import { downloadNode } from './download';

/** pdf.js and its worker are a large dependency; they load when a PDF is actually opened. */
const PdfViewer = lazy(() =>
  import('./PdfViewer').then((module) => ({ default: module.PdfViewer })),
);

export interface FileViewerPageProps {
  nodeId: string;
  context: BrowseContext;
}

const PREVIEWABLE = 'application/pdf';

export function FileViewerPage({ nodeId, context }: FileViewerPageProps): JSX.Element {
  const navigate = useNavigate();
  const shareToken = shareTokenOf(context);
  const detail = useNodeDetail(nodeId, shareToken);
  const resolvedShare = useShareResolve(shareToken ?? '');
  const sharedBy = useSharedByName(context, detail.data?.node.dataRoomId ?? '');

  const [pageNumber, setPageNumber] = useState(1);
  const [numPages, setNumPages] = useState(0);
  const [scale, setScale] = useState(1);
  /**
   * A content URL is signed for 60 seconds. If it expires between the redirect and the fetch, the
   * load fails once; bumping this attempt asks the API for a fresh signature and reloads. Exactly
   * one silent retry — a loop would hide a genuinely broken document behind endless spinners.
   */
  const [attempt, setAttempt] = useState(0);
  const [failed, setFailed] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  const startDownload = (fileName: string): void => {
    setDownloading(true);
    setDownloadError(null);
    void downloadNode(nodeId, fileName, shareToken)
      .catch((error: unknown) => {
        setDownloadError(presentError(error).title);
      })
      .finally(() => {
        setDownloading(false);
      });
  };

  if (detail.isPending) {
    return (
      <div role="status" aria-live="polite" className="mx-auto max-w-4xl space-y-3 p-4">
        <span className="sr-only">Loading document</span>
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  if (detail.error !== null) {
    return (
      <div className="mx-auto max-w-2xl">
        <AccessErrorScreen
          error={detail.error}
          context={context}
          nodeId={nodeId}
          shareRootId={resolvedShare.data?.nodeId}
          itemGoneIsShareRoot={shareResolveProvesRootGone(resolvedShare.error)}
          onRetry={() => {
            void detail.refetch();
          }}
        />
      </div>
    );
  }

  const node = detail.data.node;
  const parentPath = folderPath(context, node.parentId ?? detail.data.shareRootId);
  const isPdf = node.mimeType === PREVIEWABLE;
  const contentUrl =
    attempt === 0 ? nodeContentUrl(nodeId) : `${nodeContentUrl(nodeId)}?refresh=${String(attempt)}`;

  const body = (
    <div className="mx-auto flex min-h-full max-w-5xl flex-col overflow-hidden rounded-lg border border-line bg-surface">
      <ViewerToolbar
        fileName={node.name}
        downloading={downloading}
        onBack={() => {
          void navigate(parentPath);
        }}
        onDownload={() => {
          startDownload(node.name);
        }}
        pagination={
          isPdf && numPages > 0 && !failed
            ? {
                pageNumber,
                numPages,
                onPageChange: setPageNumber,
                scale,
                onScaleChange: setScale,
              }
            : undefined
        }
      />

      {downloadError === null ? null : (
        <p role="alert" className="border-b border-line bg-danger-subtle px-3 py-2 text-sm text-danger">
          {downloadError}
        </p>
      )}

      {!isPdf ? (
        <UnsupportedPreview
          fileName={node.name}
          mimeType={node.mimeType}
          sizeBytes={node.sizeBytes}
          onDownload={() => {
            startDownload(node.name);
          }}
        />
      ) : failed ? (
        <PdfErrorState
          fileName={node.name}
          onDownload={() => {
            startDownload(node.name);
          }}
          onRetry={() => {
            setFailed(false);
            setAttempt((value) => value + 1);
          }}
        />
      ) : (
        <Suspense
          fallback={
            <div role="status" className="p-6">
              <span className="sr-only">Loading viewer</span>
              <Skeleton className="h-96 w-full" />
            </div>
          }
        >
          <PdfViewer
            key={attempt}
            fileUrl={contentUrl}
            shareToken={shareToken}
            pageNumber={pageNumber}
            scale={scale}
            onLoadSuccess={(pages) => {
              setNumPages(pages);
              setPageNumber((current) => Math.min(current, pages));
            }}
            onLoadError={() => {
              // First failure: assume the signed URL aged out and fetch a fresh one, once.
              if (attempt === 0) setAttempt(1);
              else setFailed(true);
            }}
          />
        </Suspense>
      )}
    </div>
  );

  if (detail.data.access === 'owner') return body;

  return (
    <SharedLayout
      ownerName={sharedBy}
      itemName={node.name}
      standalone={context.kind === 'share'}
    >
      {body}
    </SharedLayout>
  );
}
