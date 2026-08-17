import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { fixtures } from '@dataroom/contracts';
import { useMockApi } from '@/test/msw';
import { renderWithProviders } from '@/test/harness';
import { state } from '@/mocks/db';
import { forceError } from '@/mocks/errorMode';
import { FileViewerPage } from './FileViewerPage';

/**
 * react-pdf is replaced wholesale: rendering a real PDF in jsdom exercises pdf.js, not this app.
 * The double reports success or failure per attempt, which is exactly the behaviour under test.
 */
const documentBehaviour: { failuresBeforeSuccess: number; attempts: string[] } = {
  failuresBeforeSuccess: 0,
  attempts: [],
};

vi.mock('react-pdf', async () => {
  const { useEffect, useRef } = await import('react');
  return {
    pdfjs: { GlobalWorkerOptions: { workerSrc: '' } },
    Document: (props: {
      file: { url: string; httpHeaders: Record<string, string> };
      onLoadSuccess: (document: { numPages: number }) => void;
      onLoadError: (error: unknown) => void;
      children: React.ReactNode;
    }) => {
      const url = props.file.url;
      // One load per document URL, as pdf.js does — not one per React render. The callbacks are
      // read through a ref so their changing identity does not re-trigger a load.
      const latest = useRef(props);
      latest.current = props;
      useEffect(() => {
        const attemptIndex = documentBehaviour.attempts.length;
        documentBehaviour.attempts.push(url);
        if (attemptIndex < documentBehaviour.failuresBeforeSuccess) {
          latest.current.onLoadError(new Error('Failed to fetch the PDF (403)'));
        } else {
          latest.current.onLoadSuccess({ numPages: 3 });
        }
      }, [url]);
      return <div data-testid="pdf-document">{props.children}</div>;
    },
    Page: (props: { pageNumber: number; scale: number }) => (
      <div data-testid="pdf-page">{`page ${String(props.pageNumber)} @ ${String(props.scale)}`}</div>
    ),
  };
});

vi.mock('@/lib/browser', () => ({
  assignLocation: vi.fn(),
  reloadPage: vi.fn(),
  saveBlob: vi.fn(),
}));

const { saveBlob } = await import('@/lib/browser');

useMockApi();

const { IDS } = fixtures;
const roomContext = { kind: 'room', roomId: IDS.room } as const;

function renderViewer(nodeId: string = IDS.fileNda): void {
  renderWithProviders(<FileViewerPage nodeId={nodeId} context={roomContext} />, {
    route: `/rooms/${IDS.room}/file/${nodeId}`,
  });
}

beforeEach(() => {
  documentBehaviour.failuresBeforeSuccess = 0;
  documentBehaviour.attempts = [];
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('FileViewerPage', () => {
  it('shows a loading state, then the document and its toolbar', async () => {
    renderViewer();
    expect(screen.getByRole('status')).toBeInTheDocument();

    expect(await screen.findByTestId('pdf-page')).toHaveTextContent('page 1 @ 1');
    expect(screen.getByText('NDA.pdf')).toBeInTheDocument();
    expect(await screen.findByText('Page 1 of 3')).toBeInTheDocument();
  });

  it('paginates and zooms', async () => {
    renderViewer();
    await screen.findByText('Page 1 of 3');

    expect(screen.getByRole('button', { name: 'Previous page' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Next page' }));
    expect(screen.getByText('Page 2 of 3')).toBeInTheDocument();
    expect(screen.getByTestId('pdf-page')).toHaveTextContent('page 2');

    await userEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    expect(screen.getByText('125%')).toBeInTheDocument();
    expect(screen.getByTestId('pdf-page')).toHaveTextContent('@ 1.25');
  });

  it('refetches the content URL exactly once when the signed URL has expired', async () => {
    documentBehaviour.failuresBeforeSuccess = 1;
    renderViewer();

    expect(await screen.findByText('Page 1 of 3')).toBeInTheDocument();
    expect(documentBehaviour.attempts).toHaveLength(2);
    expect(documentBehaviour.attempts[0]).not.toContain('refresh=');
    expect(documentBehaviour.attempts[1]).toContain('refresh=1');
    expect(screen.queryByText('This PDF couldn’t be displayed')).not.toBeInTheDocument();
  });

  it('renders the error state, not a blank page, when the document fails twice', async () => {
    documentBehaviour.failuresBeforeSuccess = 5;
    renderViewer();

    expect(await screen.findByText('This PDF couldn’t be displayed')).toBeInTheDocument();
    expect(documentBehaviour.attempts).toHaveLength(2);
    expect(screen.getAllByRole('button', { name: 'Download' })).toHaveLength(2);
  });

  it('can retry from the error state', async () => {
    documentBehaviour.failuresBeforeSuccess = 2;
    renderViewer();
    await screen.findByText('This PDF couldn’t be displayed');

    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Page 1 of 3')).toBeInTheDocument();
  });

  it('renders an unsupported preview with a working download for a non-PDF', async () => {
    const node = state.nodes.get(IDS.fileNda);
    if (node !== undefined) node.mimeType = 'application/vnd.ms-excel';

    renderViewer();
    expect(await screen.findByText(/Only PDFs can be previewed here/)).toBeInTheDocument();
    expect(screen.queryByTestId('pdf-document')).not.toBeInTheDocument();

    const preview = screen.getByText(/Only PDFs can be previewed here/).parentElement as HTMLElement;
    await userEvent.click(within(preview).getByRole('button', { name: 'Download' }));
    await waitFor(() => {
      expect(saveBlob).toHaveBeenCalledTimes(1);
    });
    expect(vi.mocked(saveBlob).mock.calls[0]?.[1]).toBe('NDA.pdf');
  });

  it('downloads from the toolbar', async () => {
    renderViewer();
    await screen.findByText('Page 1 of 3');

    const toolbar = screen.getByRole('toolbar', { name: 'Document actions' });
    await userEvent.click(within(toolbar).getByRole('button', { name: 'Download' }));
    await waitFor(() => {
      expect(saveBlob).toHaveBeenCalledTimes(1);
    });
  });

  it('reports a failed download without losing the document', async () => {
    renderViewer();
    await screen.findByText('Page 1 of 3');

    forceError('INTERNAL', { endpointKey: 'nodes.download', times: 1 });
    const toolbar = screen.getByRole('toolbar', { name: 'Document actions' });
    await userEvent.click(within(toolbar).getByRole('button', { name: 'Download' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong');
    expect(screen.getByTestId('pdf-page')).toBeInTheDocument();
  });

  it('renders the gone state when the file was deleted while being viewed', async () => {
    forceError('ITEM_GONE', { endpointKey: 'nodes.get' });
    renderViewer();
    expect(await screen.findByText('This item was deleted by the owner')).toBeInTheDocument();
  });

  it('renders the forbidden state for a file outside the caller’s grant', async () => {
    forceError('FORBIDDEN', { endpointKey: 'nodes.get' });
    renderViewer();
    expect(await screen.findByText("You don't have access to this item")).toBeInTheDocument();
  });
});
